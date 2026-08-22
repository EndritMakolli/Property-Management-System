"""Cross-surface isolation: the tests that matter more than any feature here.

A guest portal was added to an application that stores passport scans, door
codes, lockbox codes, wifi passwords and every guest's financial history. These
tests assert the boundaries hold, and they are written to fail loudly if a
future change quietly moves one.

Four properties:

1. **A guest session reaches no staff endpoint.** Not "is forbidden" — 401,
   because a guest never becomes `request.user` at all. That single assertion is
   the whole identity design, checked rather than argued.
2. **A staff session is not a guest session.** The two must not be confusable in
   either direction.
3. **One account cannot reach another**, by id or by any query parameter.
4. **CSRF stays on.** Only the two pre-session endpoints are exempt. The test
   that fails the day someone "fixes" a CSRF error by reaching for
   `@csrf_exempt`.
"""

import json
import re
import uuid
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from .models import BookingRequest, GuestAccount
from .tests import day, make_property

LOCMEM = "django.core.mail.backends.locmem.EmailBackend"

# Every staff surface a guest might stumble onto. Adding a URL here is one line,
# so there is no excuse not to when a new staff endpoint appears.
STAFF_ENDPOINTS = [
    "/api/properties/",
    "/api/reservations/",
    "/api/codes/door/",
    "/api/codes/lockboxes/",
    "/api/guests/",
    "/api/clean-status/",
    "/api/finance/summary/",
    "/api/finance/expenses/",
    "/api/users/",
    "/api/booking-requests/",
    "/api/pricing-rules/",
    "/api/pricing-groups/",
    "/api/reservation-types/",
    "/api/message-templates/",
    "/api/maintenance/",
    "/api/sync-logs/",
    "/api/dashboard/forecast/",
    "/api/backup/export/",
]


@override_settings(EMAIL_BACKEND=LOCMEM, GUEST_PORTAL_URL="https://stay.example.com")
class IsolationTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        self.prop = make_property()
        mail.outbox = []

    def booking(self, email, start=30):
        return BookingRequest.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            guest_email=email,
            guest_phone="+38344111222",
            check_in=day(start),
            check_out=day(start + 3),
            total_price_eur=Decimal("150.00"),
        )

    def sign_in(self, email, client=None):
        client = client or self.client
        client.post(
            "/api/guest/auth/request-link/",
            data=json.dumps({"email": email}),
            content_type="application/json",
        )
        token = re.search(r"token=([^\s&]+)", mail.outbox[-1].body).group(1)
        client.post(
            "/api/guest/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )
        return GuestAccount.objects.get(email=email)

    def make_admin(self):
        group, _ = Group.objects.get_or_create(name="Admin")
        user = User.objects.create_user(username="admin", password="pw")
        user.groups.add(group)
        return user


class AGuestReachesNoStaffEndpointTests(IsolationTestCase):
    def test_every_staff_endpoint_refuses_a_guest_session(self):
        self.booking("ana@example.com")
        self.sign_in("ana@example.com")

        for url in STAFF_ENDPOINTS:
            with self.subTest(url=url):
                response = self.client.get(url)
                # 401, not 403: a guest never becomes request.user, so
                # require_roles sees an anonymous caller. This is the identity
                # design, asserted.
                self.assertEqual(response.status_code, 401, url)

    def test_a_guest_cannot_write_to_a_staff_endpoint(self):
        self.booking("ana@example.com")
        self.sign_in("ana@example.com")
        response = self.client.post(
            "/api/properties/", data={"name": "Mine now", "bedrooms": "1"}
        )
        self.assertIn(response.status_code, (401, 403))

    def test_a_guest_cannot_download_a_backup(self):
        """The archive carries every guest record and every uploaded file."""
        self.booking("ana@example.com")
        self.sign_in("ana@example.com")
        self.assertEqual(self.client.get("/api/backup/export/").status_code, 401)


class AStaffSessionIsNotAGuestSessionTests(IsolationTestCase):
    def test_an_admin_is_not_signed_in_to_the_portal(self):
        self.client.force_login(self.make_admin())
        self.assertFalse(
            self.client.get("/api/guest/auth/me/").json()["account"]["isAuthenticated"]
        )

    def test_an_admin_cannot_read_guest_bookings(self):
        self.client.force_login(self.make_admin())
        self.assertEqual(self.client.get("/api/guest/bookings/").status_code, 401)

    def test_an_admin_cannot_read_guest_stats(self):
        self.client.force_login(self.make_admin())
        self.assertEqual(self.client.get("/api/guest/stats/").status_code, 401)


class OneAccountCannotReachAnotherTests(IsolationTestCase):
    def setUp(self):
        super().setUp()
        self.mine = self.booking("ana@example.com", start=30)
        self.theirs = self.booking("someone.else@example.com", start=60)
        self.sign_in("ana@example.com")

    def test_the_list_holds_only_my_bookings(self):
        rows = self.client.get("/api/guest/bookings/").json()["bookings"]
        self.assertEqual([row["id"] for row in rows], [str(self.mine.id)])

    def test_a_query_parameter_cannot_widen_the_list(self):
        """The endpoints take no filters. This is what keeps it that way."""
        for probe in (
            "?email=someone.else@example.com",
            "?guest_email=someone.else@example.com",
            f"?id={self.theirs.id}",
            "?account=all",
            "?all=1",
        ):
            with self.subTest(probe=probe):
                rows = self.client.get(f"/api/guest/bookings/{probe}").json()["bookings"]
                self.assertEqual([row["id"] for row in rows], [str(self.mine.id)])

    def test_cancelling_someone_elses_booking_changes_nothing(self):
        response = self.client.post(f"/api/guest/bookings/{self.theirs.id}/cancel/")
        self.assertEqual(response.status_code, 404)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.status, BookingRequest.Status.PENDING)

    def test_an_unknown_id_is_answered_exactly_like_someone_elses(self):
        theirs = self.client.post(f"/api/guest/bookings/{self.theirs.id}/cancel/")
        unknown = self.client.post(f"/api/guest/bookings/{uuid.uuid4()}/cancel/")
        self.assertEqual(
            (theirs.status_code, theirs.content), (unknown.status_code, unknown.content)
        )


class CsrfPostureTests(IsolationTestCase):
    """Only the two pre-session endpoints may be exempt."""

    def setUp(self):
        super().setUp()
        # enforce_csrf_checks mirrors a browser; the default client disables it.
        self.client = Client(enforce_csrf_checks=True)
        self.booking("ana@example.com")

    def post(self, url, body=None):
        return self.client.post(
            url,
            data=json.dumps(body or {}),
            content_type="application/json",
        )

    def test_request_link_is_exempt(self):
        """Anonymous and pre-session, like the public booking endpoints."""
        self.assertNotEqual(self.post("/api/guest/auth/request-link/", {"email": "a@b.co"}).status_code, 403)

    def test_verify_is_exempt(self):
        self.assertNotEqual(self.post("/api/guest/auth/verify/", {"token": "x.y"}).status_code, 403)

    def test_logout_is_protected(self):
        self.assertEqual(self.post("/api/guest/auth/logout/").status_code, 403)

    def test_cancel_is_protected(self):
        booking = BookingRequest.objects.first()
        self.assertEqual(
            self.post(f"/api/guest/bookings/{booking.id}/cancel/").status_code, 403
        )
