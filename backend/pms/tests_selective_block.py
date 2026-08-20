"""Excluding a chosen discount, rather than all of them.

The first version of BLOCK_DISCOUNTS used the engine's night lock, which is
absolute: a locked night leaves the discountable subtotal entirely, so promo
codes were collateral damage when the intent was only to fence off the
long-stay ladder.

A block may now name what it excludes — a whole group, or one rule. Naming
nothing still means everything, which is the old behaviour and the safe
default.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from .models import PricingGroup, PricingRule
from .tests import day, make_property
from .views._pricing_engine import APPLIED, evaluate_stay
from .views._pricing_validation import validate_pricing_rule


def group(name):
    return PricingGroup.objects.get(platform="airstay", name=name)


def block(start, end, **overrides):
    defaults = {
        "group": group("Seasonal Pricing"),
        "name": "Peak dates",
        "rule_type": PricingRule.RuleType.BLOCK_DISCOUNTS,
        "scope": "all",
        "enabled": True,
        "application": PricingRule.Application.PER_NIGHT,
        "is_final": True,
        "start_date": start,
        "end_date": end,
    }
    defaults.update(overrides)
    return PricingRule.objects.create(**defaults)


def promo(pct="10.00"):
    return PricingRule.objects.create(
        group=group("Promotions"),
        name="Ten off",
        rule_type=PricingRule.RuleType.PROMO,
        code="TEN",
        scope="all",
        enabled=True,
        application=PricingRule.Application.WHOLE_STAY,
        adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
        adjustment_value=Decimal(pct),
    )


class SelectiveBlockTests(TestCase):
    def setUp(self):
        # 50/night, and the seeded ladder gives 15% off a 7-night stay.
        self.prop = make_property(base_price_eur=Decimal("50.00"))
        self.tiers = group("Length of Stay Discounts")
        self.seven_night_tier = self.tiers.rules.get(min_nights=7)

    def test_without_a_block_the_tier_applies(self):
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("297.50"))  # 350 less 15%

    def test_blocking_a_group_stops_only_that_group(self):
        block(day(30), day(37), blocks_group=self.tiers)
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("350.00"))

    def test_a_promo_still_reaches_nights_blocked_only_for_tiers(self):
        """The whole point: fence off the ladder, keep the code working."""
        block(day(30), day(37), blocks_group=self.tiers)
        code = promo()
        result = evaluate_stay(self.prop, day(30), day(37), promo_rule=code)
        self.assertEqual(result["total"], Decimal("315.00"))  # 350 less 10%
        report = next(r for r in result["reports"] if r["id"] == str(code.pk))
        self.assertEqual(report["status"], APPLIED)

    def test_blocking_one_rule_only_stops_that_rule(self):
        """Naming a single tier does NOT stop the ladder: the group picks the
        best of whatever is left, so the 5-night 10% tier takes over from the
        blocked 7-night 15% one. Blocking the group is what fences off a
        ladder — see test_blocking_a_group_stops_only_that_group."""
        block(day(30), day(37), blocks_rule=self.seven_night_tier)
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("315.00"))  # 350 less 10%

        report = next(
            r for r in result["reports"] if r["id"] == str(self.seven_night_tier.pk)
        )
        self.assertNotEqual(report["status"], APPLIED)

    def test_blocking_one_rule_leaves_a_promo_alone(self):
        block(day(30), day(37), blocks_rule=self.seven_night_tier)
        code = promo()
        result = evaluate_stay(self.prop, day(30), day(37), promo_rule=code)
        # 5-night tier 10% -> 315, then the code takes 10% of that.
        self.assertEqual(result["total"], Decimal("283.50"))

    def test_naming_nothing_still_blocks_everything(self):
        block(day(30), day(37))
        code = promo()
        result = evaluate_stay(self.prop, day(30), day(37), promo_rule=code)
        self.assertEqual(result["total"], Decimal("350.00"))

    def test_a_block_protects_only_the_nights_it_covers(self):
        # 3 of 7 nights fenced off from the ladder.
        block(day(30), day(32), blocks_group=self.tiers)
        result = evaluate_stay(self.prop, day(30), day(37))
        # 3 x 50 untouched = 150; the other 4 x 50 = 200 less 15% = 170.
        self.assertEqual(result["total"], Decimal("320.00"))

    def test_a_partial_block_still_lets_a_promo_reach_every_night(self):
        block(day(30), day(32), blocks_group=self.tiers)
        code = promo()
        result = evaluate_stay(self.prop, day(30), day(37), promo_rule=code)
        # Tier: 200 -> 170, so 320 on the table; promo takes 10% of all of it.
        self.assertEqual(result["total"], Decimal("288.00"))

    def test_the_tier_reports_what_it_actually_took(self):
        block(day(30), day(32), blocks_group=self.tiers)
        result = evaluate_stay(self.prop, day(30), day(37))
        report = next(
            r for r in result["reports"] if r["id"] == str(self.seven_night_tier.pk)
        )
        self.assertEqual(report["amount"], Decimal("30.00"))  # 15% of 200

    def test_blocking_a_group_that_never_applied_changes_nothing(self):
        block(day(30), day(37), blocks_group=group("Promotions"))
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("297.50"))

    def test_the_nightly_rates_are_never_touched_by_a_block(self):
        block(day(30), day(37), blocks_group=self.tiers)
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual([n["rate"] for n in result["nightly"]], [Decimal("50.00")] * 7)


class SelectiveBlockValidationTests(TestCase):
    def setUp(self):
        self.tiers = group("Length of Stay Discounts")

    def build(self, **overrides):
        rule = PricingRule(
            group=group("Seasonal Pricing"),
            name="Peak dates",
            rule_type=PricingRule.RuleType.BLOCK_DISCOUNTS,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            is_final=True,
            start_date=day(30),
            end_date=day(37),
        )
        for key, value in overrides.items():
            setattr(rule, key, value)
        return rule

    def test_naming_a_group_is_valid(self):
        validate_pricing_rule(self.build(blocks_group=self.tiers))

    def test_naming_a_rule_is_valid(self):
        validate_pricing_rule(self.build(blocks_rule=self.tiers.rules.first()))

    def test_naming_both_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_pricing_rule(
                self.build(blocks_group=self.tiers, blocks_rule=self.tiers.rules.first())
            )

    def test_only_a_block_rule_may_name_a_target(self):
        rule = PricingRule(
            group=group("Seasonal Pricing"),
            name="Summer",
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("90.00"),
            blocks_group=self.tiers,
        )
        with self.assertRaises(ValidationError):
            validate_pricing_rule(rule)
