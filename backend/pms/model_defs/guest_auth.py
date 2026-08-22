"""Guest sign-in: an account, and the short-lived links that open it.

A `GuestAccount` is a login and nothing more. It is deliberately **not** related
to `Guest`, which is the staff-facing CRM record built from name and phone —
linking them would reintroduce the cross-matching the portal design rules out,
and `Guest` rows carry passport scans that must stay unreachable from a guest
session.

`GuestLoginLink` follows `LoginChallenge` in security.py: the secret is hashed
at rest, links are single-use, short-lived, and capped per account. It differs
in two ways, both because a link is a URL rather than a typed code:

* **Split into selector and verifier.** A salted hash cannot be queried, so a
  single hashed secret would mean scanning every row to find a match. The
  selector is the safe half to look up by; the verifier is the half that is
  hashed and compared in constant time.
* **No attempt counter.** A six-digit code needs one — there are only a million.
  A 256-bit verifier does not.
"""

import secrets
import uuid
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.db import models, transaction
from django.utils import timezone

# Long enough to survive a slow inbox, short enough that a link sitting in a
# forwarded email is not a standing key.
LINK_TTL_MINUTES = 20

# Ceiling on links per account per hour. Bounds outbound mail, and stops one
# address being used to hammer the mail provider quota.
MAX_LINKS_PER_HOUR = 5

# How long a signed-in guest stays signed in.
SESSION_DAYS = 30


class GuestAccount(models.Model):
    """Someone who has asked to sign in. Never a django.contrib.auth.User."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["email"]

    def __str__(self):
        return self.email

    @staticmethod
    def normalise(email):
        """One spelling per address, so case cannot split an account in two."""
        return (email or "").strip().lower()

    def save(self, *args, **kwargs):
        self.email = self.normalise(self.email)
        super().save(*args, **kwargs)

    @classmethod
    def for_email(cls, email):
        account, _ = cls.objects.get_or_create(email=cls.normalise(email))
        return account


class GuestLoginLink(models.Model):
    """One emailed sign-in link. Single use, short-lived, hashed at rest."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        GuestAccount, on_delete=models.CASCADE, related_name="login_links"
    )
    # The half that is safe to look up by.
    selector = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    # The half that proves it. Hashed, so a database read is not a login.
    verifier_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    request_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["account", "expires_at"])]

    def __str__(self):
        return f"Sign-in link for {self.account.email}"

    @classmethod
    def issue(cls, account, request_ip=None):
        """Create a link, returning (link, token). Only one is ever live."""
        cls.objects.filter(account=account, consumed_at__isnull=True).update(
            consumed_at=timezone.now()
        )
        verifier = secrets.token_urlsafe(32)
        link = cls.objects.create(
            account=account,
            verifier_hash=make_password(verifier),
            expires_at=timezone.now() + timedelta(minutes=LINK_TTL_MINUTES),
            request_ip=request_ip,
        )
        return link, f"{link.selector}.{verifier}"

    @classmethod
    def recent_count(cls, account, within_minutes=60):
        since = timezone.now() - timedelta(minutes=within_minutes)
        return cls.objects.filter(account=account, created_at__gte=since).count()

    @classmethod
    def purge_stale(cls, older_than_days=7):
        """Drop long-dead links so the table cannot grow without bound."""
        cutoff = timezone.now() - timedelta(days=older_than_days)
        return cls.objects.filter(created_at__lt=cutoff).delete()

    @property
    def is_usable(self):
        return self.consumed_at is None and timezone.now() < self.expires_at

    @classmethod
    def consume(cls, token):
        """Spend a token, returning its account, or None for anything wrong.

        One return value for every failure — unknown, malformed, expired,
        already used — so the caller cannot accidentally tell them apart and
        neither can whoever is holding the link.

        Consumption is locked, so two clicks on the same link cannot both
        succeed.
        """
        selector, _, verifier = (token or "").partition(".")
        if not selector or not verifier:
            return None
        try:
            selector = uuid.UUID(selector)
        except (ValueError, AttributeError, TypeError):
            return None

        with transaction.atomic():
            try:
                link = cls.objects.select_for_update().select_related("account").get(
                    selector=selector
                )
            except cls.DoesNotExist:
                return None

            if not link.is_usable:
                return None
            if not check_password(verifier, link.verifier_hash):
                return None

            link.consumed_at = timezone.now()
            link.save(update_fields=["consumed_at"])
            return link.account
