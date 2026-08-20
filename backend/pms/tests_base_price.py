"""Base prices: the nightly rate every other rule then works from.

Operators were setting a nightly rate with dateless per-night seasonal rules,
which worked but lied about itself — a rate with no dates is not seasonal, and
it made calculate_price report has_seasonal on stays that had no season. The
base_price rule type names the thing properly, and 0032 restructures the seeded
groups so "Base Prices" comes first and "Seasonal Pricing" holds actual
date-range rules.
"""

from decimal import Decimal

from django.apps import apps as django_apps
from django.core.exceptions import ValidationError
from django.test import TestCase

from .migrations._0032_helpers import restructure_groups
from .models import PricingGroup, PricingRule
from .tests import day, make_property
from .views._pricing import calculate_price
from .views._pricing_engine import evaluate_stay
from .views._pricing_validation import validate_pricing_rule


def base_price_rule(group, value, **overrides):
    defaults = {
        "group": group,
        "name": "Base rate",
        "rule_type": PricingRule.RuleType.BASE_PRICE,
        "scope": "all",
        "enabled": True,
        "application": PricingRule.Application.PER_NIGHT,
        "adjustment_type": PricingRule.AdjustmentType.FIXED_PRICE,
        "adjustment_value": Decimal(value),
    }
    defaults.update(overrides)
    return PricingRule.objects.create(**defaults)


class BasePriceEngineTests(TestCase):
    def setUp(self):
        # Unpriced: these tests supply the rate themselves, and a property-scoped
        # rule from the factory would out-rank every rule they build.
        self.prop = make_property(base_price_eur=None)
        self.base = PricingGroup.objects.get(platform="airstay", name="Base Prices")
        self.seasonal = PricingGroup.objects.get(platform="airstay", name="Seasonal Pricing")

    def test_a_base_price_sets_the_rate_of_every_night(self):
        base_price_rule(self.base, "80.00")
        result = evaluate_stay(self.prop, day(30), day(32))
        self.assertEqual([row["rate"] for row in result["nightly"]], [Decimal("80.00")] * 2)

    def test_a_base_price_applies_on_every_date(self):
        """No dates means no date filter — that is the whole point of it."""
        base_price_rule(self.base, "80.00")
        far = evaluate_stay(self.prop, day(300), day(302))
        self.assertEqual(far["total"], Decimal("160.00"))

    def test_a_seasonal_rule_overrides_the_base_price(self):
        base_price_rule(self.base, "80.00")
        PricingRule.objects.create(
            group=self.seasonal,
            name="Summer",
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.PCT_INCREASE,
            adjustment_value=Decimal("10.00"),
            start_date=day(30),
            end_date=day(32),
        )
        result = evaluate_stay(self.prop, day(30), day(32))
        # 80 base, then +10% from the seasonal group that runs after it.
        self.assertEqual([row["rate"] for row in result["nightly"]], [Decimal("88.00")] * 2)

    def test_a_base_price_is_not_reported_as_seasonal(self):
        """The old dateless-seasonal workaround set has_seasonal on every stay."""
        base_price_rule(self.base, "80.00")
        breakdown = calculate_price(self.prop, day(30), day(32))
        self.assertFalse(breakdown["has_seasonal"])

    def test_the_most_specific_base_price_wins(self):
        """Base Prices is "specific", so the narrowest matching rule is the rate."""
        base_price_rule(self.base, "99.00", scope="bedroom_group", bedroom_group=1, sort_order=0)
        base_price_rule(self.base, "80.00", scope="all", sort_order=1)
        result = evaluate_stay(self.prop, day(30), day(32))
        self.assertEqual(result["nightly"][0]["rate"], Decimal("99.00"))


