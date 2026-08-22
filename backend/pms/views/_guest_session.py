"""The guest session. The only module that touches the guest session key.

Kept deliberately small: the claim "nothing else reads or writes the guest
session" should be provable with one grep for `guest_account_id`.

A guest is never a `django.contrib.auth.User`. That is the security design, not
an implementation preference — `user_role()` maps an authenticated user to a
staff role, and cleaning role can read every door code in the building. Keeping
guests out of `request.user` entirely means all ~90 existing `require_roles`
endpoints reject them with 401 without being modified, and no future endpoint
can leak to a guest by forgetting a decorator.
"""

import logging
import uuid

from ..models import GuestAccount
from ._roles import unauthenticated_response

logger = logging.getLogger(__name__)

GUEST_SESSION_KEY = "guest_account_id"


def start_guest_session(request, account):
    """Mark this browser as signed in to `account`.

    `cycle_key()` rotates the session id while keeping what is already in the
    session. Rotating matters because otherwise a session id planted before
    sign-in is still valid after it — session fixation, which
    `django.contrib.auth.login()` protects against and a hand-rolled key would
    not. Keeping the contents matters because a staff login may be in there,
    and the two systems are independent.
    """
    request.session.cycle_key()
    request.session[GUEST_SESSION_KEY] = str(account.pk)


def end_guest_session(request):
    """Drop the guest key and nothing else.

    Explicitly NOT `session.flush()` — that is what `auth.logout()` does, and it
    would take a staff login in the same browser down with it.
    """
    request.session.pop(GUEST_SESSION_KEY, None)


def current_guest(request):
    """The signed-in guest, or None.

    A key pointing at an account that no longer exists is cleared rather than
    left to fail on every subsequent request.
    """
    raw = request.session.get(GUEST_SESSION_KEY)
    if not raw:
        return None
    try:
        account = GuestAccount.objects.get(pk=uuid.UUID(str(raw)))
    except (GuestAccount.DoesNotExist, ValueError, TypeError, AttributeError):
        request.session.pop(GUEST_SESSION_KEY, None)
        return None
    return account


def require_guest(request):
    """Gate a guest endpoint. Returns `(account, denied)`.

    Callers read:

        account, denied = require_guest(request)
        if denied:
            return denied

    Unlike `require_roles`, which returns only a denial, this hands back the
    account too — the caller needs it for every query, and looking it up twice
    would be a second round trip on every request.

    The denial is the same 401 body a staff endpoint returns, so an anonymous
    caller cannot tell the two systems apart by probing.
    """
    account = current_guest(request)
    if account is None:
        return None, unauthenticated_response()
    return account, None
