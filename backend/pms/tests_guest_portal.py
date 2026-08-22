"""What a signed-in guest can read.

The serializer here is a hand-built allow-list, not a reuse of the staff one —
`serialize_property` carries `wifiPassword` and `floor`, and the public one
carries coordinates. The test that matters most is
`test_the_response_never_carries_a_secret`: it seeds a wifi password, a door
code, a lockbox code and real coordinates, then scans the raw response body for
those exact strings. It fails on a careless future field addition rather than
waiting for someone to notice in review.

Address is the one sensitive field the portal does show, and only once the
booking is confirmed. A guest who is coming needs to know where to go; a guest
whose request is still pending, or was declined, does not.
"""

import json
import re
from decimal import Decimal

from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from .models import BookingRequest, DoorCode, GuestAccount, LockboxCode, Reservation
from .tests import day, make_property

LOCMEM = "django.core.mail.backends.locmem.EmailBackend"
EMAIL = "ana@example.com"

WIFI_PASSWORD = "hunter2-wifi-secret"
DOOR_CODE = "8877-door-secret"
LOCKBOX_CODE = "5544-lockbox-secret"


@override_settings(EMAIL_BACKEND=LOCMEM, GUEST_PORTAL_URL="https://stay.example.com")
class GuestPortalTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        self.prop = make_property(name="Apartment A")
        self.prop.address = "Rruga B 12, Prishtine"
        self.prop.floor = "3rd floor"
        self.prop.wifi_name = "AirStay-5G"
        self.prop.wifi_password = WIFI_PASSWORD
        self.prop.latitude = Decimal("42.66123")
        self.prop.longitude = Decimal("21.16234")
        self.prop.save()
        mail.outbox = []

    def booking(self, email=EMAIL, start=30, status=BookingRequest.Status.PENDING):
        return BookingRequest.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            guest_email=email,
            guest_phone="+38344111222",
            check_in=day(start),
            check_out=day(start + 3),
            total_price_eur=Decimal("150.00"),
            status=status,
        )

    def confirmed(self, email=EMAIL, start=30):
        reservation = Reservation.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            guest_email=email,
            platform="direct",
            check_in=day(start),
            check_out=day(start + 3),
            nightly_price_eur=Decimal("50.00"),
        )
        request = self.booking(email=email, start=start, status=BookingRequest.Status.APPROVED)
        request.reservation = reservation
        request.save(update_fields=["reservation"])
        return request

    def sign_in(self, email=EMAIL):
        """Through the real flow, so the tests exercise what a guest does."""
        self.client.post(
            "/api/guest/auth/request-link/",
            data=json.dumps({"email": email}),
            content_type="application/json",
        )
        token = re.search(r"token=([^\s&]+)", mail.outbox[-1].body).group(1)
        self.client.post(
            "/api/guest/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )
        return GuestAccount.objects.get(email=email)

    def bookings(self):
        return self.client.get("/api/guest/bookings/").json()["bookings"]


class AccessTests(GuestPortalTestCase):
    def test_an_anonymous_visitor_is_refused(self):
        self.booking()
        self.assertEqual(self.client.get("/api/guest/bookings/").status_code, 401)

    def test_stats_are_refused_too(self):
        self.assertEqual(self.client.get("/api/guest/stats/").status_code, 401)

    def test_a_signed_in_guest_gets_their_list(self):
        self.booking()
        self.sign_in()
        self.assertEqual(len(self.bookings()), 1)


class WhatIsListedTests(GuestPortalTestCase):
    def test_only_this_accounts_bookings(self):
        mine = self.booking()
        self.booking(email="someone.else@example.com", start=60)
        self.sign_in()
        self.assertEqual([row["id"] for row in self.bookings()], [str(mine.id)])

    def test_a_staff_entered_reservation_is_absent(self):
        self.booking()
        Reservation.objects.create(
            property=self.prop,
            guest_name="Ana",
            guest_email=EMAIL,
            platform="private",
            check_in=day(90),
            check_out=day(93),
            nightly_price_eur=Decimal("50.00"),
        )
        self.sign_in()
        self.assertEqual(len(self.bookings()), 1, "only the website booking")

    def test_an_airbnb_reservation_is_absent(self):
        self.booking()
        Reservation.objects.create(
            property=self.prop,
            guest_name="Ana",
            guest_email=EMAIL,
            platform="airbnb",
            check_in=day(90),
            check_out=day(93),
            nightly_price_eur=Decimal("50.00"),
        )
        self.sign_in()
        self.assertEqual(len(self.bookings()), 1)


class WhatEachBookingShowsTests(GuestPortalTestCase):
    def test_a_pending_booking_shows_no_address(self):
        self.booking()
        self.sign_in()
        row = self.bookings()[0]
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["property"]["address"], "")
        self.assertEqual(row["property"]["floor"], "")

    def test_a_confirmed_booking_shows_the_address(self):
        self.confirmed()
        self.sign_in()
        row = self.bookings()[0]
        self.assertEqual(row["status"], "confirmed")
        self.assertEqual(row["property"]["address"], "Rruga B 12, Prishtine")
        self.assertEqual(row["property"]["floor"], "3rd floor")

    def test_a_declined_booking_carries_its_reason_and_no_address(self):
        request = self.booking(status=BookingRequest.Status.REJECTED)
        request.rejection_message = "Closed for maintenance."
        request.save(update_fields=["rejection_message"])
        self.sign_in()
        row = self.bookings()[0]
        self.assertEqual(row["status"], "declined")
        self.assertEqual(row["declineReason"], "Closed for maintenance.")
        self.assertEqual(row["property"]["address"], "")

    def test_a_booking_carries_the_stay_and_the_money(self):
        self.booking()
        self.sign_in()
        row = self.bookings()[0]
        self.assertEqual(row["checkIn"], day(30).isoformat())
        self.assertEqual(row["nights"], 3)
        self.assertEqual(row["totalPriceEur"], "150.00")


class NothingSecretLeaksTests(GuestPortalTestCase):
    def test_the_response_never_carries_a_secret(self):
        """Seed every secret this property could hold, then read the raw body."""
        DoorCode.objects.get_or_create(property=self.prop, defaults={"new_code": DOOR_CODE})
        LockboxCode.objects.create(apartment_number="A", new_code=LOCKBOX_CODE)
        self.confirmed()
        self.sign_in()

        body = self.client.get("/api/guest/bookings/").content.decode()
        for secret in (WIFI_PASSWORD, DOOR_CODE, LOCKBOX_CODE, "AirStay-5G", "42.66123", "21.16234"):
            self.assertNotIn(secret, body, f"{secret} leaked into the guest portal")

    def test_no_coordinate_or_credential_key_exists(self):
        self.confirmed()
        self.sign_in()
        row = self.bookings()[0]
        for banned in ("latitude", "longitude", "wifiPassword", "wifiName", "doorCode"):
            self.assertNotIn(banned, row)
            self.assertNotIn(banned, row["property"])


class StatsTests(GuestPortalTestCase):
    def test_stats_agree_with_the_list(self):
        self.confirmed(start=-30)  # a stay that has happened
        self.sign_in()
        stats = self.client.get("/api/guest/stats/").json()
        self.assertEqual(stats["stays"], 1)
        self.assertEqual(stats["nights"], 3)

    def test_a_new_account_sees_zeroes(self):
        self.booking()
        self.sign_in()
        stats = self.client.get("/api/guest/stats/").json()
        self.assertEqual(stats["stays"], 0)
        self.assertEqual(stats["lastVisit"], "")
