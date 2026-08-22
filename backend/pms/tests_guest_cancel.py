"""Cancelling — by the old token link, and from the portal.

The first class is characterisation, written before any refactoring. The
existing `booking_cancel` endpoint has no test coverage at all, so extracting
its policy logic so the portal can share it would otherwise be an unguarded
change. These pin what it does today; if they move, the extraction changed
behaviour.

The rest cover the portal's own path, where the important difference is that
ownership is checked first. A token link proves you hold the token. A session
proves who you are — so the lookup must be scoped to the account, or the portal
would add nothing the token link did not already allow.
"""

import json
import re
import uuid
from decimal import Decimal

from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from .models import BookingRequest, CancellationPolicy, GuestAccount, Reservation
from .tests import day, make_property

LOCMEM = "django.core.mail.backends.locmem.EmailBackend"
EMAIL = "ana@example.com"


class CancellationBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        self.prop = make_property(name="Apartment A")
        mail.outbox = []

    def reservation(self, start=30, token=None, non_refundable=False):
        return Reservation.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            guest_email=EMAIL,
            platform="direct",
            check_in=day(start),
            check_out=day(start + 3),
            nightly_price_eur=Decimal("50.00"),
            booking_token=token or uuid.uuid4(),
            is_non_refundable=non_refundable,
        )


@override_settings(EMAIL_BACKEND=LOCMEM)
class ExistingTokenCancelTests(CancellationBase):
    """Characterisation of `booking_cancel` as it behaves today."""

    def cancel(self, token):
        return self.client.post(f"/api/booking/reservations/{token}/cancel/")

    def test_with_no_policy_configured_cancellation_is_free(self):
        reservation = self.reservation()
        response = self.cancel(reservation.booking_token)
        self.assertEqual(response.status_code, 200, response.content)
        reservation.refresh_from_db()
        self.assertTrue(reservation.is_archived)

    def test_a_free_policy_inside_its_window_cancels(self):
        CancellationPolicy.objects.create(
            scope="all", policy_type=CancellationPolicy.PolicyType.FREE, days_before_checkin=7
        )
        reservation = self.reservation(start=30)
        self.assertEqual(self.cancel(reservation.booking_token).status_code, 200)
        reservation.refresh_from_db()
        self.assertTrue(reservation.is_archived)

    def test_a_free_policy_outside_its_window_refuses(self):
        CancellationPolicy.objects.create(
            scope="all", policy_type=CancellationPolicy.PolicyType.FREE, days_before_checkin=30
        )
        reservation = self.reservation(start=2)  # too close
        response = self.cancel(reservation.booking_token)
        self.assertEqual(response.status_code, 400)
        self.assertIn("contactWhatsapp", response.json())
        reservation.refresh_from_db()
        self.assertFalse(reservation.is_archived)

    def test_a_non_refundable_booking_under_that_policy_refuses(self):
        CancellationPolicy.objects.create(
            scope="all",
            policy_type=CancellationPolicy.PolicyType.NON_REFUNDABLE,
            auto_process=True,
        )
        reservation = self.reservation(non_refundable=True)
        self.assertEqual(self.cancel(reservation.booking_token).status_code, 400)
        reservation.refresh_from_db()
        self.assertFalse(reservation.is_archived)

    def test_an_already_cancelled_reservation_is_refused(self):
        reservation = self.reservation()
        self.cancel(reservation.booking_token)
        self.assertEqual(self.cancel(reservation.booking_token).status_code, 400)

    def test_a_partial_policy_with_no_percentage_refuses(self):
        """A deliberate change from the old behaviour.

        A partial policy with no refund_pct set is a misconfiguration, not a
        100% cancellation fee. The old code cancelled the booking and quietly
        refunded nothing; refusing surfaces the problem to staff instead of
        charging a guest for it.
        """
        CancellationPolicy.objects.create(
            scope="all",
            policy_type=CancellationPolicy.PolicyType.PARTIAL,
            auto_process=True,
            refund_pct=None,
        )
        reservation = self.reservation()
        self.assertEqual(self.cancel(reservation.booking_token).status_code, 400)
        reservation.refresh_from_db()
        self.assertFalse(reservation.is_archived)

    def test_a_partial_policy_with_a_percentage_still_cancels(self):
        CancellationPolicy.objects.create(
            scope="all",
            policy_type=CancellationPolicy.PolicyType.PARTIAL,
            auto_process=True,
            refund_pct=Decimal("50.00"),
        )
        reservation = self.reservation()
        self.assertEqual(self.cancel(reservation.booking_token).status_code, 200)

    def test_an_unknown_token_is_not_found(self):
        self.assertEqual(self.cancel(uuid.uuid4()).status_code, 404)


