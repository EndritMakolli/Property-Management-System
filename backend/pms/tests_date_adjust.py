"""Increases and decreases over a date range, and how they combine.

A stack group compounds: +10% then +15% is 1.10 x 1.15, or +26.5%. That is
correct arithmetic and the wrong mental model for seasonal loading, where an
operator layering a 10% summer rise, a 15% peak-fortnight rise and a 30%
festival rise expects to read 55%, not 64.45%.

A rule marked `stacks` therefore adds its percentage to the other stacking
rules covering the same night, and the sum is applied once. Rules left
unstacked compound as before, so nothing that already existed changes.
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


def adjust(pct, start, end, stacks=True, **overrides):
    defaults = {
        "group": group("Seasonal Pricing"),
        "name": f"{pct}%",
        "rule_type": PricingRule.RuleType.DATE_ADJUST,
        "scope": "all",
        "enabled": True,
        "application": PricingRule.Application.PER_NIGHT,
        "adjustment_type": PricingRule.AdjustmentType.PCT_INCREASE,
        "adjustment_value": Decimal(pct),
        "stacks": stacks,
        "start_date": start,
        "end_date": end,
    }
    defaults.update(overrides)
    return PricingRule.objects.create(**defaults)


class DateAdjustTests(TestCase):
    def setUp(self):
        self.prop = make_property(base_price_eur=Decimal("50.00"))

    def rates(self, nights=3):
        result = evaluate_stay(self.prop, day(30), day(30 + nights))
        return [row["rate"] for row in result["nightly"]]

    def test_a_single_increase_raises_the_nights_it_covers(self):
        adjust("10.00", day(30), day(31))
        self.assertEqual(self.rates(), [Decimal("55.00"), Decimal("55.00"), Decimal("50.00")])

    def test_a_decrease_lowers_them(self):
        adjust("20.00", day(30), day(31), adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE)
        self.assertEqual(self.rates(), [Decimal("40.00"), Decimal("40.00"), Decimal("50.00")])

    def test_a_fixed_amount_works_too(self):
        adjust(
            "12.00", day(30), day(31),
            adjustment_type=PricingRule.AdjustmentType.FIXED_INCREASE,
        )
        self.assertEqual(self.rates(), [Decimal("62.00"), Decimal("62.00"), Decimal("50.00")])


class StackingTests(TestCase):
    def setUp(self):
        self.prop = make_property(base_price_eur=Decimal("50.00"))

    def rates(self, nights=3):
        result = evaluate_stay(self.prop, day(30), day(30 + nights))
        return [row["rate"] for row in result["nightly"]]

    def test_two_stacking_percentages_add(self):
        adjust("10.00", day(30), day(32))
        adjust("15.00", day(31), day(32))
        # Night 30: +10% = 55. Nights 31-32: +25% = 62.50, NOT 1.10 x 1.15.
        self.assertEqual(
            self.rates(), [Decimal("55.00"), Decimal("62.50"), Decimal("62.50")]
        )

    def test_three_stacking_percentages_add(self):
        """The operator's example: 10 + 15 + 30 reads as 55."""
        adjust("10.00", day(30), day(32))
        adjust("15.00", day(31), day(32))
        adjust("30.00", day(32), day(32))
        self.assertEqual(self.rates()[2], Decimal("77.50"))  # 50 x 1.55

    def test_unstacked_rules_still_compound(self):
        adjust("10.00", day(30), day(32), stacks=False)
        adjust("15.00", day(30), day(32), stacks=False)
        # 50 x 1.10 x 1.15 = 63.25
        self.assertEqual(self.rates()[0], Decimal("63.25"))

    def test_a_stacking_increase_and_decrease_net_off(self):
        adjust("30.00", day(30), day(32))
        adjust(
            "10.00", day(30), day(32),
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
        )
        self.assertEqual(self.rates()[0], Decimal("60.00"))  # 50 x 1.20

    def test_a_stack_that_nets_below_zero_floors_at_zero(self):
        adjust(
            "150.00", day(30), day(32),
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
        )
        self.assertEqual(self.rates()[0], Decimal("0.00"))

    def test_each_stacked_rule_reports_its_own_share(self):
        first = adjust("10.00", day(30), day(30))
        second = adjust("15.00", day(30), day(30))
        result = evaluate_stay(self.prop, day(30), day(31))
        reports = {r["id"]: r for r in result["reports"]}
        self.assertEqual(reports[str(first.pk)]["status"], APPLIED)
        self.assertEqual(reports[str(second.pk)]["status"], APPLIED)
        # 50 -> 62.50 is 12.50 shared out 10:15.
        total = reports[str(first.pk)]["amount"] + reports[str(second.pk)]["amount"]
        self.assertEqual(total, Decimal("12.50"))

    def test_a_stacked_rule_still_counts_as_seasonal_pricing(self):
        adjust("10.00", day(30), day(32))
        result = evaluate_stay(self.prop, day(30), day(33))
        self.assertTrue(result["has_seasonal"])

    def test_a_fixed_price_rule_is_applied_before_the_stack(self):
        """The stack loads a rate, so the rate has to be set first."""
        PricingRule.objects.create(
            group=group("Seasonal Pricing"),
            name="Festival rate",
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("100.00"),
            start_date=day(30),
            end_date=day(32),
            sort_order=0,
        )
        adjust("10.00", day(30), day(32), sort_order=1)
        self.assertEqual(self.rates()[0], Decimal("110.00"))


