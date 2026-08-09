"""Tests for email two-step verification.

The property under test throughout: a correct password alone must never create
an authenticated session once 2FA is on.
"""

import json
import re
from datetime import timedelta

from django.contrib.auth.models import Group, User
from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .model_defs.security import MAX_ATTEMPTS, MAX_CODES_PER_HOUR
from .models import LoginChallenge, UserSecurity


def make_user(username="staffer", password="corr3ct-horse-battery", role="Admin"):
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password=password)
    user.groups.add(group)
    return user


def code_from_outbox():
    """Pull the 6-digit code out of the most recent email."""
    match = re.search(r"\b(\d{6})\b", mail.outbox[-1].body)
    return match.group(1) if match else None


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class TwoFactorLoginTests(TestCase):
    def setUp(self):
        cache.clear()  # the login throttle is per-IP; don't bleed across tests
        self.client = Client()
        self.password = "corr3ct-horse-battery"
        self.user = make_user(password=self.password)
        security = UserSecurity.for_user(self.user)
        security.two_factor_email = "staffer@example.com"
        security.two_factor_enabled = True
        security.save()
        mail.outbox = []

    def login(self, password=None):
        return self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": self.user.username, "password": password or self.password}),
            content_type="application/json",
        )

    def verify(self, token, code):
        return self.client.post(
            "/api/auth/login/verify/",
            data=json.dumps({"challengeToken": token, "code": code}),
            content_type="application/json",
        )

    def assert_not_signed_in(self):
        me = self.client.get("/api/auth/me/").json()
        self.assertFalse(me["user"]["isAuthenticated"])

    # ── The core property ────────────────────────────────────────────────

    def test_password_alone_does_not_create_a_session(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["twoFactorRequired"])
        self.assertNotIn("user", body)
        self.assert_not_signed_in()

    def test_full_flow_signs_in(self):
        token = self.login().json()["challengeToken"]
        self.assertEqual(len(mail.outbox), 1)
        response = self.verify(token, code_from_outbox())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["user"]["isAuthenticated"])
        self.assertTrue(self.client.get("/api/auth/me/").json()["user"]["isAuthenticated"])

    def test_wrong_code_is_rejected_and_leaves_no_session(self):
        token = self.login().json()["challengeToken"]
        real = code_from_outbox()
        wrong = "000000" if real != "000000" else "111111"
        self.assertEqual(self.verify(token, wrong).status_code, 400)
        self.assert_not_signed_in()

    # ── Brute force and replay ───────────────────────────────────────────

    def test_code_is_capped_at_max_attempts(self):
        token = self.login().json()["challengeToken"]
        real = code_from_outbox()
        wrong = "000000" if real != "000000" else "111111"
        for _ in range(MAX_ATTEMPTS):
            self.verify(token, wrong)
        # Even the CORRECT code must now fail — the challenge is burned.
        self.assertEqual(self.verify(token, real).status_code, 400)
        self.assert_not_signed_in()

    def test_code_is_single_use(self):
        token = self.login().json()["challengeToken"]
        code = code_from_outbox()
        self.assertEqual(self.verify(token, code).status_code, 200)
        self.client.post("/api/auth/logout/")
        self.assertEqual(self.verify(token, code).status_code, 400)
        self.assert_not_signed_in()

    def test_expired_code_is_rejected(self):
        token = self.login().json()["challengeToken"]
        code = code_from_outbox()
        LoginChallenge.objects.filter(token=token).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.verify(token, code).status_code, 400)
        self.assert_not_signed_in()

    def test_new_login_invalidates_the_previous_code(self):
        first_token = self.login().json()["challengeToken"]
        first_code = code_from_outbox()
        self.login()  # a second attempt supersedes the first
        self.assertEqual(self.verify(first_token, first_code).status_code, 400)
        self.assert_not_signed_in()

    def test_resend_does_not_reset_the_attempt_budget(self):
        # Otherwise "guess 5, resend, repeat" makes MAX_ATTEMPTS meaningless and
        # a 6-digit code becomes brute-forceable.
        token = self.login().json()["challengeToken"]
        real = code_from_outbox()
        wrong = "000000" if real != "000000" else "111111"
        for _ in range(MAX_ATTEMPTS):
            self.verify(token, wrong)

        response = self.client.post(
            "/api/auth/login/resend/",
            data=json.dumps({"challengeToken": token}),
            content_type="application/json",
        )
        # Responds generically, but must NOT mint a usable new challenge.
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("challengeToken", response.json())
        self.assert_not_signed_in()

    def test_resend_is_capped_per_account(self):
        token = self.login().json()["challengeToken"]
        for _ in range(MAX_CODES_PER_HOUR + 3):
            response = self.client.post(
                "/api/auth/login/resend/",
                data=json.dumps({"challengeToken": token}),
                content_type="application/json",
            )
            token = response.json().get("challengeToken", token)
        # The per-account hourly cap bounds outbound mail, so one account cannot
        # burn the SMTP quota and lock every 2FA user out (login fails closed).
        self.assertLessEqual(len(mail.outbox), MAX_CODES_PER_HOUR)

    def test_unknown_challenge_token_is_rejected(self):
        response = self.verify("11111111-1111-1111-1111-111111111111", "123456")
        self.assertEqual(response.status_code, 400)

    def test_malformed_challenge_token_does_not_500(self):
        self.assertEqual(self.verify("not-a-uuid", "123456").status_code, 400)

    # ── Code quality ─────────────────────────────────────────────────────

    def test_code_is_never_stored_in_plaintext(self):
        self.login()
        code = code_from_outbox()
        challenge = LoginChallenge.objects.latest("created_at")
        self.assertNotIn(code, challenge.code_hash)
        self.assertNotEqual(challenge.code_hash, code)

    def test_email_goes_to_the_configured_address_only(self):
        self.login()
        self.assertEqual(mail.outbox[-1].to, ["staffer@example.com"])

    # ── Wrong password / inactive ────────────────────────────────────────

    def test_wrong_password_never_issues_a_challenge(self):
        response = self.login(password="wrong-password")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(LoginChallenge.objects.count(), 0)

    def test_inactive_user_is_refused_after_verifying(self):
        token = self.login().json()["challengeToken"]
        code = code_from_outbox()
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.verify(token, code).status_code, 403)
        self.assert_not_signed_in()

    # ── Users without 2FA are unaffected ─────────────────────────────────

    def test_user_without_two_factor_logs_in_directly(self):
        other = make_user(username="plainuser", password=self.password)
        response = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": other.username, "password": self.password}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["user"]["isAuthenticated"])
        self.assertEqual(len(mail.outbox), 0)

    def test_enabled_without_an_email_does_not_enforce(self):
        # is_active requires BOTH the flag and an address — otherwise enabling
        # 2FA with no inbox would lock the account out entirely.
        security = UserSecurity.for_user(self.user)
        security.two_factor_email = ""
        security.save()
        response = self.login()
        self.assertTrue(response.json()["user"]["isAuthenticated"])


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class TwoFactorSettingsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        self.password = "corr3ct-horse-battery"
        self.user = make_user(password=self.password)
        self.client.force_login(self.user)

    def patch_security(self, payload):
        return self.client.patch(
            "/api/auth/security/",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_user_can_set_their_own_verification_email(self):
        response = self.patch_security(
            {"twoFactorEmail": "me@example.com", "twoFactorEnabled": True}
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()["security"]
        self.assertTrue(body["twoFactorActive"])
        self.assertEqual(body["twoFactorEmail"], "me@example.com")

    def test_enabling_without_an_email_is_rejected(self):
        response = self.patch_security({"twoFactorEmail": "", "twoFactorEnabled": True})
        self.assertEqual(response.status_code, 400)

    def test_invalid_email_is_rejected(self):
        response = self.patch_security(
            {"twoFactorEmail": "not-an-email", "twoFactorEnabled": True}
        )
        self.assertEqual(response.status_code, 400)

    def test_email_is_masked_in_the_hint(self):
        self.patch_security({"twoFactorEmail": "endrit@example.com", "twoFactorEnabled": True})
        hint = self.client.get("/api/auth/security/").json()["security"]["emailHint"]
        self.assertNotIn("endrit", hint)
        self.assertIn("@example.com", hint)

    def test_anonymous_cannot_read_security_settings(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/auth/security/").status_code, 401)

    def test_login_response_does_not_leak_the_full_email(self):
        self.patch_security({"twoFactorEmail": "endrit@example.com", "twoFactorEnabled": True})
        self.client.logout()
        body = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": self.user.username, "password": self.password}),
            content_type="application/json",
        ).json()
        self.assertNotIn("endrit@example.com", json.dumps(body))


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class SecurityHardeningTests(TestCase):
    """Guards added after the pre-hosting security audit."""

    def setUp(self):
        cache.clear()
        self.client = Client()
        self.password = "corr3ct-horse-battery"
        self.user = make_user(password=self.password)

    def test_django_admin_is_not_exposed_by_default(self):
        # The admin login form does not enforce this app's 2FA, and the session
        # it mints is trusted by the whole API — so the route stays off.
        self.assertEqual(self.client.get("/admin/").status_code, 404)
        self.assertEqual(self.client.get("/admin/login/").status_code, 404)

    def test_weak_passwords_are_rejected_on_account_creation(self):
        self.client.force_login(self.user)
        response = self.client.post(
            "/api/users/",
            data=json.dumps({"username": "newbie", "password": "1", "role": "cleaning"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(User.objects.filter(username="newbie").exists())

    def test_disabling_two_factor_requires_the_password(self):
        security = UserSecurity.for_user(self.user)
        security.two_factor_email = "staffer@example.com"
        security.two_factor_enabled = True
        security.save()
        self.client.force_login(self.user)

        without = self.client.patch(
            "/api/auth/security/",
            data=json.dumps({"twoFactorEnabled": False}),
            content_type="application/json",
        )
        self.assertEqual(without.status_code, 400)
        self.assertTrue(UserSecurity.for_user(self.user).is_active)

        with_password = self.client.patch(
            "/api/auth/security/",
            data=json.dumps({"twoFactorEnabled": False, "currentPassword": self.password}),
            content_type="application/json",
        )
        self.assertEqual(with_password.status_code, 200, with_password.content)
        self.assertFalse(UserSecurity.for_user(self.user).is_active)


class IcalSsrfTests(TestCase):
    """The iCal URL is operator-supplied and fetched server-side."""

    def test_internal_addresses_are_refused(self):
        from django.core.exceptions import ValidationError as DjangoValidationError

        from .views._ical import fetch_ical_events

        for url in (
            "http://127.0.0.1:8000/x.ics",
            "http://localhost/x.ics",
            "http://169.254.169.254/latest/meta-data/",
            "file:///etc/passwd",
        ):
            with self.subTest(url=url):
                with self.assertRaises(DjangoValidationError):
                    fetch_ical_events(url)


class UploadValidationTests(TestCase):
    """Uploads are served back by filename, so extension must be constrained."""

    def setUp(self):
        cache.clear()
        self.client = Client()
        self.user = make_user(password="corr3ct-horse-battery")
        self.client.force_login(self.user)

    def test_html_upload_is_rejected(self):
        from .views._expense_ai import _validate_upload

        from django.core.files.uploadedfile import SimpleUploadedFile

        payload = SimpleUploadedFile("evil.html", b"<script>alert(1)</script>", content_type="image/png")
        # A truthful-looking content type must not get an executable extension in.
        self.assertIsNotNone(_validate_upload(payload))

    def test_svg_upload_is_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from .views._expense_ai import _validate_upload

        payload = SimpleUploadedFile("x.svg", b"<svg onload=alert(1)>", content_type="image/png")
        self.assertIsNotNone(_validate_upload(payload))

    def test_ordinary_image_is_accepted(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from .views._expense_ai import _validate_upload

        payload = SimpleUploadedFile("scan.png", b"\x89PNG", content_type="image/png")
        self.assertIsNone(_validate_upload(payload))


class RateLimitClientIpTests(TestCase):
    """The throttle must never 500 because a proxy header is absent.

    django-ratelimit raises ImproperlyConfigured when RATELIMIT_IP_META_KEY
    names a header that is not on the request, which turned every throttled
    endpoint - including login - into a 500 for unproxied requests.
    """

    def setUp(self):
        cache.clear()
        self.client = Client()

    def _login(self, **extra):
        return self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": "nobody", "password": "nothing"}),
            content_type="application/json",
            **extra,
        )

    def test_login_without_forwarded_header_does_not_500(self):
        response = self._login()
        self.assertEqual(response.status_code, 400, response.content)

    def test_login_with_forwarded_header_does_not_500(self):
        response = self._login(HTTP_X_FORWARDED_FOR="203.0.113.9, 10.0.0.1")
        self.assertEqual(response.status_code, 400, response.content)

    def test_resolver_prefers_client_ip_when_proxy_is_trusted(self):
        from django.test import RequestFactory

        from .views._utils import ratelimit_client_ip

        request = RequestFactory().get("/")
        request.META["REMOTE_ADDR"] = "10.0.0.1"
        request.META["HTTP_X_FORWARDED_FOR"] = "203.0.113.9, 10.0.0.1"

        with override_settings(TRUST_PROXY_HEADERS=True):
            # Left-most entry is the real client, not the proxy hop.
            self.assertEqual(ratelimit_client_ip(request), "203.0.113.9")
        with override_settings(TRUST_PROXY_HEADERS=False):
            # Untrusted: the header is attacker-supplied, so ignore it.
            self.assertEqual(ratelimit_client_ip(request), "10.0.0.1")

    def test_resolver_never_raises_on_a_bare_request(self):
        from django.test import RequestFactory

        from .views._utils import ratelimit_client_ip

        request = RequestFactory().get("/")
        request.META.pop("REMOTE_ADDR", None)
        with override_settings(TRUST_PROXY_HEADERS=True):
            self.assertTrue(ratelimit_client_ip(request))
