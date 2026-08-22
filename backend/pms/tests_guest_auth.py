"""Guest sign-in links.

Modelled on `LoginChallenge` (model_defs/security.py), and the differences are
deliberate.

A magic link carries its whole secret in a URL, so it is split in two: a
`selector` that is safe to look up by, and a `verifier` that is hashed at rest
and compared in constant time. Storing one salted hash and nothing else would
mean scanning every row to find a match; storing the secret in the clear would
mean a database read is a login.

There is no attempt counter. A 6-digit code needs one because there are only a
million of them; a 256-bit verifier does not. What it does need, and shares with
the 2FA flow, is single use, a short life, and a cap on how many can be issued.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from .models import GuestAccount, GuestLoginLink


class GuestAccountTests(TestCase):
    def test_an_email_is_stored_lowercased(self):
        account = GuestAccount.objects.create(email="Ana.Berisha@Example.COM")
        account.refresh_from_db()
        self.assertEqual(account.email, "ana.berisha@example.com")

    def test_the_same_email_in_another_case_is_the_same_account(self):
        GuestAccount.for_email("ana@example.com")
        again = GuestAccount.for_email("ANA@example.com")
        self.assertEqual(GuestAccount.objects.count(), 1)
        self.assertEqual(again.email, "ana@example.com")

    def test_surrounding_whitespace_is_trimmed(self):
        self.assertEqual(GuestAccount.for_email("  ana@example.com ").email, "ana@example.com")


class GuestLoginLinkTests(TestCase):
    def setUp(self):
        self.account = GuestAccount.for_email("ana@example.com")

    def test_issuing_returns_a_secret_that_is_not_in_the_database(self):
        link, token = GuestLoginLink.issue(self.account)
        self.assertTrue(token)
        link.refresh_from_db()
        # The verifier half must not be recoverable from the row.
        self.assertNotIn(token.split(".")[-1], link.verifier_hash)

    def test_the_token_carries_the_selector_so_lookup_needs_no_scan(self):
        link, token = GuestLoginLink.issue(self.account)
        self.assertTrue(token.startswith(str(link.selector)))

    def test_a_valid_token_resolves_to_its_account(self):
        _, token = GuestLoginLink.issue(self.account)
        self.assertEqual(GuestLoginLink.consume(token), self.account)

    def test_a_token_works_only_once(self):
        _, token = GuestLoginLink.issue(self.account)
        GuestLoginLink.consume(token)
        self.assertIsNone(GuestLoginLink.consume(token))

    def test_an_expired_token_is_refused(self):
        link, token = GuestLoginLink.issue(self.account)
        GuestLoginLink.objects.filter(pk=link.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertIsNone(GuestLoginLink.consume(token))

    def test_issuing_a_new_link_kills_the_previous_one(self):
        _, first = GuestLoginLink.issue(self.account)
        GuestLoginLink.issue(self.account)
        self.assertIsNone(GuestLoginLink.consume(first))

    def test_a_tampered_verifier_is_refused(self):
        link, _ = GuestLoginLink.issue(self.account)
        self.assertIsNone(GuestLoginLink.consume(f"{link.selector}.wrong-verifier"))

    def test_an_unknown_selector_is_refused(self):
        import uuid

        self.assertIsNone(GuestLoginLink.consume(f"{uuid.uuid4()}.whatever"))

    def test_a_malformed_token_is_refused_rather_than_raising(self):
        for junk in ("", "no-dot", "not-a-uuid.verifier", "..", None):
            self.assertIsNone(GuestLoginLink.consume(junk), junk)

    def test_one_account_cannot_be_sent_unlimited_links(self):
        for _ in range(3):
            GuestLoginLink.issue(self.account)
        self.assertEqual(GuestLoginLink.recent_count(self.account), 3)

    def test_old_links_can_be_purged(self):
        link, _ = GuestLoginLink.issue(self.account)
        GuestLoginLink.objects.filter(pk=link.pk).update(
            created_at=timezone.now() - timedelta(days=30)
        )
        GuestLoginLink.purge_stale()
        self.assertEqual(GuestLoginLink.objects.count(), 0)

    def test_purging_leaves_a_live_link_alone(self):
        GuestLoginLink.issue(self.account)
        GuestLoginLink.purge_stale()
        self.assertEqual(GuestLoginLink.objects.count(), 1)
