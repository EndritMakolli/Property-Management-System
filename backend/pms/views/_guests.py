"""Client directory: CRUD + search over the Guest model, and the logic that
links reservations to guests (explicit pick, or match-by-phone/name with
auto-create on reservation entry)."""

import calendar
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db.models import Count, F, Q, Sum
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.utils.timezone import localdate

from ..models import Guest, GuestDocument, Reservation, ReservationType
from ._expense_ai import _validate_upload
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_reservation
from ._utils import json_payload, paginate

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
        "isArchived": bool(guest.is_archived),
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
    if "isArchived" in payload:
        archived = bool(payload.get("isArchived"))
        # Only move the stamp when the flag actually changes, so re-saving an
        # archived client does not keep resetting when it was filed away.
        if archived != guest.is_archived:
            guest.archived_at = timezone.now() if archived else None
        guest.is_archived = archived

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


# ---------------------------------------------------------------------------
# Directory filtering
# ---------------------------------------------------------------------------

# Sorting keys the directory offers. Aggregates order NULLs last in both
# directions - a client with no stays belongs at the bottom of "most nights",
# and Postgres would otherwise put them at the top of a descending sort.
CLIENT_SORTS = {
    "name": (F("last_name").asc(), F("first_name").asc()),
    "-name": (F("last_name").desc(), F("first_name").desc()),
    "stays": (F("stay_count").asc(nulls_last=True),),
    "-stays": (F("stay_count").desc(nulls_last=True),),
    "nights": (F("night_sum").asc(nulls_last=True),),
    "-nights": (F("night_sum").desc(nulls_last=True),),
    "paid": (F("paid_sum").asc(nulls_last=True),),
    "-paid": (F("paid_sum").desc(nulls_last=True),),
    "added": (F("created_at").asc(),),
    "-added": (F("created_at").desc(),),
}
DEFAULT_CLIENT_SORT = "name"

# Names the iCal import writes when a channel supplies no guest name. It goes
# through link_or_create_guest like any other name, so the directory grew a
# "client" called Airbnb with 42 stays - top of the list by every measure, and
# not a person.
FALLBACK_CHANNEL_LABELS = {"airbnb", "booking", "booking.com", "reserved"}


def channel_labels():
    """Every name a channel import might leave behind, lowercased.

    Read from ReservationType rather than hardcoded so a type an operator adds
    later is covered without another release.
    """
    labels = set(FALLBACK_CHANNEL_LABELS)
    for code, label in ReservationType.objects.values_list("code", "label"):
        labels.add((code or "").strip().lower())
        labels.add((label or "").strip().lower())
    return {label for label in labels if label}


def without_channel_placeholders(guests):
    """Hide import artefacts, without deleting them.

    A placeholder carries a channel's name, no surname, and no way to contact
    it. A real person who happens to be called Airbnb has a phone or an email,
    and that is what tells them apart. The rows stay in the table because
    reservations still point at them.
    """
    named_like_a_channel = Q()
    for label in channel_labels():
        named_like_a_channel |= Q(first_name__iexact=label)
    no_contact = (Q(phone__isnull=True) | Q(phone="")) & (Q(email__isnull=True) | Q(email=""))
    return guests.exclude(named_like_a_channel & Q(last_name="") & no_contact)


def period_bounds(request):
    """(first, last) day of the requested month, or None for all time."""
    year, month = request.GET.get("year"), request.GET.get("month")
    if not (year and month):
        return None
    try:
        year, month = int(year), int(month)
        return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    except (TypeError, ValueError):
        return None


def stayed_within(guests, request):
    """Narrow to clients who actually stayed in the period / apartment.

    Selected through a subquery, and that is not a style choice. Filtering
    `reservations__...` on this queryset joins the reservation table a second
    time, and `annotated_guests()` sums over that relation - so every summed
    row is counted once per join. On real data one client went from 1092 nights
    and 22,602 EUR to 2184 and 45,204. `Count(distinct=True)` survives it;
    `Sum` does not. tests_clients.AggregatesSurviveFilteringTests pins this.
    """
    stays = Reservation.objects.filter(is_archived=False).exclude(platform="maintenance")
    narrowed = False

    bounds = period_bounds(request)
    if bounds:
        month_start, month_end = bounds
        # The same overlap test the reservation list uses: a stay belongs to a
        # month if it slept a night in it, not if it happened to begin there.
        stays = stays.filter(check_in__lte=month_end, check_out__gt=month_start)
        narrowed = True

    property_id = (request.GET.get("propertyId") or "").strip()
    if property_id:
        try:
            stays = stays.filter(property_id=property_id)
        except (ValueError, ValidationError):
            return guests.none()
        narrowed = True

    if not narrowed:
        return guests
    return guests.filter(pk__in=stays.values("guest_id"))


