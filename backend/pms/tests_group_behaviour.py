"""Group behaviours that pick a winner without being sorted by hand.

Exclusive picks the FIRST eligible rule, so its sort order is load-bearing:
a tier ladder is only correct while somebody keeps it sorted biggest-first.
"Best" picks by outcome and "Most specific" picks by aim, so the rules in
those groups can be displayed in any order without moving a price.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from .models import PricingGroup, PricingRule
from .tests import day, make_property
from .views._pricing_engine import APPLIED, NOT_ELIGIBLE, OVERRIDDEN, evaluate_stay
from .views._pricing_validation import validate_pricing_rule


def report_for(result, rule):
    return next(r for r in result["reports"] if r["id"] == str(rule.pk))


class BestBehaviourTests(TestCase):
    def setUp(self):
        self.prop = make_property(base_price_eur=Decimal("100.00"))
        self.group = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        # Drop the seeded ladder so each test states its own.
        self.group.rules.all().delete()

    def tier(self, min_nights, pct, sort_order):
        return PricingRule.objects.create(
            group=self.group,
            name=f"{min_nights}+ nights",
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=True,
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal(pct),
            min_nights=min_nights,
            sort_order=sort_order,
        )

    def test_the_biggest_discount_wins_regardless_of_order(self):
        small = self.tier(5, "10.00", sort_order=0)  # deliberately sorted first
        big = self.tier(28, "50.00", sort_order=1)

        result = evaluate_stay(self.prop, day(30), day(60))  # 30 nights

        self.assertEqual(report_for(result, big)["status"], APPLIED)
        self.assertEqual(report_for(result, small)["status"], OVERRIDDEN)
        self.assertEqual(result["total"], Decimal("1500.00"))  # 3000 less 50%

    def test_the_loser_is_told_why_it_lost(self):
        small = self.tier(5, "10.00", sort_order=0)
        self.tier(28, "50.00", sort_order=1)
        result = evaluate_stay(self.prop, day(30), day(60))
        self.assertIn("28+ nights", report_for(result, small)["reason"])

    def test_a_tier_the_stay_is_too_short_for_never_wins(self):
        small = self.tier(5, "10.00", sort_order=0)
        big = self.tier(28, "50.00", sort_order=1)

        result = evaluate_stay(self.prop, day(30), day(37))  # 7 nights

        self.assertEqual(report_for(result, small)["status"], APPLIED)
        self.assertEqual(report_for(result, big)["status"], NOT_ELIGIBLE)
        self.assertEqual(result["total"], Decimal("630.00"))  # 700 less 10%

    def test_a_single_eligible_rule_simply_applies(self):
        only = self.tier(5, "10.00", sort_order=0)
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(report_for(result, only)["status"], APPLIED)

    def test_best_means_lowest_price_not_biggest_percentage(self):
        pct = self.tier(5, "10.00", sort_order=0)  # 10% of 700 = 70 off
        flat = PricingRule.objects.create(
            group=self.group,
            name="Flat 200 off",
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=True,
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.FIXED_DECREASE,
            adjustment_value=Decimal("200.00"),
            min_nights=5,
            sort_order=1,
        )

        result = evaluate_stay(self.prop, day(30), day(37))  # 7 nights, 700

        self.assertEqual(report_for(result, flat)["status"], APPLIED)
        self.assertEqual(report_for(result, pct)["status"], OVERRIDDEN)
        self.assertEqual(result["total"], Decimal("500.00"))

    def test_a_tie_falls_back_to_order_so_the_price_is_stable(self):
        first = self.tier(5, "10.00", sort_order=0)
        second = self.tier(5, "10.00", sort_order=1)
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(report_for(result, first)["status"], APPLIED)
        self.assertEqual(report_for(result, second)["status"], OVERRIDDEN)


class SeededLadderTests(TestCase):
    def test_the_seeded_ladder_picks_by_outcome(self):
        group = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        self.assertEqual(group.behaviour, PricingGroup.Behaviour.BEST)

    def test_reordering_the_ladder_cannot_change_the_price(self):
        """The exact bug this behaviour exists to prevent."""
        group = PricingGroup.objects.get(platform="airstay", name="Length of Stay Discounts")
        # Sort smallest-tier-first, the order that used to break pricing.
        for index, rule in enumerate(group.rules.order_by("min_nights")):
            rule.sort_order = index
            rule.save(update_fields=["sort_order"])

        prop = make_property(base_price_eur=Decimal("100.00"))
        result = evaluate_stay(prop, day(30), day(60))  # 30 nights -> 28+ tier
        self.assertEqual(result["total"], Decimal("1500.00"))


class SpecificBehaviourTests(TestCase):
    """Base Prices: the narrowest matching rate wins, in any order."""

    def setUp(self):
        # Unpriced: the rates under test are the ones created below.
        self.prop = make_property(bedrooms=2, base_price_eur=None)
        self.group = PricingGroup.objects.get(platform="airstay", name="Base Prices")

    def rate(self, value, sort_order, **scope):
        defaults = {
            "group": self.group,
            "name": f"Rate {value}",
            "rule_type": PricingRule.RuleType.BASE_PRICE,
            "enabled": True,
            "application": PricingRule.Application.PER_NIGHT,
            "adjustment_type": PricingRule.AdjustmentType.FIXED_PRICE,
            "adjustment_value": Decimal(value),
            "sort_order": sort_order,
            "scope": "all",
        }
        defaults.update(scope)
        return PricingRule.objects.create(**defaults)

    def test_a_property_rate_beats_a_bedroom_rate_and_an_all_rate(self):
        self.rate("30.00", 0)  # all, sorted first
        self.rate("45.00", 1, scope="bedroom_group", bedroom_group=2)
        exact = self.rate("62.00", 2, scope="property", property=self.prop)

        result = evaluate_stay(self.prop, day(30), day(32))

        self.assertEqual(result["nightly"][0]["rate"], Decimal("62.00"))
        self.assertEqual(report_for(result, exact)["status"], APPLIED)

    def test_a_bedroom_rate_beats_an_all_rate(self):
        self.rate("30.00", 0)
        bedrooms = self.rate("45.00", 1, scope="bedroom_group", bedroom_group=2)

        result = evaluate_stay(self.prop, day(30), day(32))

        self.assertEqual(result["nightly"][0]["rate"], Decimal("45.00"))
        self.assertEqual(report_for(result, bedrooms)["status"], APPLIED)

    def test_order_does_not_change_which_rate_wins(self):
        """Same three rates, reversed sort order, same answer."""
        self.rate("62.00", 0, scope="property", property=self.prop)
        self.rate("45.00", 1, scope="bedroom_group", bedroom_group=2)
        self.rate("30.00", 2)

        result = evaluate_stay(self.prop, day(30), day(32))
        self.assertEqual(result["nightly"][0]["rate"], Decimal("62.00"))

    def test_the_loser_is_told_it_was_out_aimed(self):
        broad = self.rate("30.00", 0)
        self.rate("45.00", 1, scope="bedroom_group", bedroom_group=2)
        result = evaluate_stay(self.prop, day(30), day(32))
        self.assertIn("narrowly", report_for(result, broad)["reason"])

    def test_a_rate_for_another_bedroom_count_does_not_apply(self):
        self.rate("30.00", 0)
        other = self.rate("99.00", 1, scope="bedroom_group", bedroom_group=5)

        result = evaluate_stay(self.prop, day(30), day(32))

        self.assertEqual(result["nightly"][0]["rate"], Decimal("30.00"))
        self.assertEqual(report_for(result, other)["status"], NOT_ELIGIBLE)

    def test_the_seeded_base_group_picks_by_aim(self):
        self.assertEqual(self.group.behaviour, PricingGroup.Behaviour.SPECIFIC)


class SingleWinnerValidationTests(TestCase):
    def test_a_best_group_cannot_mix_per_night_and_whole_stay_rules(self):
        group = PricingGroup.objects.create(
            name="Mixed Best", sort_order=51, behaviour=PricingGroup.Behaviour.BEST
        )
        PricingRule.objects.create(
            group=group,
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=True,
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("10.00"),
        )
        clashing = PricingRule(
            group=group,
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("80.00"),
        )
        with self.assertRaises(ValidationError):
            validate_pricing_rule(clashing)

    def test_a_stack_group_may_mix_freely(self):
        group = PricingGroup.objects.get(platform="airstay", name="Seasonal Pricing")
        PricingRule.objects.create(
            group=group,
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.PCT_INCREASE,
            adjustment_value=Decimal("10.00"),
        )
        mixed = PricingRule(
            group=group,
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("5.00"),
            start_date=day(1),
            end_date=day(90),
        )
        validate_pricing_rule(mixed)  # does not raise