@override_settings(EMAIL_BACKEND=LOCMEM, GUEST_PORTAL_URL="https://stay.example.com")
class GuestPortalCancelTests(CancellationBase):
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
        reservation = self.reservation(start=start)
        request = self.booking(email=email, start=start, status=BookingRequest.Status.APPROVED)
        request.reservation = reservation
        request.save(update_fields=["reservation"])
        return request

    def sign_in(self, email=EMAIL):
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

    def cancel(self, booking_id):
        return self.client.post(f"/api/guest/bookings/{booking_id}/cancel/")

    def test_a_guest_can_cancel_their_pending_request(self):
        request = self.booking()
        self.sign_in()
        response = self.cancel(request.id)
        self.assertEqual(response.status_code, 200, response.content)
        request.refresh_from_db()
        self.assertEqual(request.status, BookingRequest.Status.REJECTED)
        self.assertEqual(request.rejection_message, "Cancelled by guest.")

    def test_a_guest_can_cancel_a_confirmed_booking(self):
        request = self.confirmed()
        self.sign_in()
        self.assertEqual(self.cancel(request.id).status_code, 200)
        request.reservation.refresh_from_db()
        self.assertTrue(request.reservation.is_archived)

    def test_a_refused_policy_is_reported_and_changes_nothing(self):
        CancellationPolicy.objects.create(
            scope="all", policy_type=CancellationPolicy.PolicyType.FREE, days_before_checkin=30
        )
        request = self.confirmed(start=2)
        self.sign_in()
        response = self.cancel(request.id)
        self.assertEqual(response.status_code, 400)
        request.reservation.refresh_from_db()
        self.assertFalse(request.reservation.is_archived)

    def test_another_accounts_booking_cannot_be_cancelled(self):
        theirs = self.booking(email="someone.else@example.com")
        self.booking()  # so this account has a booking of its own
        self.sign_in()

        self.assertEqual(self.cancel(theirs.id).status_code, 404)
        theirs.refresh_from_db()
        self.assertEqual(theirs.status, BookingRequest.Status.PENDING, "left untouched")

    def test_an_unknown_id_answers_exactly_like_someone_elses(self):
        """No oracle for "this exists but is not yours"."""
        theirs = self.booking(email="someone.else@example.com")
        self.booking()
        self.sign_in()

        mine = self.cancel(uuid.uuid4())
        other = self.cancel(theirs.id)
        self.assertEqual((mine.status_code, mine.content), (other.status_code, other.content))

    def test_cancelling_twice_is_refused(self):
        request = self.booking()
        self.sign_in()
        self.cancel(request.id)
        self.assertEqual(self.cancel(request.id).status_code, 400)

    def test_the_portal_says_nothing_about_refunds(self):
        """Guests pay at the property. There is no online payment to refund,
        and the portal must not imply there is one."""
        request = self.booking()
        self.sign_in()
        body = self.cancel(request.id).json()
        self.assertNotIn("refundAmount", body)
        self.assertNotIn("refund", self.cancel.__doc__ or "")

    def test_a_booking_never_carries_a_payment_field(self):
        self.booking()
        self.sign_in()
        row = self.client.get("/api/guest/bookings/").json()["bookings"][0]
        for banned in ("paidEur", "owedEur", "refundAmount", "onlinePaymentStatus"):
            self.assertNotIn(banned, row)

    def test_an_anonymous_visitor_cannot_cancel(self):
        request = self.booking()
        self.assertEqual(self.cancel(request.id).status_code, 401)
        request.refresh_from_db()
        self.assertEqual(request.status, BookingRequest.Status.PENDING)
