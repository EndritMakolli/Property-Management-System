"""Property.base_price_eur is gone; Base Prices rules are the only source.

A property used to carry its own nightly rate, which the engine used as the
starting price for every night. That made two places responsible for one
number, and the pricing page could not actually control what it displayed.

The rate now comes from the Base Prices group. Two consequences are load-
bearing and tested here:

  * A property with no matching base price has NO rate. It must refuse to
    quote rather than silently price the stay at zero.
  * Reservations were never priced from that column — they carry their own
    stored totals — so removing it must not disturb a single booking.
"""

from decimal import Decimal

from django.test import TestCase

from .models import PricingGroup, PricingRule, Property, Reservation
from .tests import day, make_property
from .views._pricing import calculate_price
from .views._pricing_engine import base_rate_for, evaluate_stay


def base_rule(value, **overrides):
    defaults = {
        "group": PricingGroup.objects.get(platform="airstay", name="Base Prices"),
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


class ColumnIsGoneTests(TestCase):
    def test_property_no_longer_carries_a_price(self):
        self.assertNotIn(
            "base_price_eur", [f.name for f in Property._meta.get_fields()]
        )


class BaseRateResolutionTests(TestCase):
    def setUp(self):
        # No rate of its own: these tests are about what resolves it.
        self.prop = make_property(bedrooms=2, base_price_eur=None)

    def test_no_base_price_means_no_rate(self):
        self.assertEqual(base_rate_for(self.prop), Decimal("0.00"))

    def test_an_all_properties_rate_applies(self):
        base_rule("40.00")
        self.assertEqual(base_rate_for(self.prop), Decimal("40.00"))

    def test_the_most_specific_rate_wins(self):
        base_rule("40.00")
        base_rule("55.00", scope="bedroom_group", bedroom_group=2)
        base_rule("70.00", scope="property", property=self.prop)
        self.assertEqual(base_rate_for(self.prop), Decimal("70.00"))

    def test_a_rate_aimed_elsewhere_is_ignored(self):
        base_rule("99.00", scope="bedroom_group", bedroom_group=9)
        self.assertEqual(base_rate_for(self.prop), Decimal("0.00"))

    def test_a_disabled_rate_is_ignored(self):
        base_rule("40.00", enabled=False)
        self.assertEqual(base_rate_for(self.prop), Decimal("0.00"))


class PricingWithoutAPropertyPriceTests(TestCase):
    def setUp(self):
        self.prop = make_property(bedrooms=1, base_price_eur=None)

    def test_a_base_price_rule_prices_the_stay(self):
        base_rule("40.00")
        result = evaluate_stay(self.prop, day(30), day(32))
        self.assertEqual(result["total"], Decimal("80.00"))

    def test_an_unpriced_property_refuses_to_quote(self):
        breakdown = calculate_price(self.prop, day(30), day(32))
        self.assertTrue(breakdown["errors"])
        self.assertIn("base price", " ".join(breakdown["errors"]).lower())

    def test_an_unpriced_property_does_not_quietly_charge_nothing(self):
        """The failure mode this error exists to prevent."""
        breakdown = calculate_price(self.prop, day(30), day(32))
        self.assertEqual(breakdown["total"], "0.00")
        self.assertTrue(breakdown["errors"])  # never a silent free stay

    def test_a_priced_property_reports_no_error(self):
        base_rule("40.00")
        breakdown = calculate_price(self.prop, day(30), day(32))
        self.assertEqual(breakdown["errors"], [])

    def test_the_breakdown_reports_the_resolved_base_rate(self):
        base_rule("40.00")
        breakdown = calculate_price(self.prop, day(30), day(32))
        self.assertEqual(breakdown["base_nightly"], "40.00")

    def test_a_partially_covered_stay_is_still_refused(self):
        """A seasonal rate covering only some nights leaves the rest unpriced."""
        PricingRule.objects.create(
            group=PricingGroup.objects.get(platform="airstay", name="Seasonal Pricing"),
            name="Just one night",
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            application=PricingRule.Application.PER_NIGHT,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("90.00"),
            start_date=day(30),
            end_date=day(30),
        )
        breakdown = calculate_price(self.prop, day(30), day(32))
        self.assertTrue(breakdown["errors"])


class ReservationsAreUntouchedTests(TestCase):
    """The user's one hard constraint: reservation data and prices survive."""

    def setUp(self):
        self.prop = make_property()

    def test_a_reservation_keeps_its_stored_prices(self):
        reservation = Reservation.objects.create(
            property=self.prop,
            guest_name="Guest",
            platform=Reservation.Platform.PRIVATE,
            check_in=day(1),
            check_out=day(4),
            nightly_price_eur=Decimal("77.00"),
        )
        reservation.refresh_from_db()
        self.assertEqual(reservation.nightly_price_eur, Decimal("77.00"))
        self.assertEqual(reservation.total_price_eur, Decimal("231.00"))  # 3 nights

    def test_reservation_totals_do_not_consult_the_pricing_rules(self):
        """A reservation is a record of what was agreed, not a live quote."""
        reservation = Reservation.objects.create(
            property=self.prop,
            guest_name="Guest",
            platform=Reservation.Platform.PRIVATE,
            check_in=day(1),
            check_out=day(3),
            nightly_price_eur=Decimal("50.00"),
        )
        base_rule("999.00")  # a wildly different rate arrives afterwards
        reservation.refresh_from_db()
        self.assertEqual(reservation.total_price_eur, Decimal("100.00"))
