"""A latest bookable date: how far ahead guests may reserve.

An operator who has not set rates or availability beyond a point does not want
bookings past it. This is a booking gate, not a price, so it lives alongside
the minimum-stay limit as a StayConstraint and surfaces the same way — through
breakdown["errors"], which every caller must check before accepting a booking.

The cutoff is stored in `end_date`: the field already means "the last date
this applies to", and MAX_ADVANCE has no separate window to describe. `value`
is meaningless here, which is why it became nullable.
"""

import json
from datetime import timedelta

from django.test import Client, TestCase

from .models import StayConstraint
from .tests import day, make_admin, make_property
from .views._pricing import calculate_price


def horizon(cutoff, **overrides):
    defaults = {
        "platform": "airstay",
        "kind": StayConstraint.Kind.MAX_ADVANCE,
        "scope": "all",
        "enabled": True,
        "end_date": cutoff,
    }
    defaults.update(overrides)
    return StayConstraint.objects.create(**defaults)


class BookingHorizonTests(TestCase):
    def setUp(self):
        self.prop = make_property()

    def test_a_stay_inside_the_horizon_is_fine(self):
        horizon(day(60))
        breakdown = calculate_price(self.prop, day(30), day(33))
        self.assertEqual(breakdown["errors"], [])

    def test_a_stay_ending_on_the_cutoff_is_fine(self):
        """The cutoff is the last bookable date, not the first refused one."""
        horizon(day(33))
        self.assertEqual(calculate_price(self.prop, day(30), day(33))["errors"], [])

    def test_a_stay_running_past_the_cutoff_is_refused(self):
        horizon(day(32))
        breakdown = calculate_price(self.prop, day(30), day(33))
        self.assertTrue(breakdown["errors"])
        self.assertIn("bookings", " ".join(breakdown["errors"]).lower())

    def test_the_cutoff_is_reported_for_display(self):
        horizon(day(45))
        self.assertEqual(
            calculate_price(self.prop, day(30), day(33))["latest_bookable_date"],
            day(45).isoformat(),
        )

    def test_no_limit_means_no_cutoff(self):
        breakdown = calculate_price(self.prop, day(30), day(33))
        self.assertIsNone(breakdown["latest_bookable_date"])

    def test_a_disabled_limit_does_not_apply(self):
        horizon(day(32), enabled=False)
        self.assertEqual(calculate_price(self.prop, day(30), day(33))["errors"], [])

    def test_a_limit_for_another_property_does_not_apply(self):
        other = make_property(name="Elsewhere")
        horizon(day(31), scope="property", property=other)
        self.assertEqual(calculate_price(self.prop, day(30), day(33))["errors"], [])

    def test_a_property_limit_overrides_the_general_one(self):
        horizon(day(31))  # everything closes early...
        horizon(day(90), scope="property", property=self.prop)  # ...except this one
        self.assertEqual(calculate_price(self.prop, day(30), day(33))["errors"], [])

    def test_the_earliest_cutoff_wins_among_equals(self):
        horizon(day(90))
        horizon(day(31))
        breakdown = calculate_price(self.prop, day(30), day(33))
        self.assertEqual(breakdown["latest_bookable_date"], day(31).isoformat())
        self.assertTrue(breakdown["errors"])

    def test_it_does_not_disturb_the_minimum_stay_limit(self):
        StayConstraint.objects.create(
            platform="airstay", kind=StayConstraint.Kind.MIN_NIGHTS, value=3, scope="all"
        )
        horizon(day(90))
        breakdown = calculate_price(self.prop, day(30), day(32))
        self.assertIn("Minimum stay is 3 nights.", breakdown["errors"])

    def test_a_fleet_limit_does_not_close_airstay(self):
        horizon(day(31), platform="fleet")
        self.assertEqual(calculate_price(self.prop, day(30), day(33))["errors"], [])


class BookingHorizonApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def create(self, **overrides):
        body = {
            "kind": "max_advance",
            "scope": "all",
            "endDate": day(90).isoformat(),
            "enabled": True,
        }
        body.update(overrides)
        return self.client.post(
            "/api/stay-constraints/", data=json.dumps(body), content_type="application/json"
        )

    def test_it_can_be_created_without_a_night_count(self):
        response = self.create()
        self.assertEqual(response.status_code, 201)
        body = response.json()["stayConstraint"]
        self.assertEqual(body["kind"], "max_advance")
        self.assertEqual(body["endDate"], day(90).isoformat())
        self.assertIsNone(body["value"])

    def test_it_needs_a_date(self):
        response = self.create(endDate=None)
        self.assertEqual(response.status_code, 400)

    def test_a_minimum_stay_still_needs_a_night_count(self):
        response = self.client.post(
            "/api/stay-constraints/",
            data=json.dumps({"kind": "min_nights", "scope": "all", "enabled": True}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_it_is_listed_with_the_other_limits(self):
        self.create()
        rows = self.client.get("/api/stay-constraints/").json()["stayConstraints"]
        self.assertEqual([r["kind"] for r in rows], ["max_advance"])


class BookingHorizonBlocksThePublicSiteTests(TestCase):
    """The gate has to reach the guest-facing flow, not just the breakdown."""

    def setUp(self):
        from django.conf import settings

        settings.ALLOWED_HOSTS.append("testserver")
        self.client = Client()
        self.prop = make_property()

    def test_availability_refuses_dates_past_the_cutoff(self):
        horizon(day(32))
        ci, co = day(30), day(40)
        response = self.client.get(
            f"/api/booking/availability/?check_in={ci}&check_out={co}&guests=1"
        )
        self.assertEqual(response.status_code, 200)
        names = [e["property"]["name"] for e in response.json()["available"]]
        self.assertNotIn(self.prop.name, names)

    def test_availability_allows_dates_inside_the_cutoff(self):
        horizon(day(90))
        ci = day(30)
        response = self.client.get(
            f"/api/booking/availability/?check_in={ci}&check_out={ci + timedelta(days=3)}&guests=1"
        )
        names = [e["property"]["name"] for e in response.json()["available"]]
        self.assertIn(self.prop.name, names)
