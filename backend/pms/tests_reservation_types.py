"""Reservation types: the vocabulary and the colours, editable by an admin.

`Reservation.platform` stays a plain string column. It sits inside two unique
constraints, drives channel-sync de-duplication, and gates real behaviour —
monthly billing periods, the Booking.com commission, maintenance blocks skipping
overlap validation. Turning it into a foreign key would be a large, risky
migration that buys nothing a lookup table keyed by the same string does not.

So this table is the *vocabulary and presentation* layer: it decides what a type
is called and what colour it draws in, and it is the single source of truth for
both. Built-in types can be recoloured and renamed but never deleted, because
deleting one would break billing rather than merely a swatch.
"""

import json
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import Reservation, ReservationType
from .tests import day, make_admin, make_property


def make_staff(client, role, username):
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return user


class SeededTypeTests(TestCase):
    def test_every_platform_the_app_already_uses_has_a_row(self):
        self.assertEqual(
            sorted(ReservationType.objects.values_list("code", flat=True)),
            ["airbnb", "booking", "direct", "maintenance", "monthly", "private"],
        )

    def test_the_seeded_types_are_all_builtin(self):
        self.assertEqual(ReservationType.objects.filter(is_builtin=False).count(), 0)

    def test_every_type_ships_with_a_colour(self):
        for row in ReservationType.objects.all():
            self.assertRegex(row.color, r"^#[0-9a-fA-F]{6}$", row.code)

    def test_they_come_back_in_a_deliberate_order(self):
        codes = list(ReservationType.objects.values_list("code", flat=True))
        self.assertEqual(codes[0], "private", "the default type should lead")


class CalendarColourTests(TestCase):
    """The Python colour must follow the table, not a hardcoded dict."""

    def setUp(self):
        self.prop = make_property()

    def reservation(self, platform="airbnb"):
        return Reservation.objects.create(
            property=self.prop,
            guest_name="Guest",
            platform=platform,
            check_in=day(1),
            check_out=day(3),
            nightly_price_eur=Decimal("50.00"),
        )

    def test_the_colour_comes_from_the_table(self):
        ReservationType.objects.filter(code="airbnb").update(color="#123456")
        self.assertEqual(self.reservation().calendar_color, "#123456")

    def test_an_unknown_platform_still_gets_something_drawable(self):
        """Defensive: the property must never hand a template an empty colour."""
        orphan = Reservation(
            property=self.prop, platform="mystery", check_in=day(1), check_out=day(3)
        )
        self.assertRegex(orphan.calendar_color, r"^#[0-9a-fA-F]{6}$")

    def test_a_reservation_cannot_use_a_type_that_does_not_exist(self):
        """Dropping `choices` removed the only typo guard; clean() replaced it."""
        from django.core.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            self.reservation(platform="mystery")

    def test_a_reservation_can_use_a_type_an_admin_added(self):
        ReservationType.objects.create(
            code="glamping", label="Glamping", color="#00ff00", sort_order=9
        )
        self.assertEqual(self.reservation(platform="glamping").platform, "glamping")


class ReservationTypeApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_the_list_is_returned(self):
        rows = self.client.get("/api/reservation-types/").json()["reservationTypes"]
        self.assertEqual(len(rows), 6)

    def test_a_row_carries_what_the_ui_needs(self):
        row = self.client.get("/api/reservation-types/").json()["reservationTypes"][0]
        self.assertEqual(
            sorted(row.keys()),
            ["active", "code", "color", "id", "isBuiltin", "label", "sortOrder"],
        )

    def test_a_builtin_can_be_recoloured(self):
        row = ReservationType.objects.get(code="airbnb")
        response = self.client.patch(
            f"/api/reservation-types/{row.id}/",
            data=json.dumps({"color": "#abcdef"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.color, "#abcdef")

    def test_a_builtin_can_be_renamed(self):
        row = ReservationType.objects.get(code="booking")
        self.client.patch(
            f"/api/reservation-types/{row.id}/",
            data=json.dumps({"label": "Booking.com NL"}),
            content_type="application/json",
        )
        row.refresh_from_db()
        self.assertEqual(row.label, "Booking.com NL")
        self.assertEqual(row.code, "booking", "renaming must never move the code")

    def test_a_nonsense_colour_is_refused(self):
        row = ReservationType.objects.get(code="airbnb")
        response = self.client.patch(
            f"/api/reservation-types/{row.id}/",
            data=json.dumps({"color": "red; drop table"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_a_new_type_can_be_added(self):
        response = self.client.post(
            "/api/reservation-types/",
            data=json.dumps({"label": "Glamping", "color": "#00ff00"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        created = ReservationType.objects.get(label="Glamping")
        self.assertEqual(created.code, "glamping")
        self.assertFalse(created.is_builtin)

    def test_a_new_type_lands_at_the_end(self):
        self.client.post(
            "/api/reservation-types/",
            data=json.dumps({"label": "Glamping", "color": "#00ff00"}),
            content_type="application/json",
        )
        self.assertEqual(
            ReservationType.objects.order_by("sort_order").last().code, "glamping"
        )

    def test_two_types_cannot_share_a_code(self):
        response = self.client.post(
            "/api/reservation-types/",
            data=json.dumps({"label": "Private", "color": "#00ff00"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_a_custom_type_can_be_deleted(self):
        created = ReservationType.objects.create(
            code="glamping", label="Glamping", color="#00ff00", sort_order=9
        )
        response = self.client.delete(f"/api/reservation-types/{created.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ReservationType.objects.filter(code="glamping").exists())

    def test_a_builtin_cannot_be_deleted(self):
        row = ReservationType.objects.get(code="monthly")
        response = self.client.delete(f"/api/reservation-types/{row.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(ReservationType.objects.filter(code="monthly").exists())

    def test_a_type_in_use_cannot_be_deleted_and_says_how_many(self):
        created = ReservationType.objects.create(
            code="glamping", label="Glamping", color="#00ff00", sort_order=9
        )
        prop = make_property()
        for index in range(3):
            Reservation.objects.create(
                property=prop,
                guest_name=f"Guest {index}",
                platform="glamping",
                check_in=day(index * 5 + 1),
                check_out=day(index * 5 + 3),
                nightly_price_eur=Decimal("50.00"),
            )
        response = self.client.delete(f"/api/reservation-types/{created.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("3", response.json()["error"])


class ReservationTypePermissionTests(TestCase):
    def test_reading_requires_a_login(self):
        self.assertEqual(Client().get("/api/reservation-types/").status_code, 401)

    def test_cleaning_staff_may_read_the_colours(self):
        """The dashboard they do see draws reservation badges."""
        client = Client()
        make_staff(client, "Cleaning", "cleaner")
        self.assertEqual(client.get("/api/reservation-types/").status_code, 200)

    def test_cleaning_staff_may_not_recolour(self):
        client = Client()
        make_staff(client, "Cleaning", "cleaner2")
        row = ReservationType.objects.get(code="airbnb")
        response = client.patch(
            f"/api/reservation-types/{row.id}/",
            data=json.dumps({"color": "#000000"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_management_may_not_recolour(self):
        """Colours are a global, admin-level setting."""
        client = Client()
        make_staff(client, "Management", "manager")
        row = ReservationType.objects.get(code="airbnb")
        response = client.patch(
            f"/api/reservation-types/{row.id}/",
            data=json.dumps({"color": "#000000"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
