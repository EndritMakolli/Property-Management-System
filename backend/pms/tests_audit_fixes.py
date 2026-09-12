"""The audit's findings, held shut.

Four separate defects, one file, because each is a rule about what the public
booking surface is allowed to do and they are read together:

  * A booking request needs an email. The browser demanded one and the server
    did not, so a request could be stored with no way to reach the guest - and
    every guest-facing feature hangs off that address.
  * Direct booking records money nobody took. It stays off until there is a
    payment provider.
  * A change request that stores nothing must not tell the guest it was
    received.
  * With no cancellation policy configured, the answer is "talk to us", not
    "have all your money back".
"""

from datetime import date, timedelta
from decimal import Decimal

from django.test import Client, TestCase, override_settings

from .models import BookingRequest, CancellationPolicy, Property, Reservation
from .tests import make_property
from .views._booking_public import cancellation_outcome


def public():
    return Client()


class BookingRequestNeedsAnEmailTests(TestCase):
    """The browser required one and the server did not. The server is right to
    be strict: the guest portal, the approval email and the decline email all
    match on this address, and a request without one reaches nobody."""

    def setUp(self):
        self.prop = make_property(name="Apartment #21", listing_active=True)
        self.payload = {
            "propertyId": str(self.prop.id),
            "checkIn": (date.today() + timedelta(days=10)).isoformat(),
            "checkOut": (date.today() + timedelta(days=13)).isoformat(),
            "guestName": "Ana Berisha",
            "guestPhone": "+383 44 111 222",
            "guestEmail": "ana@example.com",
            "guestsCount": 2,
        }

    def post(self, **overrides):
        return public().post(
            "/api/booking/requests/",
            data={**self.payload, **overrides},
            content_type="application/json",
        )

    def test_a_request_with_an_email_is_accepted(self):
        self.assertEqual(self.post().status_code, 201)

    def test_a_request_with_no_email_is_refused(self):
        response = self.post(guestEmail="")
        self.assertEqual(response.status_code, 400)
        self.assertIn("guestEmail", response.json()["error"])

    def test_a_request_with_a_missing_email_key_is_refused(self):
        payload = dict(self.payload)
        payload.pop("guestEmail")
        response = public().post(
            "/api/booking/requests/", data=payload, content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)

    def test_an_address_that_is_not_an_address_is_refused(self):
        """Storing 'asdf' is the same as storing nothing, one step later."""
        response = self.post(guestEmail="not-an-address")
        self.assertEqual(response.status_code, 400)
        self.assertIn("guestEmail", response.json()["error"])

    def test_the_address_is_stored_lowercased(self):
        """`has_website_booking` matches on a lowercased email. Storing the
        capitals a phone keyboard adds would lock the guest out of the portal
        they just earned."""
        self.post(guestEmail="Ana.Berisha@Example.COM")
        self.assertEqual(BookingRequest.objects.first().guest_email, "ana.berisha@example.com")

    def test_nothing_is_stored_when_the_email_is_refused(self):
        self.post(guestEmail="")
        self.assertEqual(BookingRequest.objects.count(), 0)

    def test_the_name_and_phone_are_still_required(self):
        self.assertEqual(self.post(guestName="").status_code, 400)
        self.assertEqual(self.post(guestPhone="").status_code, 400)


class DirectBookingStaysOffTests(TestCase):
    """It writes a confirmed reservation recording money that was never taken -
    `payment_status = FULL` with no payment provider behind it. Off until there
    is one, because a refund of money you never received is a real loss."""

    def setUp(self):
        self.prop = make_property(name="Apartment #22", listing_active=True)
        self.payload = {
            "propertyId": str(self.prop.id),
            "checkIn": (date.today() + timedelta(days=10)).isoformat(),
            "checkOut": (date.today() + timedelta(days=13)).isoformat(),
            "guestName": "Ana Berisha",
            "guestPhone": "+383 44 111 222",
            "guestEmail": "ana@example.com",
            "paymentType": "full",
        }

    def post(self):
        return public().post(
            "/api/booking/bookings/", data=self.payload, content_type="application/json"
        )

    def test_direct_booking_is_refused_by_default(self):
        self.assertEqual(self.post().status_code, 503)

    def test_no_reservation_is_created_while_it_is_off(self):
        self.post()
        self.assertEqual(Reservation.objects.count(), 0)

    def test_the_refusal_says_why(self):
        self.assertIn("payment", self.post().json()["error"].lower())

    @override_settings(ONLINE_PAYMENTS_ENABLED=True)
    def test_it_still_works_when_deliberately_switched_on(self):
        """The switch turns a feature off; it does not delete it. When a
        payment provider exists, one setting brings it back."""
        self.assertEqual(self.post().status_code, 201)


class NoLyingChangeRequestTests(TestCase):
    """The endpoint told the guest "we will contact you shortly" and stored
    nothing. Silence would have been kinder; it is gone."""

    def test_the_change_request_endpoint_no_longer_exists(self):
        token = "11111111-1111-1111-1111-111111111111"
        response = public().post(
            f"/api/booking/reservations/{token}/change-request/",
            data={"message": "Can I move to the 5th?"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)


class CancellationWithNoPolicyTests(TestCase):
    """With nothing configured, the honest answer is "talk to us"."""

    def setUp(self):
        self.prop = make_property(name="Apartment #23")
        self.reservation = Reservation.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            platform="direct",
            check_in=date.today() + timedelta(days=30),
            check_out=date.today() + timedelta(days=33),
            nightly_price_eur=Decimal("60.00"),
        )

    def test_no_policy_means_no_automatic_cancellation(self):
        """It used to mean free cancellation and a full refund - a commercial
        term nobody had agreed to, applied because a table was empty."""
        can_auto, refund = cancellation_outcome(self.reservation)
        self.assertFalse(can_auto)
        self.assertEqual(refund, Decimal("0"))

    def test_a_configured_free_policy_still_cancels_freely(self):
        """The fix must not break the case somebody has actually set up."""
        CancellationPolicy.objects.create(
            scope=CancellationPolicy.Scope.ALL,
            policy_type=CancellationPolicy.PolicyType.FREE,
            days_before_checkin=7,
        )
        can_auto, _ = cancellation_outcome(self.reservation)
        self.assertTrue(can_auto)