class DateAdjustValidationTests(TestCase):
    def build(self, **overrides):
        rule = PricingRule(
            group=group("Seasonal Pricing"),
            name="Summer loading",
            rule_type=PricingRule.RuleType.DATE_ADJUST,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.PCT_INCREASE,
            adjustment_value=Decimal("10.00"),
            start_date=day(30),
            end_date=day(40),
        )
        for key, value in overrides.items():
            setattr(rule, key, value)
        return rule

    def test_a_well_formed_adjustment_validates(self):
        validate_pricing_rule(self.build())

    def test_it_must_be_per_night(self):
        with self.assertRaises(ValidationError):
            validate_pricing_rule(
                self.build(application=PricingRule.Application.WHOLE_STAY)
            )

    def test_it_cannot_set_a_fixed_nightly_price(self):
        """That is what the seasonal rate rule is for."""
        with self.assertRaises(ValidationError):
            validate_pricing_rule(
                self.build(adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE)
            )

    def test_an_end_before_its_start_is_rejected(self):
        """Covers no nights at all, so it silently does nothing — which reads
        as "my rule is being ignored" rather than as a mistake."""
        with self.assertRaisesMessage(ValidationError, "after"):
            validate_pricing_rule(self.build(start_date=day(40), end_date=day(30)))

    def test_a_single_day_range_is_fine(self):
        validate_pricing_rule(self.build(start_date=day(30), end_date=day(30)))

    def test_stacking_is_refused_in_a_group_that_applies_one_rule(self):
        """Pass 1 picks the single winner before it builds the stack, so the
        setting would silently do nothing there."""
        exclusive = PricingGroup.objects.create(
            name="One Winner", platform="airstay", sort_order=60, behaviour="exclusive"
        )
        with self.assertRaisesMessage(ValidationError, "nothing can stack"):
            validate_pricing_rule(self.build(group=exclusive, stacks=True))

    def test_stacking_is_fine_in_a_stack_group(self):
        validate_pricing_rule(self.build(stacks=True))

    def test_only_an_adjustment_may_stack(self):
        rule = self.build(
            rule_type=PricingRule.RuleType.LONG_STAY,
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            start_date=None,
            end_date=None,
            stacks=True,
        )
        with self.assertRaises(ValidationError):
            validate_pricing_rule(rule)


class StacksSurvivesTheApiTests(TestCase):
    """`stacks` was defined on the model and sent by the form, but the API
    neither saved nor returned it, so the checkbox did nothing at all."""

    def setUp(self):
        from django.test import Client

        from .tests import make_admin

        self.client = Client()
        make_admin(self.client)

    def payload(self, **overrides):
        body = {
            "groupId": str(group("Seasonal Pricing").id),
            "ruleType": "date_adjust",
            "application": "per_night",
            "scope": "all",
            "adjustmentType": "pct_increase",
            "adjustmentValue": "10.00",
            "startDate": day(30).isoformat(),
            "endDate": day(40).isoformat(),
            "stacks": True,
        }
        body.update(overrides)
        return body

    def test_a_created_rule_keeps_its_stack_setting(self):
        import json

        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps(self.payload()),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["pricingRule"]["stacks"])
        self.assertTrue(PricingRule.objects.get(pk=response.json()["pricingRule"]["id"]).stacks)

    def test_it_can_be_turned_off_again(self):
        import json

        created = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps(self.payload()),
            content_type="application/json",
        ).json()["pricingRule"]
        response = self.client.patch(
            f"/api/pricing-rules/{created['id']}/",
            data=json.dumps({"stacks": False}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["pricingRule"]["stacks"])

    def test_a_reversed_range_is_refused_by_the_endpoint(self):
        import json

        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps(
                self.payload(startDate=day(40).isoformat(), endDate=day(30).isoformat())
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
