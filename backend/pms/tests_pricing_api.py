"""Tests for the unified pricing model, its migrations, and its endpoints."""

import json
from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import Client, TestCase

from .models import BookingRequest, PricingGroup, PricingRule, StayConstraint
from .tests import day, make_admin, make_property
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


class RuleValidationTests(TestCase):
    def setUp(self):
        self.stack = PricingGroup.objects.get(name="Seasonal Pricing")
        self.exclusive = PricingGroup.objects.get(name="Stay Discounts")

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

    def test_exclusive_group_cannot_mix_applications(self):
        PricingRule.objects.create(
            group=self.exclusive,
            rule_type=PricingRule.RuleType.LONG_STAY,
            application=PricingRule.Application.WHOLE_STAY,
            min_nights=7,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("15.00"),
        )
        rule = self._rule(group=self.exclusive, application=PricingRule.Application.PER_NIGHT)
        with self.assertRaisesMessage(ValidationError, "Exclusive"):
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
            group=PricingGroup.objects.get(name="Promotions"),
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
