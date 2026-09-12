"""Tests for the unified pricing model, its migrations, and its endpoints."""

import json
import uuid
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import Client, TestCase, override_settings

from .models import BookingRequest, PricingGroup, PricingRule, Reservation, StayConstraint
from .tests import day, make_admin, make_property
from .views._pricing import calculate_price
from .views._pricing_validation import validate_pricing_rule


class PricingModelTests(TestCase):
    def test_group_orders_by_sort_order(self):
        # sort_order values well above the seeded groups (0-3), and the query
        # is filtered to just these two. Asserting on the first two rows of
        # PricingGroup.objects.all() would start failing in Task 4, when the
        # data migration seeds four groups of its own.
        PricingGroup.objects.create(name="Zebra", sort_order=91)
        PricingGroup.objects.create(name="Alpha", sort_order=90)
        self.assertEqual(
            [g.name for g in PricingGroup.objects.filter(sort_order__gte=90)],
            ["Alpha", "Zebra"],
        )

    def test_rule_code_is_unique_only_when_present(self):
        group = PricingGroup.objects.create(name="Promotions X", sort_order=9)
        PricingRule.objects.create(group=group, rule_type=PricingRule.RuleType.SEASONAL)
        PricingRule.objects.create(group=group, rule_type=PricingRule.RuleType.SEASONAL)
        PricingRule.objects.create(
            group=group, rule_type=PricingRule.RuleType.PROMO, code="SUMMER25"
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PricingRule.objects.create(
                    group=group, rule_type=PricingRule.RuleType.PROMO, code="SUMMER25"
                )

    def test_stay_constraint_holds_min_nights(self):
        prop = make_property()
        constraint = StayConstraint.objects.create(
            kind=StayConstraint.Kind.MIN_NIGHTS,
            value=3,
            scope=StayConstraint.Scope.PROPERTY,
            property=prop,
        )
        self.assertEqual(constraint.value, 3)
        self.assertTrue(constraint.enabled)


class SeededConfigTests(TestCase):
    """The 0028 data migration must leave a working default configuration."""

    def test_groups_exist_in_the_order_they_run(self):
        # 0032 renamed the seeded groups so the list reads as the pricing
        # story: a base rate, then seasons, then the discounts. See
        # tests_base_price.GroupRestructureTests for the restructure itself.
        self.assertEqual(
            [
                (g.name, g.behaviour)
                for g in PricingGroup.objects.filter(platform="airstay").order_by("sort_order")
            ],
            [
                ("Base Prices", "specific"),
                ("Seasonal Pricing", "stack"),
                ("Length of Stay Discounts", "best"),
                ("Booking Discounts", "stack"),
                ("Promotions", "stack"),
            ],
        )

    def test_default_long_stay_tiers_are_real_rules(self):
        group = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        tiers = list(
            group.rules.filter(rule_type=PricingRule.RuleType.LONG_STAY, enabled=True)
            .order_by("sort_order")
            .values_list("min_nights", "adjustment_value")
        )
        self.assertEqual(
            tiers,
            [
                (28, Decimal("50.00")),
                (21, Decimal("35.00")),
                (14, Decimal("25.00")),
                (10, Decimal("20.00")),
                (7, Decimal("15.00")),
                (5, Decimal("10.00")),
            ],
        )
        # Still stored biggest-first, but 0033 made the group "best", so this
        # order is now only how the ladder reads — the engine picks the tier
        # that discounts most whatever order they sit in.

    def test_tiers_are_percentage_decreases_applied_to_the_whole_stay(self):
        rule = PricingRule.objects.get(
            rule_type=PricingRule.RuleType.LONG_STAY, min_nights=7, scope="all"
        )
        self.assertEqual(rule.adjustment_type, PricingRule.AdjustmentType.PCT_DECREASE)
        self.assertEqual(rule.application, PricingRule.Application.WHOLE_STAY)

    def test_non_refundable_rule_carries_the_settings_value(self):
        rule = PricingRule.objects.get(rule_type=PricingRule.RuleType.NON_REFUNDABLE)
        self.assertEqual(rule.group.name, "Booking Discounts")
        self.assertEqual(rule.adjustment_type, PricingRule.AdjustmentType.PCT_DECREASE)
        self.assertEqual(rule.adjustment_value, Decimal("10.00"))


# PromoMigrationTests lived here. It verified the 0028 promo conversion against
# real PromoCode rows and passed before 0029 deleted the model. The conversion
# is now covered by SeededConfigTests plus the real `migrate` run.


class RuleValidationTests(TestCase):
    def setUp(self):
        self.stack = PricingGroup.objects.get(platform="airstay", name="Seasonal Pricing")
        self.exclusive = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")

    def _rule(self, **kwargs):
        defaults = {
            "group": self.stack,
            "rule_type": PricingRule.RuleType.SEASONAL,
            "scope": "all",
            "application": PricingRule.Application.PER_NIGHT,
            "adjustment_type": PricingRule.AdjustmentType.PCT_INCREASE,
            "adjustment_value": Decimal("10.00"),
        }
        defaults.update(kwargs)
        return PricingRule(**defaults)

    def test_valid_rule_passes(self):
        validate_pricing_rule(self._rule())  # must not raise

    def test_is_final_requires_per_night(self):
        rule = self._rule(application=PricingRule.Application.WHOLE_STAY, is_final=True)
        with self.assertRaisesMessage(ValidationError, "per-night"):
            validate_pricing_rule(rule)

    def test_fixed_price_requires_per_night(self):
        rule = self._rule(
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("56.00"),
        )
        with self.assertRaisesMessage(ValidationError, "whole stay"):
            validate_pricing_rule(rule)

    def test_a_single_winner_group_cannot_mix_applications(self):
        PricingRule.objects.create(
            group=self.exclusive,
            rule_type=PricingRule.RuleType.LONG_STAY,
            application=PricingRule.Application.WHOLE_STAY,
            min_nights=7,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("15.00"),
        )
        rule = self._rule(group=self.exclusive, application=PricingRule.Application.PER_NIGHT)
        with self.assertRaisesMessage(ValidationError, "applies only one rule"):
            validate_pricing_rule(rule)

    def test_promo_needs_a_code_and_others_may_not_have_one(self):
        with self.assertRaisesMessage(ValidationError, "code"):
            validate_pricing_rule(self._rule(rule_type=PricingRule.RuleType.PROMO, code=None))
        with self.assertRaisesMessage(ValidationError, "code"):
            validate_pricing_rule(self._rule(code="NOTAPROMO"))

    def test_promo_only_fields_are_rejected_elsewhere(self):
        with self.assertRaisesMessage(ValidationError, "promo rules only"):
            validate_pricing_rule(self._rule(usage_limit=5))

    def test_minimum_spend_requires_whole_stay(self):
        rule = self._rule(
            rule_type=PricingRule.RuleType.PROMO,
            code="BIG",
            application=PricingRule.Application.PER_NIGHT,
            min_subtotal_eur=Decimal("200.00"),
        )
        with self.assertRaisesMessage(ValidationError, "whole-stay"):
            validate_pricing_rule(rule)

    def test_scoped_rule_needs_its_target(self):
        with self.assertRaisesMessage(ValidationError, "property"):
            validate_pricing_rule(self._rule(scope="property", property=None))
        with self.assertRaisesMessage(ValidationError, "bedroom"):
            validate_pricing_rule(self._rule(scope="bedroom_group", bedroom_group=None))

    def test_enabled_rule_needs_an_adjustment_value(self):
        with self.assertRaisesMessage(ValidationError, "amount"):
            validate_pricing_rule(self._rule(adjustment_value=None))


class PromoUsageCountingTests(TestCase):
    """A promo is spent when a booking is committed — never before."""

    def setUp(self):
        self.client = Client()
        self.prop = make_property()
        self.promo = PricingRule.objects.create(
            group=PricingGroup.objects.get(platform="airstay", name="Promotions"),
            rule_type=PricingRule.RuleType.PROMO,
            code="TEN",
            scope="all",
            enabled=True,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("10.00"),
        )

    def _create_request(self, prop=None, start=30):
        # Callers that approve more than one request must pass distinct dates
        # or a distinct property: approval refuses to create a reservation
        # that overlaps an existing one, so two identical requests would make
        # the second approval a 409 and prove nothing about promo counting.
        return self.client.post(
            "/api/booking/requests/",
            data=json.dumps({
                "propertyId": str((prop or self.prop).id),
                "checkIn": day(start).isoformat(),
                "checkOut": day(start + 3).isoformat(),
                "guestName": "Test Guest",
                "guestPhone": "+355000000",
                "guestEmail": "test.guest@example.com",
                "promoCode": "TEN",
            }),
            content_type="application/json",
        )

    def test_validating_a_code_does_not_spend_it(self):
        self.client.post(
            "/api/booking/promo-codes/validate/",
            data=json.dumps({
                "propertyId": str(self.prop.id),
                "code": "TEN",
                "checkIn": day(30).isoformat(),
                "checkOut": day(33).isoformat(),
            }),
            content_type="application/json",
        )
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 0)

    def test_a_pending_request_does_not_spend_it(self):
        self.assertEqual(self._create_request().status_code, 201)
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 0)

    def test_approval_spends_it(self):
        self._create_request()
        req = BookingRequest.objects.get()
        make_admin(self.client)
        response = self.client.post(f"/api/booking-requests/{req.id}/approve/")
        self.assertEqual(response.status_code, 200)
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 1)

    def test_rejection_spends_nothing(self):
        self._create_request()
        req = BookingRequest.objects.get()
        make_admin(self.client)
        self.client.post(
            f"/api/booking-requests/{req.id}/reject/",
            data=json.dumps({"rejectionMessage": "no"}),
            content_type="application/json",
        )
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 0)

    def test_approval_never_blocks_on_the_limit_but_warns(self):
        self._create_request(start=30)
        self._create_request(start=60)  # non-overlapping, so neither approval 409s
        self.promo.usage_limit = 1
        self.promo.save()
        make_admin(self.client)
        for req in BookingRequest.objects.order_by("check_in"):
            response = self.client.post(f"/api/booking-requests/{req.id}/approve/")
            self.assertEqual(response.status_code, 200)
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 2)
        self.assertIn("over its usage limit", response.json()["warning"])


