"""The guest sign-in endpoints.

Two properties are worth more than the happy path here.

**The endpoint must not reveal who has booked with you.** `request-link` answers
identically whether or not the address is known — same status, same body — and
`verify` answers identically for a token that is unknown, expired, or already
spent. Anything less turns a public endpoint into a way to ask "has this person
stayed here?", which is a question about someone else's private life.

**It must not become an open mail relay.** A link is only sent to an address
that already booked through the site. Without that check, anyone could make this
server email any address, as often as the rate limit allows. The response is the
same either way, so the check costs nothing in enumeration resistance — and it
makes "can sign in" and "can see something once signed in" the same set.
"""

import json
import re

from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from decimal import Decimal

from .models import BookingRequest, GuestAccount, GuestLoginLink
from .model_defs.guest_auth import MAX_LINKS_PER_HOUR
from .tests import day, make_property

LOCMEM = "django.core.mail.backends.locmem.EmailBackend"
EMAIL = "ana@example.com"


def token_from_outbox():
    """Pull the sign-in token out of the link in the most recent email."""
    match = re.search(r"token=([^\s&]+)", mail.outbox[-1].body)
    return match.group(1) if match else None


@override_settings(EMAIL_BACKEND=LOCMEM, GUEST_PORTAL_URL="https://stay.example.com")
class GuestAuthTestCase(TestCase):
    def setUp(self):
        cache.clear()  # the throttle is IP-keyed and would bleed between tests
        self.client = Client()
        self.prop = make_property()
        mail.outbox = []

    def booked(self, email=EMAIL):
        """An address that has actually booked through the site."""
        BookingRequest.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            guest_email=email,
            guest_phone="+38344111222",
            check_in=day(30),
            check_out=day(33),
            total_price_eur=Decimal("150.00"),
        )
        return email

    def request_link(self, email):
        return self.client.post(
            "/api/guest/auth/request-link/",
            data=json.dumps({"email": email}),
            content_type="application/json",
        )

    def verify(self, token):
        return self.client.post(
            "/api/guest/auth/verify/",
            data=json.dumps({"token": token}),
            content_type="application/json",
        )

    def me(self):
        return self.client.get("/api/guest/auth/me/").json()


class EnumerationResistanceTests(GuestAuthTestCase):
    def test_a_known_and_an_unknown_address_are_answered_identically(self):
        self.booked()
        known = self.request_link(EMAIL)
        cache.clear()
        unknown = self.request_link("stranger@example.com")

        self.assertEqual(known.status_code, unknown.status_code)
        self.assertEqual(known.content, unknown.content)

    def test_an_address_that_never_booked_is_sent_nothing(self):
        response = self.request_link("stranger@example.com")
        self.assertEqual(response.json(), {"sent": True})
        self.assertEqual(len(mail.outbox), 0)

    def test_an_address_that_never_booked_does_not_become_an_account(self):
        """No account, no row, no trace — and no mail this server did not owe."""
        self.request_link("stranger@example.com")
        self.assertFalse(GuestAccount.objects.filter(email="stranger@example.com").exists())

    def test_an_address_that_booked_is_sent_a_link(self):
        self.booked()
        self.request_link(EMAIL)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [EMAIL])

    def test_an_address_that_only_staff_typed_in_is_sent_nothing(self):
        from .models import Reservation

        Reservation.objects.create(
            property=self.prop,
            guest_name="Ana",
            guest_email="typed.in@example.com",
            platform="private",
            check_in=day(1),
            check_out=day(3),
            nightly_price_eur=Decimal("50.00"),
        )
        self.request_link("typed.in@example.com")
        self.assertEqual(len(mail.outbox), 0)

    def test_unknown_expired_and_spent_tokens_are_indistinguishable(self):
        import uuid
        from django.utils import timezone
        from datetime import timedelta

        self.booked()
        self.request_link(EMAIL)
        spent = token_from_outbox()
        self.verify(spent)  # spend it

        account = GuestAccount.objects.get(email=EMAIL)
        link, expired = GuestLoginLink.issue(account)
        GuestLoginLink.objects.filter(pk=link.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )

        answers = {
            (r.status_code, r.content)
            for r in (
                self.verify(f"{uuid.uuid4()}.nonsense"),
                self.verify(expired),
                self.verify(spent),
            )
        }
        self.assertEqual(len(answers), 1, "the three failures must look the same")