def guest_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        guests = annotated_guests().filter(is_archived=request.GET.get("archived") == "1")
        guests = without_channel_placeholders(guests)

        search = (request.GET.get("search") or "").strip()
        if search:
            guests = guests.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
            )

        guests = stayed_within(guests, request)

        order = CLIENT_SORTS.get(request.GET.get("sort") or "", CLIENT_SORTS[DEFAULT_CLIENT_SORT])
        # `id` last so the order is total: without a tiebreaker two clients who
        # sort equal can swap between pages and be shown twice, or not at all.
        guests = guests.order_by(*order, "id")

        rows, total = paginate(guests, request)
        return JsonResponse({"guests": [serialize_guest(item) for item in rows], "total": total})

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
        # ID documents cascade — remove their files from disk first.
        for document in guest.documents.all():
            document.file.delete(save=False)
        guest.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def guest_stays(request, guest_id):
    """GET - one client's reservations, plus their numbers.

    Two totals live side by side here on purpose. The top level is lifetime and
    matches the directory row exactly, so the list and the detail page can never
    disagree about the same person. `finished` and `upcoming` split that total
    by whether the stay has actually happened - the guest portal's `stay_stats`
    counts only finished stays, and a client with a booking next month would
    otherwise show one number on one page and a different one here.
    """
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        guest = Guest.objects.get(pk=guest_id)
    except (Guest.DoesNotExist, ValidationError, ValueError):
        return JsonResponse({"error": "Client not found."}, status=404)

    stays = (
        guest.reservations.filter(is_archived=False)
        .exclude(platform="maintenance")
        .select_related("property")
        .order_by("-check_in")
    )

    today = localdate()
    finished_nights = upcoming_nights = 0
    finished_count = upcoming_count = 0
    spent = Decimal("0.00")
    last_visit = None

    for stay in stays:
        spent += stay.total_price_eur or Decimal("0.00")
        if stay.check_out <= today:
            finished_count += 1
            finished_nights += stay.nights or 0
            if last_visit is None or stay.check_out > last_visit:
                last_visit = stay.check_out
        else:
            upcoming_count += 1
            upcoming_nights += stay.nights or 0

    return JsonResponse({
        "stays": [serialize_reservation(stay) for stay in stays],
        "stats": {
            # Lifetime - the same basis as the directory row.
            "stays": finished_count + upcoming_count,
            "nights": finished_nights + upcoming_nights,
            "totalSpentEur": str(spent.quantize(Decimal("0.01"))),
            "lastVisit": last_visit.isoformat() if last_visit else "",
            "finished": {"stays": finished_count, "nights": finished_nights},
            "upcoming": {"stays": upcoming_count, "nights": upcoming_nights},
        },
    })


# ---------------------------------------------------------------------------
# ID documents (passport / national ID / driver's license / other)
# ---------------------------------------------------------------------------

def serialize_guest_document(document, request):
    # The URL points at the role-checked download view, never at /media/ —
    # these are passports and national IDs, which must not be world-readable.
    download_path = f"/api/guests/{document.guest_id}/documents/{document.id}/download/"
    return {
        "id": str(document.id),
        "docType": document.doc_type,
        "docTypeLabel": document.get_doc_type_display(),
        "url": request.build_absolute_uri(download_path) if document.file else "",
        "originalName": document.original_name,
        "uploadedAt": document.uploaded_at.isoformat(),
    }


def guest_document_list(request, guest_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        guest = Guest.objects.get(pk=guest_id)
    except Guest.DoesNotExist:
        return JsonResponse({"error": "Client not found."}, status=404)

    if request.method == "GET":
        return JsonResponse({
            "documents": [
                serialize_guest_document(document, request)
                for document in guest.documents.all()
            ]
        })

    if request.method == "POST":
        upload = request.FILES.get("file")
        error = _validate_upload(upload)
        if error:
            return JsonResponse({"error": error}, status=400)
        doc_type = (request.POST.get("docType") or "").strip()
        if doc_type not in GuestDocument.DocType.values:
            doc_type = GuestDocument.DocType.OTHER
        document = GuestDocument.objects.create(
            guest=guest,
            doc_type=doc_type,
            file=upload,
            original_name=upload.name or "",
        )
        return JsonResponse({"document": serialize_guest_document(document, request)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def guest_document_detail(request, guest_id, document_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        document = GuestDocument.objects.get(pk=document_id, guest_id=guest_id)
    except GuestDocument.DoesNotExist:
        return JsonResponse({"error": "Document not found."}, status=404)

    if request.method == "DELETE":
        document.file.delete(save=False)
        document.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def guest_document_download(request, guest_id, document_id):
    """Stream an ID document to authorised staff only.

    Identity documents are personal data, so they are deliberately NOT served
    from the public /media/ path — every read goes through this role check.
    """
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        document = GuestDocument.objects.get(pk=document_id, guest_id=guest_id)
    except GuestDocument.DoesNotExist:
        return JsonResponse({"error": "Document not found."}, status=404)

    if not document.file:
        return JsonResponse({"error": "Document file is missing."}, status=404)

    try:
        handle = document.file.open("rb")
    except (FileNotFoundError, OSError):
        return JsonResponse({"error": "Document file is missing."}, status=404)

    response = FileResponse(handle, as_attachment=False)
    # Never let a browser or shared proxy retain someone's passport scan.
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    # Untrusted uploaded content must not run in our origin.
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response
