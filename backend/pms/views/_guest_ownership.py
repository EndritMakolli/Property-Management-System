"""Which bookings belong to a guest account. The whole rule, in one place.

Every `/api/guest/` endpoint starts here. It is kept in its own module, with no
HTTP and no serialization, so the boundary can be read on its own and so
"nothing else filters a guest's bookings" is provable with one grep.

**The rule.** A row belongs to an account when both hold:

  1. its `guest_email` matches the account, compared lowercased, and
  2. it originated on the website — a `BookingRequest`, or a `Reservation` that
     a `BookingRequest` points at.

The second condition is the one that matters. Staff-entered reservations carry
whatever address was to hand, and channel imports carry whatever Airbnb or
Booking.com supplied; matching those on email alone would put one person's stay
in another person's portal. So origin is checked, not just identity.

**Why `Lower()` and not `__iexact`.** On PostgreSQL `__iexact` compiles to
`UPPER(guest_email) = UPPER(%s)`, which cannot use the functional index these
tables carry (`bookingreq_email_lower`, `reservation_email_lower`, both over
`Lower("guest_email")`). The results would be identical and every portal load
would be a sequential scan. The index and this filter are a pair; changing one
without the other silently costs the other.
"""

import logging
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db.models import Sum
from django.db.models.functions import Lower
from django.utils.timezone import localdate

from ..models import BookingRequest, GuestAccount, Reservation

logger = logging.getLogger(__name__)

CENTS = Decimal("0.01")


def _account_email(account):
    """The address to match on, or "" when this account can own nothing.

    A blank address is treated as owning nothing rather than raising. Both
    columns allow a blank `guest_email` — the booking form did not always ask
    for one — so matching on "" would hand over every emailless booking in the
    database at once. An empty portal is the safe way to be wrong.
    """
    email = GuestAccount.normalise(getattr(account, "email", ""))
    if not email:
        logger.error(
            "Guest account %s has no email address; it owns nothing.",
            getattr(account, "pk", None),
        )
    return email


def owned_booking_requests(account):
    """Every website booking this account made, newest stay first."""
    email = _account_email(account)
    if not email:
        return BookingRequest.objects.none()
    return (
        BookingRequest.objects
        # alias, not annotate: the expression is for filtering, and does not
        # need to travel back in the SELECT.
        .alias(email_lower=Lower("guest_email"))
        .filter(email_lower=email)
        .exclude(guest_email="")
        .select_related("property", "reservation")
        .order_by("-check_in", "-created_at")
    )


def owned_reservations(account):
    """The confirmed stays behind those bookings.

    `booking_request__isnull=False` is condition 2: a reservation staff created
    by hand, or one a channel sync imported, has no request pointing at it and
    is therefore invisible here however well its email matches.
    """
    email = _account_email(account)
    if not email:
        return Reservation.objects.none()
    return (
        Reservation.objects
        .alias(email_lower=Lower("guest_email"))
        .filter(email_lower=email, booking_request__isnull=False)
        .exclude(guest_email="")
        .select_related("property")
    )


def owned_booking_request(account, request_id):
    """One booking, or None — never raising, never saying which reason.

    "Not yours" and "does not exist" are deliberately indistinguishable: the
    difference is exactly what someone walking ids would want to learn.
    """
    email = _account_email(account)
    if not email or request_id in (None, ""):
        return None
    try:
        return owned_booking_requests(account).filter(pk=request_id).first()
    except (ValidationError, ValueError, TypeError):
        return None


def has_website_booking(email):
    """Whether this address has ever booked through the site.

    Gates who can be sent a sign-in link. Without it, `request-link` would email
    any address anyone typed — and the set of people who can sign in would be
    larger than the set who can see anything once they do.
    """
    email = GuestAccount.normalise(email)
    if not email:
        return False
    return (
        BookingRequest.objects
        .alias(email_lower=Lower("guest_email"))
        .filter(email_lower=email)
        .exclude(guest_email="")
        .exists()
    )


def stay_stats(account):
    """Their own numbers, from the same rows the bookings list shows.

    Deliberately not `Guest.total_stays` / `total_nights` / `total_paid_eur`:
    those count every stay including ones staff entered, so a guest would be
    shown a total they could not account for from the list above it.

    Only finished stays count. A booking that has not happened yet is something
    to look forward to, not a visit.
    """
    finished = owned_reservations(account).filter(
        is_archived=False, check_out__lte=localdate()
    )
    totals = finished.aggregate(nights=Sum("nights"), spent=Sum("total_price_eur"))
    last = finished.order_by("-check_out").values_list("check_out", flat=True).first()

    spent = totals["spent"] or Decimal("0")
    return {
        "stays": finished.count(),
        "nights": int(totals["nights"] or 0),
        "totalSpentEur": str(spent.quantize(CENTS)),
        "lastVisit": last.isoformat() if last else "",
    }
