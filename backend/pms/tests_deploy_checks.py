"""Configuration that is fine in development and wrong in production.

Three settings were still carrying development values on a hosted app, and
nothing said so: `GUEST_PORTAL_URL` pointing at localhost (so every emailed
sign-in link lands nowhere), `DEBUG` on (so a stack trace is served to whoever
triggers one), and a consumer Gmail account as the transactional sender.

None of those is detectable by reading the code - only by reading the running
config - so they become Django system checks. `manage.py check --deploy` then
fails the deployment rather than the operator discovering it from a guest who
cannot sign in.

The checks are deliberately quiet while DEBUG is on: they describe production
mistakes, and firing them on every developer's machine is how a warning gets
ignored.
"""

from django.test import SimpleTestCase, override_settings

from .checks import check_production_config


def run(**settings):
    with override_settings(**settings):
        return {issue.id for issue in check_production_config(None)}


BASE = {
    "DEBUG": False,
    "GUEST_PORTAL_URL": "https://stay.example.com",
    "DEFAULT_FROM_EMAIL": "bookings@example.com",
    "ONLINE_PAYMENTS_ENABLED": False,
}


class ProductionConfigChecksTests(SimpleTestCase):
    def test_a_correct_production_config_reports_nothing(self):
        self.assertEqual(run(**BASE), set())

    def test_debug_on_is_an_error(self):
        self.assertIn("pms.E001", run(**{**BASE, "DEBUG": True}))

    def test_a_localhost_portal_url_is_an_error(self):
        """Every emailed sign-in link would land on the operator's own laptop."""
        self.assertIn("pms.E002", run(**{**BASE, "GUEST_PORTAL_URL": "http://localhost:5173"}))

    def test_a_127_portal_url_is_an_error_too(self):
        self.assertIn("pms.E002", run(**{**BASE, "GUEST_PORTAL_URL": "http://127.0.0.1:5173"}))

    def test_an_empty_portal_url_is_an_error(self):
        """Unset is not safer than wrong - no guest can sign in either way."""
        self.assertIn("pms.E002", run(**{**BASE, "GUEST_PORTAL_URL": ""}))

    def test_a_consumer_mailbox_as_the_sender_is_a_warning(self):
        """Gmail caps a consumer account at a few hundred a day and will
        eventually refuse. It works until the day it matters."""
        self.assertIn("pms.W001", run(**{**BASE, "DEFAULT_FROM_EMAIL": "someone@gmail.com"}))

    def test_a_company_domain_sender_is_fine(self):
        self.assertNotIn("pms.W001", run(**{**BASE, "DEFAULT_FROM_EMAIL": "bookings@airstay.example"}))

    def test_online_payments_on_is_a_warning(self):
        """The payment step is a stub. If it is ever switched on, say so loudly
        rather than letting reservations record money nobody took."""
        self.assertIn("pms.W002", run(**{**BASE, "ONLINE_PAYMENTS_ENABLED": True}))

    def test_nothing_fires_while_debug_is_on(self):
        """These describe production mistakes. Firing them on every developer's
        machine is how a warning stops being read."""
        noisy = {
            "DEBUG": True,
            "GUEST_PORTAL_URL": "http://localhost:5173",
            "DEFAULT_FROM_EMAIL": "someone@gmail.com",
            "ONLINE_PAYMENTS_ENABLED": True,
        }
        self.assertEqual(run(**noisy), {"pms.E001"})
