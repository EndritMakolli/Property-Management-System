"""Tests for the unified pricing model, its migrations, and its endpoints."""

from datetime import date, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import Client, TestCase

from .models import PricingGroup, PricingRule, StayConstraint
from .tests import day, make_admin, make_property


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

    def test_four_groups_exist_in_order(self):
        self.assertEqual(
            [(g.name, g.behaviour) for g in PricingGroup.objects.all()],
            [
                ("Seasonal Pricing", "stack"),
                ("Stay Discounts", "exclusive"),
                ("Booking Discounts", "stack"),
                ("Promotions", "stack"),
            ],
        )

    def test_default_long_stay_tiers_are_real_rules(self):
        group = PricingGroup.objects.get(name="Stay Discounts")
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
        # Biggest tier first, so "lowest sort_order wins" reproduces
        # the old "highest applicable tier" behaviour.

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


class PromoMigrationTests(TestCase):
    """The 0028 conversion must not lose a promo code or its booking link."""

    def test_promo_rows_convert_and_the_booking_link_follows(self):
        from django.apps import apps as global_apps

        from .migrations._0028_helpers import convert_promos
        from .models import BookingRequest, PromoCode

        prop = make_property()
        promo = PromoCode.objects.create(
            code="summer25",
            discount_type="percentage",
            discount_value=Decimal("25.00"),
            scope="all",
            usage_limit=5,
            usage_count=2,
            active=True,
        )
        req = BookingRequest.objects.create(
            property=prop,
            guest_name="Test Guest",
            guest_email="g@example.com",
            guest_phone="+355000000",
            check_in=day(10),
            check_out=day(12),
            promo_code=promo,
        )

        convert_promos(global_apps)

        rule = PricingRule.objects.get(code="SUMMER25")
        self.assertEqual(rule.rule_type, PricingRule.RuleType.PROMO)
        self.assertEqual(rule.group.name, "Promotions")
        self.assertEqual(rule.adjustment_type, PricingRule.AdjustmentType.PCT_DECREASE)
        self.assertEqual(rule.adjustment_value, Decimal("25.00"))
        self.assertEqual(rule.usage_count, 2)
        req.refresh_from_db()
        self.assertEqual(req.promo_rule_id, rule.pk)