class BasePriceValidationTests(TestCase):
    def setUp(self):
        self.base = PricingGroup.objects.get(platform="airstay", name="Base Prices")

    def build(self, **overrides):
        rule = PricingRule(
            group=self.base,
            name="Base rate",
            rule_type=PricingRule.RuleType.BASE_PRICE,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("80.00"),
        )
        for key, value in overrides.items():
            setattr(rule, key, value)
        return rule

    def test_a_well_formed_base_price_validates(self):
        validate_pricing_rule(self.build())  # does not raise

    def test_a_base_price_cannot_apply_to_the_whole_stay(self):
        with self.assertRaises(ValidationError):
            validate_pricing_rule(self.build(application=PricingRule.Application.WHOLE_STAY))

    def test_a_base_price_must_be_a_fixed_nightly_amount(self):
        with self.assertRaises(ValidationError):
            validate_pricing_rule(
                self.build(adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE)
            )

    def test_a_base_price_cannot_carry_dates(self):
        """Dates would make it a seasonal rule wearing the wrong name."""
        with self.assertRaises(ValidationError):
            validate_pricing_rule(self.build(start_date=day(1)))


class GroupRestructureTests(TestCase):
    """0032 runs during test setup, so the seeded state is already restructured."""

    def test_groups_run_in_the_new_order(self):
        self.assertEqual(
            [
                (g.name, g.behaviour)
                for g in PricingGroup.objects.filter(platform="airstay").order_by("sort_order")
            ],
            [
                # 0033 then gave the two order-sensitive groups behaviours
                # that pick a winner for themselves — see
                # tests_group_behaviour.
                ("Base Prices", "specific"),
                ("Seasonal Pricing", "stack"),
                ("Length of Stay Discounts", "best"),
                ("Booking Discounts", "stack"),
                ("Promotions", "stack"),
            ],
        )

    def test_the_non_refundable_rule_kept_a_sensible_home(self):
        rule = PricingRule.objects.get(rule_type=PricingRule.RuleType.NON_REFUNDABLE)
        self.assertEqual(rule.group.name, "Booking Discounts")

    def test_the_long_stay_tiers_are_untouched(self):
        group = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        self.assertEqual(group.rules.filter(rule_type=PricingRule.RuleType.LONG_STAY).count(), 6)


class RestructureHelperTests(TestCase):
    """The conversion itself, driven against rows built to look like real ones."""

    def setUp(self):
        # 0032 predates platforms: its helper matches groups by name alone, so
        # re-running it here against both platforms' groups would be ambiguous.
        # These tests are about what 0032 did, so give it the one-platform
        # world it actually ran in.
        PricingGroup.objects.filter(platform="fleet").delete()
        self.base = PricingGroup.objects.get(platform="airstay", name="Base Prices")
        self.prop = make_property()

    def test_a_dateless_per_night_fixed_price_rule_becomes_a_base_price(self):
        rule = PricingRule.objects.create(
            group=self.base,
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="bedroom_group",
            bedroom_group=2,
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("45.00"),
        )
        restructure_groups(django_apps)
        rule.refresh_from_db()
        self.assertEqual(rule.rule_type, PricingRule.RuleType.BASE_PRICE)

    def test_a_dated_seasonal_rule_is_left_alone(self):
        rule = PricingRule.objects.create(
            group=self.base,
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("45.00"),
            start_date=day(1),
            end_date=day(30),
        )
        restructure_groups(django_apps)
        rule.refresh_from_db()
        self.assertEqual(rule.rule_type, PricingRule.RuleType.SEASONAL)

    def test_a_percentage_rule_is_left_alone(self):
        """A dateless percentage rule is not a base price — it has nothing to
        be a price of."""
        rule = PricingRule.objects.create(
            group=self.base,
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.PCT_INCREASE,
            adjustment_value=Decimal("10.00"),
        )
        restructure_groups(django_apps)
        rule.refresh_from_db()
        self.assertEqual(rule.rule_type, PricingRule.RuleType.SEASONAL)

    def test_running_it_again_changes_nothing(self):
        restructure_groups(django_apps)
        restructure_groups(django_apps)
        self.assertEqual(
            [g.name for g in PricingGroup.objects.order_by("sort_order")],
            [
                "Base Prices",
                "Seasonal Pricing",
                "Length of Stay Discounts",
                "Booking Discounts",
                "Promotions",
            ],
        )
        self.assertEqual(PricingGroup.objects.filter(name="Booking Discounts").count(), 1)
