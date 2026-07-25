"""Client directory: CRUD + search over the Guest model, and the logic that
links reservations to guests (explicit pick, or match-by-phone/name with
auto-create on reservation entry)."""

from django.core.exceptions import ValidationError
from django.db.models import Count, Q, Sum
from django.http import JsonResponse

from ..models import Guest
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._utils import json_payload

# A guest's stay stats count real stays only.
STAY_FILTER = Q(reservations__is_archived=False) & ~Q(reservations__platform="maintenance")


def annotated_guests():
    return Guest.objects.annotate(
        stay_count=Count("reservations", filter=STAY_FILTER, distinct=True),
        night_sum=Sum("reservations__nights", filter=STAY_FILTER),
        paid_sum=Sum("reservations__total_price_eur", filter=STAY_FILTER),
    )


def serialize_guest(guest):
    stays = int(getattr(guest, "stay_count", 0) or 0)
    paid = getattr(guest, "paid_sum", None)
    return {
        "id": str(guest.id),
        "firstName": guest.first_name,
        "lastName": guest.last_name,
        "fullName": guest.full_name,
        "email": guest.email or "",
        "phone": guest.phone or "",
        "whatsappNumber": guest.whatsapp_number or "",
        "nationality": guest.nationality or "",
        "notes": guest.notes or "",
        "isReturning": bool(guest.is_returning or stays > 1),
        "totalStays": stays,
        "totalNights": int(getattr(guest, "night_sum", 0) or 0),
        "totalPaidEur": str(paid if paid is not None else "0.00"),
        "createdAt": guest.created_at.isoformat() if guest.created_at else "",
    }


def split_name(full_name):
    first, _, last = (full_name or "").strip().partition(" ")
    return first.strip(), last.strip()


def apply_guest_payload(guest, payload):
    if "fullName" in payload and "firstName" not in payload:
        guest.first_name, guest.last_name = split_name(payload.get("fullName"))
    if "firstName" in payload:
        guest.first_name = (payload.get("firstName") or "").strip()
    if "lastName" in payload:
        guest.last_name = (payload.get("lastName") or "").strip()
    if "email" in payload:
        guest.email = (payload.get("email") or "").strip() or None
    if "phone" in payload:
        guest.phone = (payload.get("phone") or "").strip() or None
    if "whatsappNumber" in payload:
        guest.whatsapp_number = (payload.get("whatsappNumber") or "").strip() or None
    if "nationality" in payload:
        guest.nationality = (payload.get("nationality") or "").strip() or None
    if "notes" in payload:
        guest.notes = payload.get("notes") or ""
    if "isReturning" in payload:
        guest.is_returning = bool(payload.get("isReturning"))

    if not guest.first_name:
        raise ValidationError({"firstName": "Enter the client's name."})
    return guest


def normalize_phone(value):
    return "".join(ch for ch in (value or "") if ch.isdigit())


def find_guest(name, phone):
    """Match an existing guest by phone digits first, then case-insensitive name."""
    phone_digits = normalize_phone(phone)
    if phone_digits:
        for candidate in Guest.objects.exclude(phone__isnull=True).exclude(phone=""):
            if normalize_phone(candidate.phone) == phone_digits:
                return candidate
    first, last = split_name(name)
    if first:
        return Guest.objects.filter(first_name__iexact=first, last_name__iexact=last).first()
    return None


def link_or_create_guest(reservation):
    """On reservation create: attach a matching Guest, creating one if needed.

    Skipped when a guest was already linked explicitly (guestId) and for
    maintenance blocks / rows without a guest name.
    """
    if reservation.guest_id or reservation.platform == "maintenance":
        return
    name = (reservation.guest_name or "").strip()
    if not name:
        return

    guest = find_guest(name, reservation.guest_phone)
    if guest is None:
        first, last = split_name(name)
        guest = Guest.objects.create(
            first_name=first or name,
            last_name=last,
            phone=(reservation.guest_phone or "").strip() or None,
            email=(reservation.guest_email or "").strip() or None,
        )
    else:
        updates = []
        if not guest.phone and reservation.guest_phone:
            guest.phone = reservation.guest_phone
            updates.append("phone")
        if not guest.email and reservation.guest_email:
            guest.email = reservation.guest_email
            updates.append("email")
        if updates:
            guest.save(update_fields=updates)
    reservation.guest = guest


def refresh_returning_flag(guest):
    if guest is None or guest.is_returning:
        return
    stays = guest.reservations.filter(is_archived=False).exclude(platform="maintenance").count()
    if stays >= 2:
        Guest.objects.filter(pk=guest.pk).update(is_returning=True)


def guest_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        guests = annotated_guests()
        search = (request.GET.get("search") or "").strip()
        if search:
            guests = guests.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
            )
        return JsonResponse({"guests": [serialize_guest(item) for item in guests]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            guest = apply_guest_payload(Guest(), payload)
            guest.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"guest": serialize_guest(guest)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def guest_detail(request, guest_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        guest = annotated_guests().get(pk=guest_id)
    except Guest.DoesNotExist:
        return JsonResponse({"error": "Client not found."}, status=404)

    if request.method == "GET":
        return JsonResponse({"guest": serialize_guest(guest)})

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            guest = apply_guest_payload(guest, payload)
            guest.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"guest": serialize_guest(annotated_guests().get(pk=guest.pk))})

    if request.method == "DELETE":
        # Reservations keep their inline guest name/phone (FK is SET_NULL).
        guest.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)
