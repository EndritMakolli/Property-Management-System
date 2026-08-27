"""Who is in the building right now, and who is holding a garage card.

Two things are being pinned here.

The in-house window: a stay counts from the day the guest arrives until the day
they leave, and not on the day they leave. Someone checking out this morning is
not in the building this afternoon, and getting that boundary wrong is how a
list like this loses trust.

And the garage card. It is one boolean on the reservation, deliberately without
its own "who ticked it" and "when" columns: `TRACKED_FIELDS` already writes a
`ReservationAuditLog` row for any field it lists, so adding it there buys the
trail for free through the endpoint that already exists.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import Reservation, ReservationAuditLog
from .tests import make_property


def staff_client(role="Admin", username="hosting-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client


def stay(prop, check_in, check_out, name="Guest", platform="private", **extra):
    return Reservation.objects.create(
        property=prop,
        guest_name=name,
        platform=platform,
        check_in=check_in,
        check_out=check_out,
        nightly_price_eur=Decimal("50.00"),
        **extra,
    )


class HostingWindowTests(TestCase):
    """`?hosting=1` returns exactly the stays in progress today."""

    def setUp(self):
        self.client = staff_client()
        self.today = date.today()
        self.a = make_property(name="Apartment A")
        self.b = make_property(name="Apartment B")
        self.c = make_property(name="Apartment C")
        self.d = make_property(name="Apartment D")

    def hosting_names(self):
        response = self.client.get("/api/reservations/", {"hosting": "1"})
        self.assertEqual(response.status_code, 200)
        return {row["guestName"] for row in response.json()["reservations"]}

    def test_a_stay_in_progress_is_hosting(self):
        stay(self.a, self.today - timedelta(days=2), self.today + timedelta(days=2), name="InHouse")
        self.assertIn("InHouse", self.hosting_names())

    def test_someone_arriving_today_is_hosting(self):
        stay(self.a, self.today, self.today + timedelta(days=3), name="ArrivesToday")
        self.assertIn("ArrivesToday", self.hosting_names())

    def test_someone_leaving_today_is_not_hosting(self):
        """They handed the key back this morning; the apartment is free tonight."""
        stay(self.a, self.today - timedelta(days=3), self.today, name="LeavesToday")
        self.assertNotIn("LeavesToday", self.hosting_names())

    def test_someone_arriving_tomorrow_is_not_hosting_yet(self):
        stay(self.a, self.today + timedelta(days=1), self.today + timedelta(days=4), name="Tomorrow")
        self.assertNotIn("Tomorrow", self.hosting_names())

    def test_a_finished_stay_is_not_hosting(self):
        stay(self.a, self.today - timedelta(days=10), self.today - timedelta(days=5), name="Past")
        self.assertNotIn("Past", self.hosting_names())

    def test_a_maintenance_block_is_not_a_guest(self):
        stay(self.a, self.today - timedelta(days=1), self.today + timedelta(days=1),
             name="Renovim", platform="maintenance")
        self.assertNotIn("Renovim", self.hosting_names())

    def test_an_archived_stay_is_not_hosting(self):
        stay(self.a, self.today - timedelta(days=1), self.today + timedelta(days=1),
             name="Archived", is_archived=True)
        self.assertNotIn("Archived", self.hosting_names())

    def test_several_guests_at_once(self):
        stay(self.a, self.today - timedelta(days=1), self.today + timedelta(days=1), name="One")
        stay(self.b, self.today, self.today + timedelta(days=5), name="Two")
        stay(self.c, self.today - timedelta(days=6), self.today + timedelta(days=2), name="Three")
        self.assertEqual(self.hosting_names(), {"One", "Two", "Three"})

    def test_hosting_ignores_the_month_filter_it_would_otherwise_apply(self):
        """"Who is here now" is not a question about a chosen month."""
        stay(self.a, self.today - timedelta(days=1), self.today + timedelta(days=1), name="Now")
        response = self.client.get(
            "/api/reservations/", {"hosting": "1", "year": "2020", "month": "1"}
        )
        names = {row["guestName"] for row in response.json()["reservations"]}
        self.assertIn("Now", names)

    def test_without_the_flag_the_list_is_unchanged(self):
        stay(self.a, self.today - timedelta(days=10), self.today - timedelta(days=5), name="Past")
        response = self.client.get("/api/reservations/")
        self.assertIn("Past", {row["guestName"] for row in response.json()["reservations"]})


class GarageCardTests(TestCase):
    """One tick per stay, with the audit trail the reservation already keeps."""

    def setUp(self):
        self.client = staff_client(username="garage-admin")
        self.today = date.today()
        self.prop = make_property()
        self.stay = stay(
            self.prop, self.today - timedelta(days=1), self.today + timedelta(days=2), name="Driver"
        )

    def patch(self, value):
        return self.client.patch(
            f"/api/reservations/{self.stay.id}/",
            data={"garageCard": value},
            content_type="application/json",
        )

    def test_a_new_stay_starts_without_a_card(self):
        self.assertFalse(self.stay.garage_card)

    def test_the_flag_is_serialized_so_the_card_can_render_it(self):
        row = self.client.get("/api/reservations/", {"hosting": "1"}).json()["reservations"][0]
        self.assertIn("garageCard", row)
        self.assertFalse(row["garageCard"])

    def test_ticking_it_sticks(self):
        self.assertEqual(self.patch(True).status_code, 200)
        self.stay.refresh_from_db()
        self.assertTrue(self.stay.garage_card)

    def test_unticking_it_sticks_too(self):
        self.patch(True)
        self.patch(False)
        self.stay.refresh_from_db()
        self.assertFalse(self.stay.garage_card)

    def test_the_response_carries_the_new_value(self):
        self.assertTrue(self.patch(True).json()["reservation"]["garageCard"])

    def test_ticking_it_is_recorded_in_the_audit_log(self):
        """Who handed a card out, and when, without a column of its own."""
        self.patch(True)
        entry = ReservationAuditLog.objects.filter(
            reservation_id=self.stay.id, field_name="garage_card"
        ).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.changed_by, "garage-admin")
        self.assertEqual(entry.new_value, "True")

    def test_an_unrelated_edit_does_not_log_a_garage_change(self):
        self.client.patch(
            f"/api/reservations/{self.stay.id}/",
            data={"notes": "late arrival"},
            content_type="application/json",
        )
        self.assertFalse(
            ReservationAuditLog.objects.filter(
                reservation_id=self.stay.id, field_name="garage_card"
            ).exists()
        )

    def test_a_returning_guest_starts_the_next_stay_unticked(self):
        """The card is per visit — it is handed back at the end of one."""
        self.patch(True)
        second = stay(
            self.prop, self.today + timedelta(days=30), self.today + timedelta(days=33), name="Driver"
        )
        self.assertFalse(second.garage_card)

    def test_editing_something_else_leaves_the_tick_alone(self):
        self.patch(True)
        self.client.patch(
            f"/api/reservations/{self.stay.id}/",
            data={"notes": "quiet guest"},
            content_type="application/json",
        )
        self.stay.refresh_from_db()
        self.assertTrue(self.stay.garage_card)


class HostingRolesTests(TestCase):
    def setUp(self):
        self.today = date.today()
        self.prop = make_property()
        stay(self.prop, self.today - timedelta(days=1), self.today + timedelta(days=1))

    def test_cleaning_may_see_who_is_in_the_building(self):
        """Cleaning already reads the reservation list; this is the same data."""
        client = staff_client(role="Cleaning", username="hosting-cleaner")
        self.assertEqual(client.get("/api/reservations/", {"hosting": "1"}).status_code, 200)

    def test_a_signed_out_visitor_may_not(self):
        self.assertIn(Client().get("/api/reservations/", {"hosting": "1"}).status_code, (401, 403))
