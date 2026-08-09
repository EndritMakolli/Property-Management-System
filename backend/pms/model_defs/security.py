"""Two-factor authentication: per-user settings and short-lived login challenges."""

import secrets
import uuid
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.db import models, transaction
from django.utils import timezone

# A login challenge is deliberately short-lived and attempt-capped: a 6-digit
# code has only 10^6 possibilities, so unlimited guesses would be trivial.
CODE_TTL_MINUTES = 10
MAX_ATTEMPTS = 5
CODE_DIGITS = 6
# Ceiling on codes issued per account per hour. Without it, repeatedly asking
# for a new code would reset the attempt counter and also let one account
# exhaust the mail provider's daily quota.
MAX_CODES_PER_HOUR = 5


class UserSecurity(models.Model):
    """Per-user two-factor settings.

    The verification email is kept separate from User.email so enabling 2FA is
    an explicit, deliberate act rather than a side effect of an email being set
    somewhere else in the admin.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="security")
    two_factor_email = models.EmailField(blank=True, default="")
    two_factor_enabled = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "User security settings"

    def __str__(self):
        state = "on" if self.is_active else "off"
        return f"{self.user.username} — 2FA {state}"

    @property
    def is_active(self):
        """2FA only counts as on when there is somewhere to send the code."""
        return bool(self.two_factor_enabled and self.two_factor_email)

    @classmethod
    def for_user(cls, user):
        obj, _ = cls.objects.get_or_create(user=user)
        return obj

    def masked_email(self):
        """e.g. 'en****@gmail.com' — enough to recognise, not enough to harvest."""
        email = self.two_factor_email
        if not email or "@" not in email:
            return ""
        local, _, domain = email.partition("@")
        if len(local) <= 2:
            visible = local[:1]
        else:
            visible = local[:2]
        return f"{visible}{'*' * max(len(local) - len(visible), 1)}@{domain}"


class LoginChallenge(models.Model):
    """A pending second factor for one login attempt.

    The code itself is never stored — only a hash — so a database read cannot
    be replayed into a login.
    """

    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="login_challenges")
    code_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    request_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "expires_at"])]

    def __str__(self):
        return f"Login challenge for {self.user.username}"

    @classmethod
    def issue(cls, user, request_ip=None):
        """Create a challenge, returning (challenge, plaintext_code).

        Any earlier pending challenge for the user is consumed first so only one
        code is ever live per account.
        """
        cls.objects.filter(user=user, consumed_at__isnull=True).update(
            consumed_at=timezone.now()
        )
        # secrets.randbelow is CSPRNG-backed; random.randint is not.
        code = f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"
        challenge = cls.objects.create(
            user=user,
            code_hash=make_password(code),
            expires_at=timezone.now() + timedelta(minutes=CODE_TTL_MINUTES),
            request_ip=request_ip,
        )
        return challenge, code

    @classmethod
    def recent_count(cls, user, within_minutes=60):
        """How many codes this account has been sent recently."""
        since = timezone.now() - timedelta(minutes=within_minutes)
        return cls.objects.filter(user=user, created_at__gte=since).count()

    @classmethod
    def purge_stale(cls, older_than_days=7):
        """Drop long-dead challenges so the table cannot grow without bound."""
        cutoff = timezone.now() - timedelta(days=older_than_days)
        return cls.objects.filter(created_at__lt=cutoff).delete()

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at

    @property
    def is_usable(self):
        return self.consumed_at is None and not self.is_expired and self.attempts < MAX_ATTEMPTS

    def verify(self, code):
        """Check a submitted code, counting the attempt. Single-use on success.

        Runs under a row lock so parallel guesses cannot race past MAX_ATTEMPTS
        by each reading the same pre-increment counter.
        """
        with transaction.atomic():
            try:
                locked = type(self).objects.select_for_update().get(pk=self.pk)
            except type(self).DoesNotExist:
                return False

            if not locked.is_usable:
                return False

            locked.attempts += 1
            # check_password is constant-time and uses the configured hasher.
            if check_password((code or "").strip(), locked.code_hash):
                locked.consumed_at = timezone.now()
                locked.save(update_fields=["attempts", "consumed_at"])
                self.attempts, self.consumed_at = locked.attempts, locked.consumed_at
                return True

            locked.save(update_fields=["attempts"])
            self.attempts = locked.attempts
            return False