class SignInTests(GuestAuthTestCase):
    def test_a_link_signs_the_guest_in(self):
        self.booked()
        self.request_link(EMAIL)
        response = self.verify(token_from_outbox())

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(self.me()["account"]["isAuthenticated"])
        self.assertEqual(self.me()["account"]["email"], EMAIL)

    def test_a_link_cannot_be_used_twice(self):
        self.booked()
        self.request_link(EMAIL)
        token = token_from_outbox()
        self.verify(token)
        self.client.post("/api/guest/auth/logout/")

        self.assertEqual(self.verify(token).status_code, 400)
        self.assertFalse(self.me()["account"]["isAuthenticated"])

    def test_signing_in_rotates_the_session_key(self):
        self.booked()
        self.client.get("/api/guest/auth/me/")  # establish a session
        before = self.client.session.session_key
        self.request_link(EMAIL)
        self.verify(token_from_outbox())
        self.assertNotEqual(self.client.session.session_key, before)

    def test_the_email_carries_a_link_to_the_public_site(self):
        self.booked()
        self.request_link(EMAIL)
        self.assertIn("https://stay.example.com", mail.outbox[0].body)
        self.assertIn("token=", mail.outbox[0].body)

    def test_the_account_shape_has_no_role(self):
        """It must never be mistakable for the staff payload."""
        self.booked()
        self.request_link(EMAIL)
        self.verify(token_from_outbox())
        self.assertNotIn("role", self.me()["account"])

    def test_me_hands_back_a_csrf_token(self):
        """So the portal can POST without depending on the staff provider."""
        self.assertTrue(self.me()["csrfToken"])

    def test_an_anonymous_visitor_is_reported_as_such(self):
        self.assertFalse(self.me()["account"]["isAuthenticated"])


class RateAndFailureTests(GuestAuthTestCase):
    def test_one_address_cannot_be_mailed_without_limit(self):
        self.booked()
        for _ in range(MAX_LINKS_PER_HOUR + 3):
            self.request_link(EMAIL)
        self.assertEqual(len(mail.outbox), MAX_LINKS_PER_HOUR)

    def test_being_capped_still_answers_sent(self):
        self.booked()
        for _ in range(MAX_LINKS_PER_HOUR):
            self.request_link(EMAIL)
        self.assertEqual(self.request_link(EMAIL).json(), {"sent": True})

    def test_a_malformed_address_is_refused(self):
        response = self.request_link("not-an-email")
        self.assertEqual(response.status_code, 400)

    def test_a_missing_address_is_refused(self):
        self.assertEqual(self.request_link("").status_code, 400)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.dummy.EmailBackend")
    def test_a_failed_send_still_answers_sent(self):
        """Fails open, and silently: saying so would be the oracle this
        endpoint exists to avoid. The operator sees it in the log."""
        self.booked()
        with self.assertLogs("pms.views._guest_auth", level="ERROR"):
            response = self.request_link(EMAIL)
        self.assertEqual(response.json(), {"sent": True})


class SignOutTests(GuestAuthTestCase):
    def test_signing_out_ends_the_guest_session(self):
        self.booked()
        self.request_link(EMAIL)
        self.verify(token_from_outbox())
        self.client.post("/api/guest/auth/logout/")
        self.assertFalse(self.me()["account"]["isAuthenticated"])

    def test_signing_out_leaves_a_staff_session_alone(self):
        from django.contrib.auth.models import Group, User

        self.booked()
        self.request_link(EMAIL)
        self.verify(token_from_outbox())

        group, _ = Group.objects.get_or_create(name="Admin")
        staff = User.objects.create_user(username="admin", password="pw")
        staff.groups.add(group)
        self.client.force_login(staff)

        self.client.post("/api/guest/auth/logout/")

        self.assertTrue(self.client.get("/api/auth/me/").json()["user"]["isAuthenticated"])
