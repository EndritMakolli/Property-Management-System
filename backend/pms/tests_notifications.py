"""The notifications bell.

Computed, not stored. Every source here is a fact about *current* state - a
request still waiting, a registration already expired - so deriving the feed on
each read means it can never go stale. A stored feed would need an event
writer, deduplication, and a sweeper to retract the notification for a service
that has since been done; this needs none of those, and it cannot show a
reminder for something already dealt with.

What *is* stored is the reading. `NotificationRead` holds one row per (user,
key) so read state is per person, and the key carries a fingerprint of the
state that produced it. That is the part worth understanding: dismiss "service
overdue" today, service the van, and the next time it falls due the key differs,
so it comes back unread rather than staying silently dismissed forever.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import BookingRequest, NotificationRead, Property, Reservation
from .tests import make_property


def staff_client(role="Admin", username="notif-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client, user


def make_vehicle(name="Kia Xceed", **extra):
    return make_property(name=name, platform=Property.Platform.FLEET, **extra)


class NotificationFeedTests(TestCase):
    def setUp(self):
        self.client, self.user = staff_client()

    def feed(self):
        response = self.client.get("/api/notifications/")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_a_quiet_system_has_nothing_to_say(self):
        payload = self.feed()
        self.assertEqual(payload["notifications"], [])
        self.assertEqual(payload["unread"], 0)

    def test_an_expired_registration_appears(self):
        make_vehicle(registration_expiry=date.today() - timedelta(days=2))
        kinds = [n["kind"] for n in self.feed()["notifications"]]
        self.assertIn("registration_expired", kinds)

    def test_an_overdue_service_appears(self):
        make_vehicle(
            name="Dacia",
            last_service_date=date.today() - timedelta(days=500),
            service_interval_months=12,
        )
        kinds = [n["kind"] for n in self.feed()["notifications"]]
        self.assertIn("service_overdue", kinds)

    def test_a_healthy_vehicle_says_nothing(self):
        make_vehicle(
            last_service_date=date.today(),
            service_interval_months=12,
            registration_expiry=date.today() + timedelta(days=300),
        )
        self.assertEqual(self.feed()["notifications"], [])

    def test_a_vehicle_with_no_record_yet_is_not_nagged_about(self):
        """"Nothing recorded" is a setup task, not an operational alert."""
        make_vehicle()
        self.assertEqual(self.feed()["notifications"], [])

    def test_a_pending_booking_request_appears(self):
        prop = make_property(name="Apartment #2")
        BookingRequest.objects.create(
            property=prop,
            guest_name="Arben",
            guest_phone="044111222",
            check_in=date.today() + timedelta(days=10),
            check_out=date.today() + timedelta(days=13),
            guests_count=2,
            status=BookingRequest.Status.PENDING,
            total_price_eur=Decimal("150.00"),
        )
        kinds = [n["kind"] for n in self.feed()["notifications"]]
        self.assertIn("booking_request", kinds)

    def test_a_handled_booking_request_disappears(self):
        prop = make_property(name="Apartment #2")
        req = BookingRequest.objects.create(
            property=prop,
            guest_name="Arben",
            guest_phone="044111222",
            check_in=date.today() + timedelta(days=10),
            check_out=date.today() + timedelta(days=13),
            guests_count=2,
            status=BookingRequest.Status.PENDING,
            total_price_eur=Decimal("150.00"),
        )
        req.status = BookingRequest.Status.APPROVED
        req.save()
        self.assertEqual(self.feed()["notifications"], [])

    def test_every_notification_links_somewhere(self):
        make_vehicle(registration_expiry=date.today() - timedelta(days=2))
        for notification in self.feed()["notifications"]:
            self.assertTrue(notification["link"], notification["kind"])

    def test_the_most_urgent_comes_first(self):
        make_vehicle(name="Expired", registration_expiry=date.today() - timedelta(days=2))
        make_vehicle(name="Soon", registration_expiry=date.today() + timedelta(days=10))
        severities = [n["severity"] for n in self.feed()["notifications"]]
        self.assertEqual(severities, sorted(severities, key=lambda s: {"overdue": 0, "soon": 1}[s]))


class NotificationReadTests(TestCase):
    def setUp(self):
        self.client, self.user = staff_client()
        self.car = make_vehicle(registration_expiry=date.today() - timedelta(days=2))

    def feed(self, client=None):
        return (client or self.client).get("/api/notifications/").json()

    def first_key(self):
        return self.feed()["notifications"][0]["key"]

    def test_a_new_notification_starts_unread(self):
        payload = self.feed()
        self.assertEqual(payload["unread"], 1)
        self.assertFalse(payload["notifications"][0]["read"])

    def test_marking_one_read_sticks(self):
        key = self.first_key()
        response = self.client.post(
            "/api/notifications/read/", data={"keys": [key]}, content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        payload = self.feed()
        self.assertTrue(payload["notifications"][0]["read"])
        self.assertEqual(payload["unread"], 0)

    def test_a_read_notification_still_appears_in_the_list(self):
        """Read is not dismissed - the van is still unregistered."""
        self.client.post(
            "/api/notifications/read/",
            data={"keys": [self.first_key()]},
            content_type="application/json",
        )
        self.assertEqual(len(self.feed()["notifications"]), 1)

    def test_marking_all_read_clears_the_count(self):
        make_vehicle(name="Dacia", registration_expiry=date.today() - timedelta(days=5))
        response = self.client.post(
            "/api/notifications/read/", data={"all": True}, content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.feed()["unread"], 0)

    def test_read_state_is_per_person(self):
        """One manager clearing the bell must not clear it for everyone."""
        self.client.post(
            "/api/notifications/read/",
            data={"keys": [self.first_key()]},
            content_type="application/json",
        )
        other, _ = staff_client(username="notif-other")
        self.assertEqual(self.feed(other)["unread"], 1)

    def test_the_same_alert_returns_unread_after_the_state_moves_on(self):
        """Dismiss it, renew the registration, let it lapse again: it comes back.

        The key carries a fingerprint of the state that produced it, so a fresh
        lapse is a different notification rather than one already dismissed.
        """
        self.client.post(
            "/api/notifications/read/",
            data={"keys": [self.first_key()]},
            content_type="application/json",
        )
        self.assertEqual(self.feed()["unread"], 0)

        self.car.registration_expiry = date.today() - timedelta(days=40)
        self.car.save()
        self.assertEqual(self.feed()["unread"], 1)

    def test_marking_an_unknown_key_read_is_harmless(self):
        response = self.client.post(
            "/api/notifications/read/",
            data={"keys": ["nonsense:1"]},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

    def test_marking_the_same_key_twice_does_not_duplicate_a_row(self):
        key = self.first_key()
        for _ in range(3):
            self.client.post(
                "/api/notifications/read/", data={"keys": [key]}, content_type="application/json"
            )
        self.assertEqual(NotificationRead.objects.filter(key=key).count(), 1)


class NotificationRolesTests(TestCase):
    def test_cleaning_sees_the_bell(self):
        """Cleaning already sees maintenance and codes; alerts are the same class."""
        client, _ = staff_client(role="Cleaning", username="notif-cleaner")
        self.assertEqual(client.get("/api/notifications/").status_code, 200)

    def test_a_signed_out_visitor_does_not(self):
        self.assertIn(Client().get("/api/notifications/").status_code, (401, 403))
