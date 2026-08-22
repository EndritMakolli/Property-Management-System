"""What a signed-in guest can read about their own bookings.

The serializer is a hand-built allow-list. It deliberately does not reuse
`serialize_property` (which carries `wifiPassword` and `floor` for staff) or
`_serialize_public_property` (which carries coordinates), because a shared
serializer means a field added for one audience silently reaches the other.
Every field below was chosen; nothing arrives by inheritance.

Address is the one sensitive thing shown, and only once a booking is confirmed.
A guest who is coming needs to know where to go. A guest whose request is still
pending, or was declined, does not — and a request that never gets approved
should never have handed out an address at all.

Never here, at any status: door codes, lockbox codes, wifi, coordinates, or any
`GuestDocument`. `tests_guest_portal.NothingSecretLeaksTests` scans the raw
response body for exactly those, so a careless field addition fails a test
rather than waiting to be noticed in review.
"""

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone

from ..models import BookingRequest, BookingSiteSettings
from ._booking_public import cancellation_outcome
from ._guest_ownership import owned_booking_request, owned_booking_requests, stay_stats
from ._guest_session import require_guest


def _status(booking_request):
    """The status a guest should read, not the one the database stores.

    `approved` is not the whole story: an approved booking whose reservation has
    since been archived was cancelled, and calling that "approved" would be a
    lie to the person who cancelled it.
    """
    status = booking_request.status
    if status == BookingRequest.Status.PENDING:
        return "pending"
    if status == BookingRequest.Status.REJECTED:
        return "declined"
    if status == BookingRequest.Status.EXPIRED:
        return "expired"
    if status == BookingRequest.Status.APPROVED:
        reservation = booking_request.reservation
        if reservation is not None and reservation.is_archived:
            return "cancelled"
        return "confirmed"
    return str(status)


def serialize_guest_booking(booking_request, request):
    """One booking, allow-listed field by field."""
    status = _status(booking_request)
    prop = booking_request.property
    confirmed = status == "confirmed"

    photo = ""
    if prop.photo:
        photo = request.build_absolute_uri(prop.photo.url)

    return {
        "id": str(booking_request.id),
        "status": status,
        "checkIn": booking_request.check_in.isoformat(),
        "checkOut": booking_request.check_out.isoformat(),
        "nights": booking_request.nights,
        "guestsCount": booking_request.guests_count,
        "totalPriceEur": str(booking_request.total_price_eur),
        # Only when they are actually coming.
        "declineReason": (
            booking_request.rejection_message if status == "declined" else ""
        ),
        "canCancel": status in ("pending", "confirmed"),
        "property": {
            "name": prop.name,
            "bedrooms": prop.bedrooms,
            "photoUrl": photo,
            "address": prop.address if confirmed else "",
            "floor": prop.floor if confirmed else "",
        },
    }


def guest_bookings(request):
    """GET — every website booking this account made."""
    account, denied = require_guest(request)
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    rows = owned_booking_requests(account)
    return JsonResponse(
        {"bookings": [serialize_guest_booking(row, request) for row in rows]}
    )


def guest_stats(request):
    """GET — their own numbers, from the same rows the list shows."""
    account, denied = require_guest(request)
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    return JsonResponse(stay_stats(account))


def guest_cancel_booking(request, request_id):
    """POST — the guest cancels one of their own bookings.

    Ownership is resolved first and by the same rule as everything else. A
    token link proves you hold a token; a session proves who you are, so the
    lookup is scoped to the account or the portal would add nothing the token
    link did not already allow.

    The policy decision is `cancellation_outcome`, shared with the token
    endpoint — two implementations of "the cancellation policy" is one more
    than this application can have.
    """
    account, denied = require_guest(request)
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    booking_request = owned_booking_request(account, request_id)
    if booking_request is None:
        # The same answer for "not yours" and "does not exist". The difference
        # is exactly what someone walking ids would want to learn.
        return JsonResponse({"error": "Booking not found."}, status=404)

    with transaction.atomic():
        # Re-read under a lock: two taps on a phone must not both cancel.
        # of=("self",): `reservation` is nullable, so select_related makes it a
        # LEFT OUTER JOIN, and Postgres refuses FOR UPDATE on the nullable side
        # of one. Only this row needs locking anyway.
        locked = (
            BookingRequest.objects.select_for_update(of=("self",))
            .select_related("reservation", "property")
            .get(pk=booking_request.pk)
        )
        status = _status(locked)

        if status not in ("pending", "confirmed"):
            return JsonResponse(
                {"error": "This booking can no longer be cancelled."}, status=400
            )

        if status == "confirmed" and locked.reservation is not None:
            # Only the can-cancel half of the policy is used. Guests pay at the
            # property, so there is never an online payment to refund and a
            # "0.00 refunded" line would be noise at best.
            can_cancel, _refund = cancellation_outcome(locked.reservation)
            if not can_cancel:
                return JsonResponse(
                    {
                        "error": "Please contact us to cancel this booking.",
                        "contactWhatsapp": BookingSiteSettings.get().whatsapp_number,
                    },
                    status=400,
                )
            locked.reservation.is_archived = True
            locked.reservation.archived_at = timezone.now()
            locked.reservation.save(update_fields=["is_archived", "archived_at"])

        locked.status = BookingRequest.Status.REJECTED
        # The same wording booking_cancel writes, so staff read one phrase for
        # one thing however the guest cancelled.
        locked.rejection_message = "Cancelled by guest."
        locked.save(update_fields=["status", "rejection_message"])

    locked.refresh_from_db()
    return JsonResponse(
        {
            "message": "Your booking has been cancelled.",
            "booking": serialize_guest_booking(locked, request),
        }
    )
