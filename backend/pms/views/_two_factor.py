"""Second-factor delivery and verification for staff logins."""

import logging

from django.conf import settings
from django.core.mail import send_mail

from ..models import LoginChallenge, UserSecurity
from ..model_defs.security import CODE_TTL_MINUTES

logger = logging.getLogger(__name__)


def client_ip(request):
    """Best-effort client IP.

    Only trusts X-Forwarded-For when the deployment declares it runs behind a
    proxy — otherwise any client could spoof the header.
    """
    if getattr(settings, "TRUST_PROXY_HEADERS", False):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def email_is_deliverable():
    """True when codes can actually reach an inbox.

    The console backend "succeeds" without sending anything. That is fine while
    developing, but in production it would mean login codes are written to the
    server log and never delivered — so treat it as undeliverable and let the
    caller fail closed rather than silently weakening the second factor.
    """
    if settings.DEBUG:
        return True
    return "console" not in settings.EMAIL_BACKEND and "dummy" not in settings.EMAIL_BACKEND


def send_login_code(user, security, code, request_ip=None):
    """Email a one-time login code. Returns True when it was handed to the MTA."""
    if not email_is_deliverable():
        logger.error(
            "2FA is enabled for user id=%s but no SMTP backend is configured; "
            "refusing to issue a login code. Set EMAIL_HOST in the environment.",
            user.pk,
        )
        return False

    subject = "Your PMS login code"
    where = f"\nRequest origin: {request_ip}" if request_ip else ""
    body = (
        f"Hello {user.username},\n\n"
        f"Your login verification code is:\n\n"
        f"    {code}\n\n"
        f"It expires in {CODE_TTL_MINUTES} minutes and can be used once.\n"
        f"{where}\n\n"
        "If you did not try to sign in, someone may know your password — "
        "change it immediately.\n"
    )
    try:
        sent = send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL or None,
            recipient_list=[security.two_factor_email],
            fail_silently=False,
        )
        return bool(sent)
    except Exception:  # noqa: BLE001 — never leak SMTP details to the client
        logger.exception("Failed to send 2FA code to user id=%s", user.pk)
        return False


def start_challenge(user, request):
    """Issue and email a code. Returns (challenge, delivered)."""
    security = UserSecurity.for_user(user)
    ip = client_ip(request)
    challenge, code = LoginChallenge.issue(user, request_ip=ip)
    delivered = send_login_code(user, security, code, request_ip=ip)
    return challenge, security, delivered