class BackfillMissingTiersTests(TestCase):
    """0028 used to treat any enabled, scope-all long_stay rule at a given
    min_nights as proof that tier was already seeded — even a rule with no
    adjustment_value, which the pricing engine can never apply. 0028 (fixed)
    and 0030 (backfill) both require adjustment_value__isnull=False instead.
    These tests prove that condition, and the repair it enables, actually
    work end to end on a freshly-migrated database."""

    def test_valueless_rule_does_not_block_a_usable_tier(self):
        # Recreate the bad pre-fix shape: an enabled, scope-all long_stay
        # rule at min_nights=7 with adjustment_value=None — exactly what the
        # old condition accepted as "already seeded". A query for a *usable*
        # tier at that threshold must still find the real one the migrations
        # seeded, ignoring this placeholder.
        stay = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        PricingRule.objects.create(
            group=stay,
            name="placeholder",
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=True,
            min_nights=7,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=None,
            application="whole_stay",
            sort_order=50,
        )
        usable = PricingRule.objects.filter(
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=True,
            min_nights=7,
            adjustment_value__isnull=False,
        )
        self.assertTrue(usable.exists())

    def test_every_default_threshold_has_a_usable_tier(self):
        for min_nights in (28, 21, 14, 10, 7, 5):
            with self.subTest(min_nights=min_nights):
                self.assertTrue(
                    PricingRule.objects.filter(
                        rule_type=PricingRule.RuleType.LONG_STAY,
                        scope="all",
                        enabled=True,
                        min_nights=min_nights,
                        adjustment_value__isnull=False,
                    ).exists()
                )

    def test_seven_night_stay_discounts_end_to_end(self):
        prop = make_property(base_price_eur=Decimal("50.00"))
        bd = calculate_price(prop, day(30), day(37))
        self.assertEqual(bd["total"], "297.50")


class PricingGroupApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_requires_a_role(self):
        anon = Client()
        self.assertIn(anon.get("/api/pricing-groups/").status_code, (401, 403))

    def test_lists_the_seeded_groups_in_order(self):
        data = self.client.get("/api/pricing-groups/").json()["pricingGroups"]
        self.assertEqual([g["name"] for g in data][0], "Base Prices")
        self.assertEqual(data[0]["behaviour"], "specific")
        self.assertEqual(data[2]["behaviour"], "best")

    def test_a_group_with_rules_cannot_be_deleted(self):
        group = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        response = self.client.delete(f"/api/pricing-groups/{group.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("rule", response.json()["error"].lower())

    def test_an_empty_group_can_be_deleted(self):
        group = PricingGroup.objects.create(name="Temp", sort_order=50)
        self.assertEqual(self.client.delete(f"/api/pricing-groups/{group.id}/").status_code, 204)


class PricingRuleApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.group = PricingGroup.objects.get(platform="airstay", name="Seasonal Pricing")

    def test_create_rejects_a_contradiction(self):
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(self.group.id),
                "ruleType": "seasonal",
                "application": "whole_stay",
                "isFinal": True,
                "adjustmentType": "pct_increase",
                "adjustmentValue": "10",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("per-night", response.json()["error"])

    def test_every_field_is_patchable(self):
        rule = PricingRule.objects.create(
            group=self.group, rule_type="seasonal", application="per_night",
            adjustment_type="pct_increase", adjustment_value=Decimal("10.00"),
        )
        response = self.client.patch(
            f"/api/pricing-rules/{rule.id}/",
            data=json.dumps({
                "name": "August peak",
                "adjustmentValue": "25",
                "startDate": day(30).isoformat(),
                "isFinal": True,
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        rule.refresh_from_db()
        self.assertEqual(rule.name, "August peak")
        self.assertEqual(rule.adjustment_value, Decimal("25"))
        self.assertTrue(rule.is_final)

    def test_reorder_within_a_group(self):
        first = PricingRule.objects.create(group=self.group, rule_type="seasonal", sort_order=0)
        second = PricingRule.objects.create(group=self.group, rule_type="seasonal", sort_order=1)
        self.client.patch(
            "/api/pricing-rules/reorder/",
            data=json.dumps({"groupId": str(self.group.id), "order": [str(second.id), str(first.id)]}),
            content_type="application/json",
        )
        second.refresh_from_db()
        self.assertEqual(second.sort_order, 0)

    def test_promo_endpoints_are_gone(self):
        self.assertEqual(self.client.get("/api/promo-codes/").status_code, 404)

    def test_a_promo_code_is_stored_uppercase(self):
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(PricingGroup.objects.get(platform="airstay", name="Promotions").id),
                "ruleType": "promo",
                "code": " summer25 ",
                "adjustmentType": "pct_decrease",
                "adjustmentValue": "10",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["pricingRule"]["code"], "SUMMER25")

    def test_a_new_seasonal_rule_defaults_to_per_night(self):
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(self.group.id),
                "ruleType": "seasonal",
                "adjustmentType": "pct_increase",
                "adjustmentValue": "50",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.json()["pricingRule"]["application"], "per_night")

    def test_a_group_cannot_become_exclusive_while_it_mixes_applications(self):
        PricingRule.objects.create(
            group=self.group, rule_type="seasonal", application="per_night",
            adjustment_type="pct_increase", adjustment_value=Decimal("10.00"),
        )
        PricingRule.objects.create(
            group=self.group, rule_type="manual", application="whole_stay",
            adjustment_type="fixed_decrease", adjustment_value=Decimal("5.00"),
        )
        response = self.client.patch(
            f"/api/pricing-groups/{self.group.id}/",
            data=json.dumps({"behaviour": "exclusive"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Exclusive", response.json()["error"])


class StayConstraintApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_requires_a_role(self):
        self.assertIn(Client().get("/api/stay-constraints/").status_code, (401, 403))

    def test_create_list_and_delete(self):
        created = self.client.post(
            "/api/stay-constraints/",
            data=json.dumps({"kind": "min_nights", "value": 3, "scope": "all"}),
            content_type="application/json",
        )
        self.assertEqual(created.status_code, 201)
        constraint_id = created.json()["stayConstraint"]["id"]

        listed = self.client.get("/api/stay-constraints/").json()["stayConstraints"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["value"], 3)

        self.assertEqual(
            self.client.delete(f"/api/stay-constraints/{constraint_id}/").status_code, 204
        )

    def test_a_property_scoped_constraint_needs_a_property(self):
        response = self.client.post(
            "/api/stay-constraints/",
            data=json.dumps({"kind": "min_nights", "value": 3, "scope": "property"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_it_reaches_the_price_breakdown(self):
        prop = make_property()
        self.client.post(
            "/api/stay-constraints/",
            data=json.dumps({"kind": "min_nights", "value": 4, "scope": "all"}),
            content_type="application/json",
        )
        from .views._pricing import calculate_price

        bd = calculate_price(prop, day(30), day(32))
        self.assertEqual(bd["min_nights_required"], 4)


class QuotesEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property()

    def test_returns_a_breakdown_per_property(self):
        response = self.client.post(
            "/api/properties/quotes/",
            data=json.dumps({
                "checkIn": day(30).isoformat(),
                "checkOut": day(37).isoformat(),
                "propertyIds": [str(self.prop.id)],
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        quote = response.json()["quotes"][str(self.prop.id)]
        self.assertEqual(quote["total"], "297.50")
        self.assertEqual(quote["averageNightlyRate"], "42.50")

    def test_requires_a_role(self):
        self.assertIn(Client().post("/api/properties/quotes/").status_code, (401, 403))

    def test_defaults_to_every_active_airstay_property(self):
        other = make_property(name="Other Apartment")
        response = self.client.post(
            "/api/properties/quotes/",
            data=json.dumps({
                "checkIn": day(30).isoformat(),
                "checkOut": day(33).isoformat(),
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        quotes = response.json()["quotes"]
        self.assertIn(str(self.prop.id), quotes)
        self.assertIn(str(other.id), quotes)

    def test_a_raising_property_still_appears_with_a_fallback_total(self):
        # A quote failure must never make an apartment vanish from staff
        # search results — it should carry an error and a base-price fallback
        # total instead. Mocking calculate_price is the cleanest way to force
        # an arbitrary exception without hunting for a rule config that
        # happens to make the real engine raise.
        with patch(
            "pms.views._pricing_rules_api.calculate_price",
            side_effect=RuntimeError("boom"),
        ):
            response = self.client.post(
                "/api/properties/quotes/",
                data=json.dumps({
                    "checkIn": day(30).isoformat(),
                    "checkOut": day(33).isoformat(),
                    "propertyIds": [str(self.prop.id)],
                }),
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        quote = response.json()["quotes"][str(self.prop.id)]
        self.assertEqual(quote["error"], "boom")
        self.assertEqual(quote["total"], "150.00")


# ---------------------------------------------------------------------------
# F1 — public endpoints must never leak the pricing configuration
# ---------------------------------------------------------------------------

class PublicBreakdownRedactionTests(TestCase):
    """calculate_price(public=True), and every unauthenticated call site that
    now passes it, must never surface a rule that did not apply, its reason,
    or the literal promo code baked into f"Promo {code}" rule names (the
    shape the 0028 migration gives every migrated promo)."""

    def setUp(self):
        self.client = Client()
        self.prop = make_property(base_price_eur=Decimal("50.00"))
        # Applies — proves an APPLIED entry is trimmed too, not just that
        # ineligible ones vanish.
        self.seasonal = PricingRule.objects.create(
            group=PricingGroup.objects.get(platform="airstay", name="Seasonal Pricing"),
            application="per_night",
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            start_date=day(0),
            end_date=day(60),
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("80.00"),
            enabled=True,
        )
        # Never entered by an anonymous listing/search call — must not leak
        # its code-bearing name via a not_eligible "code not entered" entry.
        self.promo = PricingRule.objects.create(
            group=PricingGroup.objects.get(platform="airstay", name="Promotions"),
            name="Promo SECRET25",
            rule_type=PricingRule.RuleType.PROMO,
            code="SECRET25",
            scope="all",
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("25.00"),
            enabled=True,
        )
        # A staff-only rule scoped to a DIFFERENT property — must not leak
        # its name/reason when pricing self.prop.
        self.other_prop = make_property(name="Other Apartment")
        self.manual = PricingRule.objects.create(
            group=PricingGroup.objects.get(platform="airstay", name="Promotions"),
            name="Staff goodwill",
            rule_type=PricingRule.RuleType.MANUAL,
            scope="property",
            property=self.other_prop,
            adjustment_type=PricingRule.AdjustmentType.FIXED_DECREASE,
            adjustment_value=Decimal("20.00"),
            enabled=True,
        )

    def test_public_breakdown_keeps_only_applied_rules_with_minimal_fields(self):
        full = calculate_price(self.prop, day(10), day(12))
        full_by_id = {r["id"]: r for r in full["rules"]}
        # Sanity check on the unchanged staff path: the out-of-scope manual
        # rule and the un-entered promo both still carry their diagnostics.
        self.assertEqual(
            full_by_id[str(self.manual.pk)]["reason"], "does not apply to this apartment"
        )
        self.assertEqual(full_by_id[str(self.promo.pk)]["reason"], "code not entered")

        bd = calculate_price(self.prop, day(10), day(12), public=True)
        rule_ids = {r["id"] for r in bd["rules"]}
        self.assertIn(str(self.seasonal.pk), rule_ids)
        self.assertNotIn(str(self.promo.pk), rule_ids)
        self.assertNotIn(str(self.manual.pk), rule_ids)
        for report in bd["rules"]:
            self.assertEqual(set(report.keys()), {"id", "name", "amount"})

    def test_public_nightly_breakdown_drops_staff_diagnostics(self):
        bd = calculate_price(self.prop, day(10), day(12), public=True)
        self.assertTrue(bd["nightly_breakdown"])
        for row in bd["nightly_breakdown"]:
            self.assertEqual(set(row.keys()), {"date", "rate"})

    def test_anonymous_property_listing_never_leaks_a_reason_or_the_promo_code(self):
        response = self.client.get(
            "/api/booking/properties/",
            {"check_in": day(10).isoformat(), "check_out": day(12).isoformat()},
        )
        properties = response.json()["properties"]
        self.assertTrue(properties)
        for prop_data in properties:
            for report in prop_data["priceBreakdown"]["rules"]:
                self.assertNotIn("reason", report)
                self.assertNotIn("status", report)
                self.assertNotIn("SECRET25", report["name"])

    def test_anonymous_availability_search_never_leaks_a_reason_or_a_scoped_manual_rule(self):
        response = self.client.get(
            "/api/booking/availability/",
            {"check_in": day(10).isoformat(), "check_out": day(12).isoformat(), "guests": 1},
        )
        available = response.json()["available"]
        self.assertTrue(available)
        for entry in available:
            for report in entry["property"]["priceBreakdown"]["rules"]:
                self.assertNotIn("reason", report)
                self.assertNotIn("Staff goodwill", report["name"])

    def test_booking_calculate_endpoint_is_public_safe(self):
        response = self.client.post(
            "/api/booking/calculate/",
            data=json.dumps({
                "propertyId": str(self.prop.id),
                "checkIn": day(10).isoformat(),
                "checkOut": day(12).isoformat(),
            }),
            content_type="application/json",
        )
        rules = response.json()["priceBreakdown"]["rules"]
        self.assertTrue(rules)
        for report in rules:
            self.assertNotIn("reason", report)
            self.assertEqual(set(report.keys()), {"id", "name", "amount"})

    def test_a_booking_requests_stored_breakdown_is_public_safe(self):
        # The public-safe form must be what's PERSISTED, not just what's
        # served at creation time — an old full-shape blob would leak later
        # through the guest or staff reservation-detail views regardless of
        # what today's serving code does.
        response = self.client.post(
            "/api/booking/requests/",
            data=json.dumps({
                "propertyId": str(self.prop.id),
                "checkIn": day(10).isoformat(),
                "checkOut": day(12).isoformat(),
                "guestName": "Test Guest",
                "guestPhone": "+355000000",
                "guestEmail": "test.guest@example.com",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        req = BookingRequest.objects.get()
        self.assertTrue(req.price_breakdown["rules"])
        for report in req.price_breakdown["rules"]:
            self.assertNotIn("reason", report)
            self.assertEqual(set(report.keys()), {"id", "name", "amount"})

    @override_settings(ONLINE_PAYMENTS_ENABLED=True)
    def test_a_direct_bookings_stored_breakdown_is_public_safe(self):
        # Direct booking is off unless a payment provider exists; this is about
        # the shape of what it stores, so it switches the path on deliberately.
        response = self.client.post(
            "/api/booking/bookings/",
            data=json.dumps({
                "propertyId": str(self.prop.id),
                "checkIn": day(10).isoformat(),
                "checkOut": day(12).isoformat(),
                "guestName": "Test Guest",
                "guestEmail": "guest@example.com",
                "guestPhone": "+355000000",
                "paymentType": "full",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        reservation = Reservation.objects.get()
        self.assertTrue(reservation.price_breakdown_json["rules"])
        for report in reservation.price_breakdown_json["rules"]:
            self.assertNotIn("reason", report)
            self.assertEqual(set(report.keys()), {"id", "name", "amount"})


# ---------------------------------------------------------------------------
# F2 — seeded default tiers must not outrank an operator's own rule
# ---------------------------------------------------------------------------

class SeededTierRankingTests(TestCase):
    """0028/0030 seed the six default long-stay tiers at sort_order 900+
    instead of 0-5, and 0031 renumbers rows already seeded under the old
    numbering.

    That band was how an operator's own rule — left at the API's default
    sortOrder=0 — used to outrank every default. 0033 then made the group
    "best", so ranking no longer depends on the band at all: an operator's
    rule wins by discounting more. The band is kept because it still orders
    how the ladder reads, and these tests now assert the behaviour that
    actually decides the price."""

    def test_seeded_tiers_sit_in_the_900_band(self):
        stay = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        tiers = stay.rules.filter(rule_type=PricingRule.RuleType.LONG_STAY, scope="all")
        self.assertEqual(tiers.count(), 6)
        for tier in tiers:
            self.assertGreaterEqual(tier.sort_order, 900)

    def test_an_operator_rule_that_discounts_more_beats_every_seeded_tier(self):
        stay = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        custom = PricingRule.objects.create(
            group=stay,
            name="Operator override",
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=True,
            min_nights=5,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("99.00"),
            application="whole_stay",
            # sort_order left unset — the model/API default is 0, exactly
            # what a rule created through the UI gets. It must not matter.
        )
        self.assertEqual(custom.sort_order, 0)

        prop = make_property(base_price_eur=Decimal("50.00"))
        bd = calculate_price(prop, day(30), day(37))  # 7 nights: eligible for every tier
        self.assertEqual(bd["total"], "3.50")  # 350.00 * (1 - 0.99)

        rules = {r["id"]: r for r in bd["rules"]}
        self.assertEqual(rules[str(custom.pk)]["status"], "applied")
        # Only the tiers actually eligible for a 7-night stay (min_nights <= 7)
        # would have won without the custom rule; the rest are simply
        # not_eligible regardless of sort_order, and asserting on them here
        # would prove nothing about ranking.
        eligible_tiers = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts").rules.filter(
            rule_type=PricingRule.RuleType.LONG_STAY, scope="all", min_nights__lte=7,
        ).exclude(pk=custom.pk)
        self.assertTrue(eligible_tiers.exists())
        for tier in eligible_tiers:
            self.assertEqual(rules[str(tier.pk)]["status"], "overridden")


# ---------------------------------------------------------------------------
# F4 — falsy-zero coercion must not discard 0 or invert usageLimit
# ---------------------------------------------------------------------------

class FalsyZeroCoercionTests(TestCase):
    """0 is a legitimate value for several numeric fields. The naive
    `int(v) if v else None` coercion silently discarded daysBeforeCheckin=0
    (a same-day last-minute rule — the UI offers min={0}) and inverted
    usageLimit=0 into None, which means UNLIMITED."""

    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_days_before_checkin_zero_round_trips_as_a_same_day_rule(self):
        group = PricingGroup.objects.get(platform="airstay", name="Booking Discounts")
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(group.id),
                "ruleType": "last_minute",
                "daysBeforeCheckin": 0,
                "adjustmentType": "pct_decrease",
                "adjustmentValue": "10",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["pricingRule"]["daysBeforeCheckin"], 0)

        rule = PricingRule.objects.get(pk=response.json()["pricingRule"]["id"])
        self.assertEqual(rule.days_before_checkin, 0)

        prop = make_property(base_price_eur=Decimal("100.00"))
        same_day = calculate_price(prop, day(0), day(1))
        self.assertEqual(same_day["last_minute_amount"], "10.00")
        later = calculate_price(prop, day(5), day(6))
        self.assertEqual(later["last_minute_amount"], "0.00")

    def test_usage_limit_zero_means_the_code_is_already_exhausted_not_unlimited(self):
        promotions = PricingGroup.objects.get(platform="airstay", name="Promotions")
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(promotions.id),
                "ruleType": "promo",
                "code": "DEAD",
                "usageLimit": 0,
                "adjustmentType": "pct_decrease",
                "adjustmentValue": "10",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["pricingRule"]["usageLimit"], 0)

        rule = PricingRule.objects.get(pk=response.json()["pricingRule"]["id"])
        self.assertEqual(rule.usage_limit, 0)

        prop = make_property(base_price_eur=Decimal("100.00"))
        bd = calculate_price(prop, day(10), day(12), promo_rule=rule)
        self.assertEqual(bd["promo_amount"], "0.00")
        report = next(r for r in bd["rules"] if r["id"] == str(rule.pk))
        self.assertIn("used", report["reason"])


# ---------------------------------------------------------------------------
# F5 — a missing or unknown groupId must 400, not 500
# ---------------------------------------------------------------------------

class GroupValidationErrorTests(TestCase):
    """rule.group raises RelatedObjectDoesNotExist when group_id is unset and
    PricingGroup.DoesNotExist for an unknown id — neither is a
    ValidationError/ValueError, so the view's except clause used to miss both
    and 500. validate_pricing_rule must turn both into a ValidationError."""

    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_missing_group_id_returns_400_not_500(self):
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "ruleType": "seasonal",
                "application": "per_night",
                "adjustmentType": "pct_increase",
                "adjustmentValue": "10",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("group", response.json()["error"].lower())

    def test_unknown_group_id_returns_400_not_500(self):
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(uuid.uuid4()),
                "ruleType": "seasonal",
                "application": "per_night",
                "adjustmentType": "pct_increase",
                "adjustmentValue": "10",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("group", response.json()["error"].lower())

    def test_validate_pricing_rule_raises_directly_for_a_groupless_rule(self):
        rule = PricingRule(
            rule_type=PricingRule.RuleType.SEASONAL,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.PCT_INCREASE,
            adjustment_value=Decimal("10.00"),
        )
        with self.assertRaisesMessage(ValidationError, "group"):
            validate_pricing_rule(rule)


# ---------------------------------------------------------------------------
# F6 — a promo below its minimum spend must not validate true at €0 off
# ---------------------------------------------------------------------------

class PromoValidationBelowMinimumSpendTests(TestCase):
    """resolve_promo_rule intentionally leaves the min_subtotal_eur check to
    the engine (it needs pass-1's subtotal), so a code below its minimum
    used to validate as `valid: true` with promoAmount "0.00"."""

    def setUp(self):
        self.client = Client()
        # 200/night, and every stay below kept under 5 nights: the seeded
        # long-stay tiers start at min_nights=5, so this stays decoupled from
        # them and isolates exactly the min_subtotal_eur check under test.
        self.prop = make_property(base_price_eur=Decimal("200.00"))
        self.promo = PricingRule.objects.create(
            group=PricingGroup.objects.get(platform="airstay", name="Promotions"),
            name="Promo BIG",
            rule_type=PricingRule.RuleType.PROMO,
            code="BIG",
            scope="all",
            enabled=True,
            min_subtotal_eur=Decimal("500.00"),
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("10.00"),
        )

    def _validate(self, nights):
        return self.client.post(
            "/api/booking/promo-codes/validate/",
            data=json.dumps({
                "propertyId": str(self.prop.id),
                "code": "BIG",
                "checkIn": day(10).isoformat(),
                "checkOut": day(10 + nights).isoformat(),
            }),
            content_type="application/json",
        )

    def test_below_minimum_spend_is_reported_invalid_at_200(self):
        response = self._validate(2)  # 400.00 subtotal, under the 500 minimum
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["valid"])
        self.assertIn("500", data["error"])

    def test_above_minimum_spend_still_validates(self):
        response = self._validate(3)  # 600.00 subtotal, over the 500 minimum
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["valid"])
        self.assertEqual(data["promoAmount"], "60.00")
