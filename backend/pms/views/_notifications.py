"""The notifications bell.

The feed is computed on every read, never stored. Every source is a fact about
current state — a request still waiting, a registration already expired — so
deriving it means it cannot go stale, and nothing has to retract the reminder
for a service that has since been done. A stored feed would need an event
writer, deduplication and a sweeper; this needs none of them.

Read state *is* stored, per person, keyed by a string that carries a
fingerprint of the state behind the notification. Dismiss "registration
expired", renew it, let it lapse again, and the key differs — so it comes back
unread rather than staying silently dismissed.
"""

from django.http import JsonResponse
from django.utils.timezone import localdate

from ..models import BookingRequest, NotificationRead, Property
from ._fleet import vehicle_alerts
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._utils import json_payload

SEVERITY_ORDER = {"overdue": 0, "soon": 1, "info": 2}


def _vehicle_notifications(today):
    """Service and registration alerts, for vehicles that have a record.

    `*_unknown` alerts are deliberately skipped: "no service history recorded"
    is a setup task for whoever adds a vehicle, not something to interrupt the
    day with, and every new vehicle would otherwise ring the bell twice.
    """
    out = []
    vehicles = Property.objects.filter(active=True, platform=Property.Platform.FLEET)
    for vehicle in vehicles:
        for alert in vehicle_alerts(vehicle, today):
            if alert["severity"] == "info":
                continue
            # The fingerprint is what makes a fresh lapse a fresh notification.
            fingerprint = (
                vehicle.registration_expiry.isoformat()
                if alert["kind"].startswith("registration") and vehicle.registration_expiry
                else (
                    vehicle.last_service_date.isoformat()
                    if vehicle.last_service_date
                    else str(vehicle.last_service_km or "")
                )
            )
            out.append({
                "key": f"{alert['kind']}:{vehicle.id}:{fingerprint}",
                "kind": alert["kind"],
                "severity": alert["severity"],
                "title": vehicle.name,
                "message": alert["message"],
                "link": "/codes",
            })
    return out


def _booking_request_notifications():
    out = []
    pending = BookingRequest.objects.filter(
        status=BookingRequest.Status.PENDING
    ).select_related("property")
    for request_row in pending:
        out.append({
            "key": f"booking_request:{request_row.id}",
            "kind": "booking_request",
            "severity": "soon",
            "title": f"Booking request — {request_row.property.name}",
            "message": (
                f"{request_row.guest_name or 'A guest'} asked for "
                f"{request_row.check_in} to {request_row.check_out}."
            ),
            "link": "/booking-requests",
        })
    return out


def build_notifications(today=None):
    """The whole feed, most urgent first."""
    today = today or localdate()
    notifications = _booking_request_notifications() + _vehicle_notifications(today)
    return sorted(
        notifications,
        key=lambda n: (SEVERITY_ORDER.get(n["severity"], 3), n["title"]),
    )


def notification_list(request):
    """GET — what needs attention, and how much of it is unread."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    notifications = build_notifications()
    seen = set(
        NotificationRead.objects.filter(user=request.user).values_list("key", flat=True)
    )

    rows = [{**n, "read": n["key"] in seen} for n in notifications]
    return JsonResponse({
        "notifications": rows,
        "unread": sum(1 for row in rows if not row["read"]),
    })


def notification_read(request):
    """POST — mark some keys read, or all of them.

    Read is not dismissed: the notification stays in the list because the van
    is still unregistered. It only leaves when the underlying fact changes.
    """
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    payload = json_payload(request)
    if payload.get("all"):
        keys = [n["key"] for n in build_notifications()]
    else:
        keys = [str(key) for key in (payload.get("keys") or []) if key]

    for key in keys[:500]:
        # An unknown key is harmless: it simply never matches a live
        # notification, and the row ages out with the user.
        NotificationRead.objects.get_or_create(user=request.user, key=key[:200])

    return JsonResponse({"marked": len(keys)})
