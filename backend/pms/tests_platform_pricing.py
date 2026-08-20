"""AirStay and Fleet price independently.

Both platforms lived off one set of pricing groups, so a rate keyed on bedroom
count, a 28-night long-stay tier and a two-night minimum written for
apartments were all being applied to vehicle hires as well. A group and a stay
constraint now belong to exactly one platform, and the engine only ever loads
the ones belonging to the property it is pricing.
"""

import json
from decimal import Decimal

from django.test import Client, TestCase

from .models import PricingGroup, PricingRule, Property, StayConstraint
from .tests import day, make_admin, make_property
from .views._pricing import calculate_price
from .views._pricing_engine import base_rate_for, evaluate_stay


def group(name, platform="airstay"):
    return PricingGroup.objects.get(platform=platform, name=name)


def make_vehicle(**overrides):
    defaults = {"platform": Property.Platform.FLEET, "bedrooms": 0, "base_price_eur": None}
    defaults.update(overrides)
    return make_property(**defaults)


def base_price(platform, value, **overrides):
    defaults = {
        "group": group("Base Prices", platform),
        "name": f"{platform} base rate",
        "rule_type": PricingRule.RuleType.BASE_PRICE,
        "scope": "all",
        "enabled": True,
        "application": PricingRule.Application.PER_NIGHT,
        "adjustment_type": PricingRule.AdjustmentType.FIXED_PRICE,
        "adjustment_value": Decimal(value),
    }
    defaults.update(overrides)
    return PricingRule.objects.create(**defaults)


class SeededPlatformsTests(TestCase):
    def test_each_platform_has_its_own_five_groups(self):
        for platform in ("airstay", "fleet"):
            names = list(
                PricingGroup.objects.filter(platform=platform)
                .order_by("sort_order")
                .values_list("name", flat=True)
            )
            self.assertEqual(
                names,
                [
                    "Base Prices",
                    "Seasonal Pricing",
                    "Length of Stay Discounts",
                    "Booking Discounts",
                    "Promotions",
                ],
                platform,
            )

    def test_two_platforms_may_share_a_group_name(self):
        self.assertEqual(PricingGroup.objects.filter(name="Base Prices").count(), 2)

    def test_the_seeded_rules_belong_to_airstay(self):
        for rule in PricingRule.objects.all():
            self.assertEqual(rule.group.platform, "airstay")

    def test_fleet_starts_with_no_rules(self):
        self.assertEqual(PricingRule.objects.filter(group__platform="fleet").count(), 0)


class RulesDoNotCrossPlatformsTests(TestCase):
    def setUp(self):
        self.apartment = make_property(bedrooms=1, base_price_eur=None)
        self.vehicle = make_vehicle()

    def test_an_airstay_rate_does_not_price_a_vehicle(self):
        base_price("airstay", "50.00")
        self.assertEqual(base_rate_for(self.apartment), Decimal("50.00"))
        self.assertEqual(base_rate_for(self.vehicle), Decimal("0.00"))

    def test_a_fleet_rate_does_not_price_an_apartment(self):
        base_price("fleet", "40.00")
        self.assertEqual(base_rate_for(self.vehicle), Decimal("40.00"))
        self.assertEqual(base_rate_for(self.apartment), Decimal("0.00"))

    def test_each_platform_keeps_its_own_rate(self):
        base_price("airstay", "50.00")
        base_price("fleet", "40.00")
        self.assertEqual(base_rate_for(self.apartment), Decimal("50.00"))
        self.assertEqual(base_rate_for(self.vehicle), Decimal("40.00"))

    def test_an_apartment_long_stay_tier_does_not_discount_a_hire(self):
        """The seeded ladder gives 50% off 28+ nights. A month-long car hire
        must not inherit that."""
        base_price("fleet", "40.00")
        result = evaluate_stay(self.vehicle, day(30), day(60))  # 30 days
        self.assertEqual(result["total"], Decimal("1200.00"))  # 30 x 40, undiscounted

    def test_the_same_stay_on_airstay_does_get_the_tier(self):
        base_price("airstay", "40.00")
        result = evaluate_stay(self.apartment, day(30), day(60))
        self.assertEqual(result["total"], Decimal("600.00"))  # 1200 less 50%

    def test_a_fleet_rule_reaches_a_vehicle_through_the_engine(self):
        PricingRule.objects.create(
            group=group("Length of Stay Discounts", "fleet"),
            name="Weekly hire rate",
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=True,
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("10.00"),
            min_nights=7,
        )
        base_price("fleet", "40.00")
        result = evaluate_stay(self.vehicle, day(30), day(37))  # 7 days x 40 = 280
        self.assertEqual(result["total"], Decimal("252.00"))  # less 10%


class ConstraintsDoNotCrossPlatformsTests(TestCase):
    def setUp(self):
        self.apartment = make_property(bedrooms=1)
        self.vehicle = make_vehicle()
        base_price("fleet", "40.00")

    def test_an_apartment_minimum_stay_does_not_block_a_one_day_hire(self):
        StayConstraint.objects.create(
            platform="airstay",
            kind=StayConstraint.Kind.MIN_NIGHTS,
            value=3,
            scope="all",
            enabled=True,
        )
        hire = calculate_price(self.vehicle, day(30), day(31))
        self.assertEqual(hire["min_nights_required"], 0)
        self.assertEqual(hire["errors"], [])

        stay = calculate_price(self.apartment, day(30), day(31))
        self.assertIn("Minimum stay is 3 nights.", stay["errors"])

    def test_a_fleet_minimum_applies_only_to_fleet(self):
        StayConstraint.objects.create(
            platform="fleet",
            kind=StayConstraint.Kind.MIN_NIGHTS,
            value=2,
            scope="all",
            enabled=True,
        )
        self.assertIn(
            "Minimum stay is 2 nights.",
            calculate_price(self.vehicle, day(30), day(31))["errors"],
        )
        self.assertEqual(calculate_price(self.apartment, day(30), day(31))["errors"], [])


class PlatformScopedApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_group_list_defaults_to_airstay(self):
        data = self.client.get("/api/pricing-groups/").json()["pricingGroups"]
        self.assertEqual(len(data), 5)
        self.assertTrue(all(g["platform"] == "airstay" for g in data))

    def test_group_list_can_ask_for_fleet(self):
        data = self.client.get("/api/pricing-groups/?platform=fleet").json()["pricingGroups"]
        self.assertEqual(len(data), 5)
        self.assertTrue(all(g["platform"] == "fleet" for g in data))

    def test_an_unknown_platform_falls_back_to_airstay(self):
        data = self.client.get("/api/pricing-groups/?platform=nonsense").json()["pricingGroups"]
        self.assertTrue(all(g["platform"] == "airstay" for g in data))

    def test_a_created_group_lands_on_the_requested_platform(self):
        response = self.client.post(
            "/api/pricing-groups/?platform=fleet",
            data=json.dumps({"name": "Weekend Rates", "sortOrder": 9}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["pricingGroup"]["platform"], "fleet")

    def test_constraints_are_listed_per_platform(self):
        StayConstraint.objects.create(
            platform="fleet", kind=StayConstraint.Kind.MIN_NIGHTS, value=2, scope="all"
        )
        airstay = self.client.get("/api/stay-constraints/").json()["stayConstraints"]
        fleet = self.client.get("/api/stay-constraints/?platform=fleet").json()["stayConstraints"]
        self.assertEqual(airstay, [])
        self.assertEqual(len(fleet), 1)
