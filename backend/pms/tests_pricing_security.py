"""Security checks on the pricing surface.

Two things this app has always been careful about, which the pricing rework
has to keep true:

  * a guest is never told about staff-side structure, and
  * a staff endpoint answers a bad request with a 4xx, not a stack trace.
"""

import json
import uuid
from datetime import timedelta

from django.test import Client, TestCase

from .models import PricingGroup, PricingRule
from .tests import day, make_admin, make_property
from .views._pricing import calculate_price


class PublicErrorsSayNothingAboutTheAdminTests(TestCase):
    """An unpriced apartment must read as unavailable, not as a to-do list."""

    def setUp(self):
        self.prop = make_property(base_price_eur=None)

    def test_a_guest_is_not_told_where_to_configure_prices(self):
        errors = " ".join(calculate_price(self.prop, day(30), day(32), public=True)["errors"])
        self.assertNotIn("pricing page", errors.lower())
        self.assertNotIn("base price", errors.lower())

    def test_a_guest_is_still_told_the_stay_cannot_be_booked(self):
        errors = calculate_price(self.prop, day(30), day(32), public=True)["errors"]
        self.assertTrue(errors)

    def test_staff_keep_the_actionable_message(self):
        errors = " ".join(calculate_price(self.prop, day(30), day(32))["errors"])
        self.assertIn("base price", errors.lower())

    def test_the_public_breakdown_still_hides_rules_that_did_not_apply(self):
        """The long-standing invariant, re-checked against the new rule types."""
        public = calculate_price(self.prop, day(30), day(32), public=True)
        self.assertTrue(all(set(r) == {"id", "name", "amount"} for r in public["rules"]))

    def test_the_public_breakdown_hides_the_per_night_rule_trace(self):
        public = calculate_price(self.prop, day(30), day(32), public=True)
        for night in public["nightly_breakdown"]:
            self.assertEqual(set(night), {"date", "rate"})


class BadReferencesAreRefusedNotCrashedTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.group = PricingGroup.objects.get(platform="airstay", name="Seasonal Pricing")

    def block_payload(self, **overrides):
        body = {
            "groupId": str(self.group.id),
            "ruleType": "block_discounts",
            "application": "per_night",
            "scope": "all",
            "startDate": day(30).isoformat(),
            "endDate": day(35).isoformat(),
        }
        body.update(overrides)
        return json.dumps(body)

    def post(self, **overrides):
        return self.client.post(
            "/api/pricing-rules/",
            data=self.block_payload(**overrides),
            content_type="application/json",
        )

    def test_a_group_that_does_not_exist_is_a_bad_request(self):
        """A well-formed but unknown id used to reach the database and raise a
        ForeignKeyViolation, answering a 500 with a stack trace."""
        response = self.post(blocksGroupId=str(uuid.uuid4()))
        self.assertEqual(response.status_code, 400)

    def test_a_rule_that_does_not_exist_is_a_bad_request(self):
        response = self.post(blocksRuleId=str(uuid.uuid4()))
        self.assertEqual(response.status_code, 400)

    def test_a_malformed_id_is_a_bad_request(self):
        response = self.post(blocksGroupId="not-a-uuid")
        self.assertEqual(response.status_code, 400)

    def test_a_real_group_is_accepted(self):
        tiers = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        response = self.post(blocksGroupId=str(tiers.id))
        self.assertEqual(response.status_code, 201)

    def test_a_real_rule_is_accepted(self):
        tier = PricingRule.objects.filter(rule_type=PricingRule.RuleType.LONG_STAY).first()
        response = self.post(blocksRuleId=str(tier.id))
        self.assertEqual(response.status_code, 201)


class StaffOnlyEndpointsStayStaffOnlyTests(TestCase):
    """Every pricing endpoint added or changed refuses an anonymous caller."""

    def setUp(self):
        self.anon = Client()
        self.prop = make_property()

    def test_each_endpoint_refuses_an_anonymous_caller(self):
        checks = [
            ("get", "/api/pricing-groups/"),
            ("get", "/api/pricing-rules/"),
            ("get", "/api/stay-constraints/"),
            ("post", "/api/pricing/preview/"),
            ("post", "/api/properties/quotes/"),
        ]
        for method, url in checks:
            # A GET's `data` is a querystring to the test client, not a body.
            response = (
                self.anon.get(url)
                if method == "get"
                else self.anon.post(url, data="{}", content_type="application/json")
            )
            self.assertIn(response.status_code, (401, 403), f"{method.upper()} {url}")

    def test_the_preview_never_reaches_the_engine_without_a_role(self):
        response = self.anon.post(
            "/api/pricing/preview/",
            data=json.dumps({
                "propertyId": str(self.prop.id),
                "checkIn": day(30).isoformat(),
                "checkOut": day(32).isoformat(),
            }),
            content_type="application/json",
        )
        self.assertIn(response.status_code, (401, 403))
        self.assertNotIn(b"rules", response.content)


class PublicListingLeaksNothingExtraTests(TestCase):
    def setUp(self):
        from django.conf import settings

        settings.ALLOWED_HOSTS.append("testserver")
        self.anon = Client()
        self.prop = make_property(wifi_password="hunter2", floor="3rd")

    def test_the_public_listing_carries_no_secrets(self):
        ci = day(30)
        response = self.anon.get(
            f"/api/booking/properties/?check_in={ci}&check_out={ci + timedelta(days=2)}"
        )
        body = response.content.decode()
        self.assertEqual(response.status_code, 200)
        for secret in ("hunter2", "wifiPassword", "doorCode", "lockbox"):
            self.assertNotIn(secret, body)
