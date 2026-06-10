import calendar
from datetime import date, timezone, datetime, timedelta

from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import Property, Reservation, ReservationAuditLog, ReservationAttachment
from ._payloads import apply_reservation_payload
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_reservation, serialize_reservation_audit
from ._utils import json_payload

TRACKED_FIELDS = [
    ("guest_name", "guestName"),
    ("guest_phone", "guestPhone"),
    ("check_in", "checkIn"),
    ("check_out", "checkOut"),
    ("platform", "reservationType"),
    ("nightly_price_eur", "nightlyPrice"),
    ("total_price_eur", "totalPaid"),
    ("paid", "paid"),
    ("notes", "notes"),
    ("property_id", "propertyId"),
]


def _log_changes(reservation, old_values, username):
    for model_field, _api_key in TRACKED_FIELDS:
        old = str(old_values.get(model_field, ""))
        new = str(getattr(reservation, model_field, ""))
        if old != new:
            ReservationAuditLog.objects.create(
                reservation_id=reservation.id,
                changed_by=username,
                field_name=model_field,
                old_value=old,
                new_value=new,
            )


def _snapshot(reservation):
    return {field: getattr(reservation, field, None) for field, _ in TRACKED_FIELDS}


@csrf_exempt
def reservation_list(request):
    if request.method == "GET":
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
        if denied:
            return denied

        year = request.GET.get("year")
        month = request.GET.get("month")
        property_id = request.GET.get("property")
        platform = request.GET.get("platform") or Property.Platform.AIRSTAY
        archived = request.GET.get("archived") == "1"

        reservations = Reservation.objects.select_related("guest", "property").filter(
            property__platform=platform,
            is_archived=archived,
        ).order_by("check_in", "property__name")

        if year and month:
            try:
                selected_year = int(year)
                selected_month = int(month)
                month_start = date(selected_year, selected_month, 1)
                month_end = date(
                    selected_year,
                    selected_month,
                    calendar.monthrange(selected_year, selected_month)[1],
                )
            except ValueError:
                return JsonResponse({"error": "Choose a valid month and year."}, status=400)
            reservations = reservations.filter(check_in__lte=month_end, check_out__gt=month_start)

        if property_id:
            reservations = reservations.filter(property_id=property_id)

        if archived:
            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            Reservation.objects.filter(is_archived=True, archived_at__lt=cutoff).delete()

        return JsonResponse({"reservations": [serialize_reservation(item) for item in reservations]})

    if request.method == "POST":
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
        if denied:
            return denied
        try:
            payload = json_payload(request)
            reservation = apply_reservation_payload(Reservation(), payload)
            reservation.save()
            ReservationAuditLog.objects.create(
                reservation_id=reservation.id,
                changed_by=request.user.username,
                field_name="created",
                old_value="",
                new_value="Reservation created",
            )
        except Property.DoesNotExist:
            return JsonResponse({"error": "Choose an existing property."}, status=400)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"reservation": serialize_reservation(reservation)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def reservation_detail(request, reservation_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        reservation = Reservation.objects.select_related("guest", "property").get(pk=reservation_id)
    except Reservation.DoesNotExist:
        return JsonResponse({"error": "Reservation not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            old_values = _snapshot(reservation)
            reservation = apply_reservation_payload(reservation, payload)
            reservation.save()
            _log_changes(reservation, old_values, request.user.username)
        except Property.DoesNotExist:
            return JsonResponse({"error": "Choose an existing property."}, status=400)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"reservation": serialize_reservation(reservation)})

    if request.method == "DELETE":
        if reservation.is_archived:
            # Already archived — permanently destroy
            reservation.delete()
            return JsonResponse({"deleted": True})
        # Soft delete — archive instead of destroy
        reservation.is_archived = True
        reservation.archived_at = datetime.now(timezone.utc)
        reservation.save(update_fields=["is_archived", "archived_at"])
        ReservationAuditLog.objects.create(
            reservation_id=reservation.id,
            changed_by=request.user.username,
            field_name="archived",
            old_value="false",
            new_value="true",
        )
        return JsonResponse({"archived": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def reservation_restore(request, reservation_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        reservation = Reservation.objects.get(pk=reservation_id, is_archived=True)
    except Reservation.DoesNotExist:
        return JsonResponse({"error": "Archived reservation not found."}, status=404)

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    reservation.is_archived = False
    reservation.archived_at = None
    reservation.save(update_fields=["is_archived", "archived_at"])
    ReservationAuditLog.objects.create(
        reservation_id=reservation.id,
        changed_by=request.user.username,
        field_name="archived",
        old_value="true",
        new_value="false",
    )
    return JsonResponse({"reservation": serialize_reservation(reservation)})


@csrf_exempt
def reservation_history(request, reservation_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    logs = ReservationAuditLog.objects.filter(reservation_id=reservation_id)
    return JsonResponse({"history": [serialize_reservation_audit(log) for log in logs]})


@csrf_exempt
def reservation_attachment_list(request, reservation_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        reservation = Reservation.objects.get(pk=reservation_id)
    except Reservation.DoesNotExist:
        return JsonResponse({"error": "Reservation not found."}, status=404)

    if request.method == "GET":
        attachments = ReservationAttachment.objects.filter(reservation_id=reservation_id)
        return JsonResponse({
            "attachments": [
                {
                    "id": str(a.id),
                    "url": request.build_absolute_uri(a.file.url),
                    "originalName": a.original_name,
                    "uploadedAt": a.uploaded_at.isoformat(),
                }
                for a in attachments
            ]
        })

    if request.method == "POST":
        file = request.FILES.get("file")
        if not file:
            return JsonResponse({"error": "No file provided."}, status=400)
        attachment = ReservationAttachment.objects.create(
            reservation_id=reservation.id,
            file=file,
            original_name=file.name,
        )
        return JsonResponse({
            "attachment": {
                "id": str(attachment.id),
                "url": request.build_absolute_uri(attachment.file.url),
                "originalName": attachment.original_name,
                "uploadedAt": attachment.uploaded_at.isoformat(),
            }
        }, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def reservation_attachment_detail(request, reservation_id, attachment_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        attachment = ReservationAttachment.objects.get(pk=attachment_id, reservation_id=reservation_id)
    except ReservationAttachment.DoesNotExist:
        return JsonResponse({"error": "Attachment not found."}, status=404)

    if request.method == "DELETE":
        attachment.file.delete(save=False)
        attachment.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)
