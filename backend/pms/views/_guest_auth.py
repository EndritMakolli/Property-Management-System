"""Guest sign-in by emailed link.

Two rules shape every response here.

**Never reveal who has booked with you.** `request-link` answers `{"sent": true}`
for every semantic outcome — unknown address, known address, rate-limited, mail
failed — and `verify` answers the same way for a token that is unknown, expired
or already spent. A public endpoint that answers differently is a way to ask
whether a particular person has stayed here.

**Never become an open mail relay.** A link goes only to an address that has
already booked through the site. Without that, anyone could make this server
email anyone. Because the response does not change, the check costs nothing in
enumeration resistance — and it keeps "can sign in" and "can see something"
the same set of people.

Unlike staff 2FA, which fails **closed** because a weakened second factor is
worse than a locked-out user, this fails **open**: a link that cannot be emailed
just means the guest cannot sign in, and there is nothing to protect by saying
so out loud. The failure is logged for the operator.
"""

import logging

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import JsonResponse
from django.middleware.csrf import get_token, rotate_token
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie

from ..model_defs.guest_auth import LINK_TTL_MINUTES, MAX_LINKS_PER_HOUR, SESSION_DAYS
from ..models import GuestAccount, GuestLoginLink
from ._guest_ownership import has_website_booking
from ._guest_session import current_guest, end_guest_session, start_guest_session
from ._two_factor import client_ip
from ._utils import json_payload, throttle

logger = logging.getLogger(__name__)

SUBJECT = "Your sign-in link"

# One response object for every semantic outcome. Built once so no branch can
# accidentally differ by a byte.
SENT = {"sent": True}


def _serialize_account(account):
    """Deliberately without a `role` key, so it can never be mistaken for the
    staff payload from `serialize_user`."""
    if account is None:
        return {"isAuthenticated": False, "email": ""}
    return {"isAuthenticated": True, "email": account.email}


def _link_body(token):
    base = (settings.GUEST_PORTAL_URL or "").rstrip("/")
    return (
        "Hello,\n\n"
        "Here is your link to sign in and see your bookings:\n\n"
        f"    {base}/login?token={token}\n\n"
        f"It works once and expires in {LINK_TTL_MINUTES} minutes.\n\n"
        "If you did not ask to sign in, you can ignore this email — nobody can "
        "get in without the link above.\n"
    )


@csrf_exempt
@throttle("10/h")
def guest_request_link(request):
    """POST — email a sign-in link, if there is anyone to email."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    payload = json_payload(request)
    email = GuestAccount.normalise(payload.get("email"))

    # A syntactically invalid address reveals nothing about anyone, and
    # silently swallowing a typo makes for a bad sign-in experience.
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({"error": "Enter a valid email address."}, status=400)

    # Before get_or_create: an address that never booked must not become an
    # account and must never receive mail from this server.
    if not has_website_booking(email):
        return JsonResponse(SENT)

    account = GuestAccount.for_email(email)
    if GuestLoginLink.recent_count(account) >= MAX_LINKS_PER_HOUR:
        return JsonResponse(SENT)

    _, token = GuestLoginLink.issue(account, request_ip=client_ip(request))

    # Imported here rather than at module scope so the mail helper stays a
    # detail of sending, not of this module's import graph.
    from ._guest_mail import send_guest_email

    sent, error = send_guest_email(email, SUBJECT, _link_body(token))
    if not sent:
        logger.error("Could not email a guest sign-in link: %s", error)

    return JsonResponse(SENT)


@csrf_exempt
@throttle("20/h")
def guest_verify(request):
    """POST — exchange a link token for a session."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    payload = json_payload(request)
    account = GuestLoginLink.consume(payload.get("token"))
    if account is None:
        # One message for unknown, expired and already-used. The difference is
        # exactly what someone holding a stale link would want to learn.
        return JsonResponse(
            {"error": "This sign-in link is no longer valid. Please request a new one."},
            status=400,
        )

    start_guest_session(request, account)
    request.session.set_expiry(SESSION_DAYS * 24 * 60 * 60)

    from django.utils import timezone

    GuestAccount.objects.filter(pk=account.pk).update(last_login_at=timezone.now())

    # cycle_key() does not rotate the CSRF secret the way auth.login() does, so
    # do it explicitly and hand the new token back — same contract as auth_login.
    rotate_token(request)
    return JsonResponse({"account": _serialize_account(account), "csrfToken": get_token(request)})


@ensure_csrf_cookie
def guest_me(request):
    """GET — who is signed in, and a CSRF token to act with."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    return JsonResponse(
        {"account": _serialize_account(current_guest(request)), "csrfToken": get_token(request)}
    )


def guest_logout(request):
    """POST — end the guest session, and only the guest session.

    CSRF-protected: it carries a session, so it is not one of the two
    pre-session endpoints that may be exempt.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    end_guest_session(request)
    return JsonResponse({"account": _serialize_account(None), "csrfToken": get_token(request)})
