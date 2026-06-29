from django.core.exceptions import ValidationError
from django.http import JsonResponse

from ..models import Reservation, SyncConflict
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_reservation, serialize_sync_conflict
from ._utils import json_payload


def sync_conflict_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    conflicts = SyncConflict.objects.filter(resolved=False).select_related(
        "property", "existing_reservation", "existing_reservation__property"
    )
    return JsonResponse({"conflicts": [serialize_sync_conflict(c) for c in conflicts]})


def sync_conflict_link(request, conflict_id):
    """Link a channel booking that couldn't be imported to an existing
    reservation (usually one the user added manually). The reservation adopts the
    channel's UID + platform so future syncs recognise and update it."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        conflict = SyncConflict.objects.get(pk=conflict_id)
    except SyncConflict.DoesNotExist:
        return JsonResponse({"error": "Conflict not found."}, status=404)

    payload = json_payload(request)
    reservation_id = payload.get("reservationId") or conflict.existing_reservation_id
    if not reservation_id:
        return JsonResponse({"error": "Choose a reservation to link."}, status=400)

    try:
        reservation = Reservation.objects.get(pk=reservation_id)
    except Reservation.DoesNotExist:
        return JsonResponse({"error": "Reservation not found."}, status=404)

    clash = (
        Reservation.objects.filter(platform=conflict.channel, external_uid=conflict.external_uid)
        .exclude(pk=reservation.pk)
        .exists()
    )
    if clash:
        return JsonResponse(
            {"error": "Another reservation is already linked to this channel booking."},
            status=400,
        )

    reservation.platform = conflict.channel
    reservation.external_uid = conflict.external_uid
    try:
        reservation.save()
    except ValidationError as error:
        return JsonResponse(
            {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
            status=400,
        )

    conflict.existing_reservation = reservation
    conflict.resolved = True
    conflict.save(update_fields=["existing_reservation", "resolved", "updated_at"])

    return JsonResponse({"reservation": serialize_reservation(reservation)})


def sync_conflict_dismiss(request, conflict_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        conflict = SyncConflict.objects.get(pk=conflict_id)
    except SyncConflict.DoesNotExist:
        return JsonResponse({"error": "Conflict not found."}, status=404)

    conflict.resolved = True
    conflict.save(update_fields=["resolved", "updated_at"])
    return JsonResponse({"dismissed": True})
