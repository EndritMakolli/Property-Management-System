"""Tests for the staff pricing-preview endpoint.

The endpoint exists so the pricing page can answer two questions the rule
editor could never answer on its own: "what would a guest pay for this stay?"
and "why didn't the rule I just wrote fire?". It adds no pricing maths of its
own — it composes resolve_promo_rule and calculate_price — so these tests are
about the endpoint's contract, not about the engine's arithmetic.
"""

import json
import uuid
from decimal import Decimal

from django.test import Client, TestCase

from .models import PricingGroup, PricingRule, StayConstraint
from .tests import day, make_admin, make_property

URL = "/api/pricing/preview/"


class PricingPreviewApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property()  # base_price_eur = 50.00
        self.seasonal = PricingGroup.objects.get(platform="airstay", name="Seasonal Pricing")

    def preview(self, **overrides):
        """POST a two-night stay far enough out that no seeded rule fires."""
        payload = {
            "propertyId": str(self.prop.id),
            "checkIn": day(30).isoformat(),
            "checkOut": day(32).isoformat(),
        }
        payload.update(overrides)
        return self.client.post(URL, data=json.dumps(payload), content_type="application/json")

    # ── Access ──────────────────────────────────────────────────────────────

    def test_requires_a_role(self):
        anon = Client()
        response = anon.post(
            URL,
            data=json.dumps({
                "propertyId": str(self.prop.id),
                "checkIn": day(30).isoformat(),
                "checkOut": day(32).isoformat(),
            }),
            content_type="application/json",
        )
        self.assertIn(response.status_code, (401, 403))

    def test_rejects_a_get(self):
        self.assertEqual(self.client.get(URL).status_code, 405)

    # ── Request validation ──────────────────────────────────────────────────

    def test_unknown_property_is_rejected(self):
        response = self.preview(propertyId=str(uuid.uuid4()))
        self.assertEqual(response.status_code, 404)

    def test_a_malformed_property_id_is_rejected_not_crashed(self):
        response = self.preview(propertyId="not-a-uuid")
        self.assertEqual(response.status_code, 404)

    def test_a_missing_property_id_is_rejected_not_crashed(self):
        response = self.preview(propertyId=None)
        self.assertEqual(response.status_code, 404)

    def test_check_out_must_follow_check_in(self):
        response = self.preview(checkIn=day(32).isoformat(), checkOut=day(30).isoformat())
        self.assertEqual(response.status_code, 400)

    # ── The quote ───────────────────────────────────────────────────────────

    def test_prices_a_plain_stay_at_the_base_rate(self):
        data = self.preview().json()["preview"]
        self.assertEqual(data["total"], "100.00")
        self.assertEqual(data["nights"], 2)
        self.assertEqual(data["baseNightly"], "50.00")

    def test_returns_a_row_per_night(self):
        data = self.preview().json()["preview"]
        self.assertEqual(
            [row["date"] for row in data["nightlyBreakdown"]],
            [day(30).isoformat(), day(31).isoformat()],
        )

    # ── Rule explanations — the reason this endpoint exists ─────────────────

    def test_explains_a_rule_that_applied(self):
        rule = PricingRule.objects.create(
            group=self.seasonal,
            name="Summer rate",
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.PCT_INCREASE,
            adjustment_value=Decimal("10.00"),
            start_date=day(30),
            end_date=day(32),
        )
        data = self.preview().json()["preview"]
        report = next(r for r in data["rules"] if r["id"] == str(rule.id))
        self.assertEqual(report["status"], "applied")
        self.assertEqual(report["amount"], "10.00")
        self.assertEqual(report["name"], "Summer rate")

    def test_explains_why_a_rule_did_not_apply(self):
        # A seeded long-stay tier needs 5 nights; this stay is 2.
        tier = PricingRule.objects.get(
            rule_type=PricingRule.RuleType.LONG_STAY, min_nights=5, scope="all"
        )
        data = self.preview().json()["preview"]
        report = next(r for r in data["rules"] if r["id"] == str(tier.id))
        self.assertEqual(report["status"], "not_eligible")
        self.assertIn("2 nights", report["reason"])

    def test_reports_carry_the_group_name(self):
        tier = PricingRule.objects.get(
            rule_type=PricingRule.RuleType.LONG_STAY, min_nights=5, scope="all"
        )
        data = self.preview().json()["preview"]
        report = next(r for r in data["rules"] if r["id"] == str(tier.id))
        self.assertEqual(report["group"], "Length of Stay Discounts")

    def test_marks_nights_locked_by_a_final_price_rule(self):
        PricingRule.objects.create(
            group=self.seasonal,
            name="Event rate",
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("80.00"),
            is_final=True,
            start_date=day(30),
            end_date=day(32),
        )
        data = self.preview().json()["preview"]
        self.assertTrue(all(row["locked"] for row in data["nightlyBreakdown"]))
        self.assertEqual(data["total"], "160.00")

    # ── Stay options ────────────────────────────────────────────────────────

    def test_non_refundable_discount_applies_only_when_asked(self):
        self.assertEqual(self.preview().json()["preview"]["total"], "100.00")
        self.assertEqual(
            self.preview(isNonRefundable=True).json()["preview"]["total"], "90.00"
        )

    def test_applies_a_promo_code(self):
        PricingRule.objects.create(
            group=PricingGroup.objects.get(platform="airstay", name="Promotions"),
            name="Ten off",
            rule_type=PricingRule.RuleType.PROMO,
            code="TEN",
            scope="all",
            enabled=True,
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("10.00"),
        )
        body = self.preview(promoCode="ten").json()
        self.assertEqual(body["promoError"], "")
        self.assertEqual(body["preview"]["total"], "90.00")

    def test_reports_an_unknown_promo_code_without_losing_the_quote(self):
        body = self.preview(promoCode="NOPE").json()
        self.assertTrue(body["promoError"])
        self.assertEqual(body["preview"]["total"], "100.00")

    # ── Booking limits ──────────────────────────────────────────────────────

    def test_surfaces_the_minimum_stay_error(self):
        StayConstraint.objects.create(
            kind=StayConstraint.Kind.MIN_NIGHTS, value=3, scope="all", enabled=True
        )
        data = self.preview().json()["preview"]
        self.assertEqual(data["minNightsRequired"], 3)
        self.assertTrue(data["errors"])

    # ── Staff-only detail must be present (this endpoint is behind a role) ──

    def test_includes_rules_that_did_not_apply(self):
        """The public breakdown strips these; the staff preview must not."""
        data = self.preview().json()["preview"]
        self.assertTrue(any(r["status"] != "applied" for r in data["rules"]))
