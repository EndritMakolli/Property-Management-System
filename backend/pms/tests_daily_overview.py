"""One day's arrivals, departures and in-house guests.

The question "who is arriving today" was answered by loading every reservation
in the system and filtering in the browser. That works until it doesn't, and it
makes the answer a property of whichever page asked. `?day=` puts the rule in
one place: a stay touches a day if it has not ended before it and did not start
after it.

The split between arriving, leaving and staying is deliberately *not* made
here. The serializer already returns both dates, and three endpoints returning
three slices of the same rows is three chances for them to disagree about a
guest arriving and leaving on the same day.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import Property, Reservation
from .tests import make_property


def staff_client(role="Admin", username="day-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client


class DayFilterTests(TestCase):
    def setUp(self):
        self.client = staff_client()
        self.prop = make_property(name="Apartment #1")
        self.other = make_property(name="Apartment #2")
        self.day = date(2026, 7, 15)

    def book(self, prop, check_in, check_out, name="Guest", platform="private"):
        return Reservation.objects.create(
            property=prop,
            guest_name=name,
            platform=platform,
            check_in=check_in,
            check_out=check_out,
            nightly_price_eur=Decimal("60.00"),
        )

    def ids_for(self, day):
        response = self.client.get("/api/reservations/", {"day": day.isoformat()})
        self.assertEqual(response.status_code, 200)
        return {row["id"] for row in response.json()["reservations"]}

    def test_an_arrival_on_the_day_is_included(self):
        arriving = self.book(self.prop, self.day, self.day + timedelta(days=3))
        self.assertIn(str(arriving.id), self.ids_for(self.day))

    def test_a_departure_on_the_day_is_included(self):
        """Unlike "currently hosting", a departure is the whole point here -
        somebody has to collect the key and clean the apartment."""
        leaving = self.book(self.other, self.day - timedelta(days=3), self.day)
        self.assertIn(str(leaving.id), self.ids_for(self.day))

    def test_a_guest_staying_through_the_day_is_included(self):
        staying = self.book(self.prop, self.day - timedelta(days=2), self.day + timedelta(days=2))
        self.assertIn(str(staying.id), self.ids_for(self.day))

    def test_a_stay_that_ended_yesterday_is_not(self):
        gone = self.book(self.prop, self.day - timedelta(days=4), self.day - timedelta(days=1))
        self.assertNotIn(str(gone.id), self.ids_for(self.day))

    def test_a_stay_that_starts_tomorrow_is_not(self):
        later = self.book(self.prop, self.day + timedelta(days=1), self.day + timedelta(days=4))
        self.assertNotIn(str(later.id), self.ids_for(self.day))

    def test_a_same_day_turnaround_shows_both_stays(self):
        """One guest out, the next in, same apartment, same morning. Both have
        to appear or the arrival gets no clean."""
        out = self.book(self.prop, self.day - timedelta(days=2), self.day, name="Leaving")
        into = self.book(self.prop, self.day, self.day + timedelta(days=2), name="Arriving")
        found = self.ids_for(self.day)
        self.assertIn(str(out.id), found)
        self.assertIn(str(into.id), found)

    def test_maintenance_is_excluded(self):
        """A blocked-off apartment has no guest to greet."""
        block = self.book(self.prop, self.day, self.day + timedelta(days=1), platform="maintenance")
        self.assertNotIn(str(block.id), self.ids_for(self.day))

    def test_an_archived_stay_is_excluded(self):
        cancelled = self.book(self.prop, self.day, self.day + timedelta(days=2))
        cancelled.is_archived = True
        cancelled.save(update_fields=["is_archived"])
        self.assertNotIn(str(cancelled.id), self.ids_for(self.day))

    def test_the_day_filter_beats_a_month_filter(self):
        """Both sent at once means the caller wants the day; a month is the
        page's leftover state, not a second question."""
        arriving = self.book(self.prop, self.day, self.day + timedelta(days=3))
        response = self.client.get(
            "/api/reservations/", {"day": self.day.isoformat(), "year": "2026", "month": "1"}
        )
        self.assertIn(str(arriving.id), {row["id"] for row in response.json()["reservations"]})

    def test_a_nonsense_day_is_refused_rather_than_ignored(self):
        """Silently falling back to every reservation would look like the page
        working and be wrong."""
        response = self.client.get("/api/reservations/", {"day": "not-a-date"})
        self.assertEqual(response.status_code, 400)

    def test_cleaning_can_read_the_day(self):
        """Cleaning staff are exactly who needs the turnaround list."""
        cleaner = staff_client(role="Cleaning", username="day-cleaner")
        response = cleaner.get("/api/reservations/", {"day": self.day.isoformat()})
        self.assertEqual(response.status_code, 200)

    def test_a_signed_out_visitor_gets_nothing(self):
        response = Client().get("/api/reservations/", {"day": self.day.isoformat()})
        self.assertIn(response.status_code, (401, 403))

    def test_fleet_is_not_mixed_into_the_apartment_day(self):
        """A van's hire dates are a different list from an apartment's."""
        van = make_property(name="Van #1", platform=Property.Platform.FLEET)
        hire = self.book(van, self.day, self.day + timedelta(days=2))
        self.assertNotIn(str(hire.id), self.ids_for(self.day))
