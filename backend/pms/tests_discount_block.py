"""Excluding whole-stay discounts over a date range.

A fixed seasonal rate can already protect its nights by setting is_final, but
that requires setting a price. Peak dates often need the opposite: keep the
ordinary rate, just stop the long-stay ladder eating into it.

BLOCK_DISCOUNTS is a per-night rule that changes no rate and locks the nights
it covers. Locking is the engine's existing mechanism and it is absolute: a
locked night is removed from the discountable subtotal, so promo codes and
non-refundable discounts cannot reach it either. That is deliberate and the
UI says so.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from .models import PricingGroup, PricingRule
from .tests import day, make_property
from .views._pricing import calculate_price
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


class BlockDiscountsEngineTests(TestCase):
    def setUp(self):
        # 50/night from the factory's base-price rule.
        self.prop = make_property(base_price_eur=Decimal("50.00"))

    def test_a_blocked_stay_keeps_its_ordinary_rate(self):
        block(day(30), day(37))
        result = evaluate_stay(self.prop, day(30), day(37))  # 7 nights
        self.assertEqual([n["rate"] for n in result["nightly"]], [Decimal("50.00")] * 7)

    def test_a_blocked_stay_loses_its_long_stay_discount(self):
        block(day(30), day(37))
        result = evaluate_stay(self.prop, day(30), day(37))
        # Without the block the seeded 7-night tier takes 15% off 350.
        self.assertEqual(result["total"], Decimal("350.00"))

    def test_the_same_stay_is_discounted_without_the_block(self):
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("297.50"))  # 350 less 15%

    def test_only_the_nights_it_covers_are_protected(self):
        block(day(30), day(32))  # 3 of the 7 nights
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["protected"], Decimal("150.00"))  # 3 x 50
        # 4 unprotected nights = 200, less the 15% seven-night tier = 170.
        self.assertEqual(result["total"], Decimal("320.00"))

    def test_it_reports_itself_as_applied(self):
        rule = block(day(30), day(37))
        result = evaluate_stay(self.prop, day(30), day(37))
        report = next(r for r in result["reports"] if r["id"] == str(rule.pk))
        self.assertEqual(report["status"], APPLIED)
        self.assertEqual(report["amount"], Decimal("0.00"))

    def test_it_needs_no_amount_to_work(self):
        rule = block(day(30), day(37))
        self.assertIsNone(rule.adjustment_value)
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("350.00"))

    def test_a_block_outside_the_stay_does_nothing(self):
        block(day(100), day(110))
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("297.50"))

    def test_a_disabled_block_does_nothing(self):
        block(day(30), day(37), enabled=False)
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("297.50"))

    def test_a_seasonal_rate_still_applies_on_blocked_nights(self):
        """The block stops discounts, not pricing. Its own group runs first,
        so a later seasonal rate must still be free to set the rate."""
        PricingRule.objects.create(
            group=group("Seasonal Pricing"),
            name="Peak rate",
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("90.00"),
            start_date=day(30),
            end_date=day(37),
            sort_order=0,
        )
        block(day(30), day(37), sort_order=1)
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual([n["rate"] for n in result["nightly"]], [Decimal("90.00")] * 7)
        self.assertEqual(result["total"], Decimal("630.00"))  # 7 x 90, undiscounted


class BlockOutsideTheStayTests(TestCase):
    """A block reaches only the nights inside its own window.

    The operator's case: exclusions run until 20 August and the guest stays
    18-25 August. The first three nights are fenced off; the rest must still
    take the long-stay discount.
    """

    def setUp(self):
        self.prop = make_property(base_price_eur=Decimal("50.00"))

    def test_nights_after_the_block_ends_still_get_the_discount(self):
        block(day(30), day(32))  # "until the 20th"
        result = evaluate_stay(self.prop, day(30), day(38))  # 8 nights

        # 3 blocked nights x 50 = 150, untouched.
        self.assertEqual(result["protected"], Decimal("150.00"))
        # The other 5 x 50 = 250, less the seeded 7-night 15% tier = 212.50.
        self.assertEqual(result["total"], Decimal("362.50"))

    def test_the_discount_reports_what_it_took_from_the_open_nights(self):
        block(day(30), day(32))
        tier = PricingRule.objects.get(
            rule_type=PricingRule.RuleType.LONG_STAY, min_nights=7, scope="all"
        )
        result = evaluate_stay(self.prop, day(30), day(38))
        report = next(r for r in result["reports"] if r["id"] == str(tier.pk))
        self.assertEqual(report["amount"], Decimal("37.50"))  # 15% of 250

    def test_a_block_wholly_outside_the_stay_changes_nothing(self):
        block(day(60), day(70))
        result = evaluate_stay(self.prop, day(30), day(38))
        self.assertEqual(result["protected"], Decimal("0.00"))
        self.assertEqual(result["total"], Decimal("340.00"))  # 400 less 15%


class BlockDiscountsAndUnpricedNightsTests(TestCase):
    """A block must not disguise a night that has no price."""

    def setUp(self):
        self.prop = make_property(base_price_eur=None)

    def test_a_blocked_night_with_no_base_price_is_still_reported_unpriced(self):
        block(day(30), day(32))
        breakdown = calculate_price(self.prop, day(30), day(32))
        self.assertEqual(breakdown["total"], "0.00")
        self.assertTrue(breakdown["errors"])
        self.assertIn("base price", " ".join(breakdown["errors"]).lower())


class BlockDiscountsValidationTests(TestCase):
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

    def test_a_well_formed_block_validates(self):
        validate_pricing_rule(self.build())  # does not raise

    def test_it_needs_no_amount(self):
        """The generic 'enabled rules need an amount' check must not catch it."""
        validate_pricing_rule(self.build(adjustment_value=None))

    def test_it_cannot_carry_an_amount(self):
        with self.assertRaises(ValidationError):
            validate_pricing_rule(
                self.build(
                    adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
                    adjustment_value=Decimal("10.00"),
                )
            )

    def test_it_must_be_per_night(self):
        with self.assertRaises(ValidationError):
            validate_pricing_rule(
                self.build(application=PricingRule.Application.WHOLE_STAY)
            )
