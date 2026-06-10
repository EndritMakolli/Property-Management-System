import calendar
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import DailyEntry, ReceiptItem, ReceiptItemReservation, Reservation
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._utils import json_payload


# ── Serializers ───────────────────────────────────────────────────────────────

def _serialize_entry(entry):
    return {
        "id": str(entry.id),
        "date": entry.date.isoformat(),
        "depositAmount": str(entry.deposit_amount),
        "receiptLeft": entry.receipt_left,
        "note": entry.note,
    }


def _serialize_item(item):
    links = item.reservation_links.select_related("reservation", "reservation__property").all()
    reservations = []
    for link in links:
        r = link.reservation
        reservations.append({
            "id": str(r.id),
            "guestName": r.guest_name or r.guest_phone or "—",
            "apartment": r.property.name,
            "checkIn": r.check_in.isoformat(),
            "checkOut": r.check_out.isoformat(),
            "totalPaid": str(r.total_price_eur),
        })
    return {
        "id": str(item.id),
        "value": str(item.value),
        "note": item.note,
        "reservations": reservations,
    }


def _safe_decimal(value, default="0.00"):
    try:
        return Decimal(str(value or default)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError):
        return Decimal(default)


# ── Monthly view ─────────────────────────────────────────────────────────────

@csrf_exempt
def receipt_monthly_view(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    platform = request.GET.get("platform") or "airstay"
    year_str = request.GET.get("year")
    month_str = request.GET.get("month")

    try:
        year_int = int(year_str)
        month_int = int(month_str)
        _, days_in_month = calendar.monthrange(year_int, month_int)
    except (TypeError, ValueError):
        return JsonResponse({"error": "Provide a valid year and month."}, status=400)

    # Fetch all entries for the month with aggregated receipt totals
    entries = (
        DailyEntry.objects
        .filter(platform=platform, date__year=year_int, date__month=month_int)
        .prefetch_related("receipt_items")
    )

    entries_by_date = {}
    for entry in entries:
        receipt_total = sum(
            (item.value for item in entry.receipt_items.all()), Decimal("0.00")
        )
        entries_by_date[entry.date.isoformat()] = {
            "id": str(entry.id),
            "depositAmount": str(entry.deposit_amount),
            "receiptLeft": entry.receipt_left,
            "note": entry.note,
            "receiptTotal": str(receipt_total),
            "itemCount": entry.receipt_items.count(),
        }

    days_out = []
    total_receipts = Decimal("0.00")
    total_deposits = Decimal("0.00")

    for day_num in range(1, days_in_month + 1):
        date_str = date(year_int, month_int, day_num).isoformat()
        entry_data = entries_by_date.get(date_str)

        receipt_total = Decimal(entry_data["receiptTotal"]) if entry_data else Decimal("0.00")
        deposit_amount = Decimal(entry_data["depositAmount"]) if entry_data else Decimal("0.00")

        total_receipts += receipt_total
        total_deposits += deposit_amount

        days_out.append({
            "date": date_str,
            "id": entry_data["id"] if entry_data else None,
            "receiptTotal": str(receipt_total),
            "depositAmount": str(deposit_amount),
            "receiptLeft": entry_data["receiptLeft"] if entry_data else False,
            "note": entry_data["note"] if entry_data else "",
            "itemCount": entry_data["itemCount"] if entry_data else 0,
        })

    return JsonResponse({
        "days": days_out,
        "totals": {
            "receiptTotal": str(total_receipts),
            "depositTotal": str(total_deposits),
            "leftToDeposit": str(total_receipts - total_deposits),
        },
    })


# ── Daily entry upsert ───────────────────────────────────────────────────────

@csrf_exempt
def receipt_day_upsert(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    payload = json_payload(request)
    platform = payload.get("platform") or "airstay"
    date_str = payload.get("date")
    if not date_str:
        return JsonResponse({"error": "Provide a date."}, status=400)

    entry, _ = DailyEntry.objects.get_or_create(
        platform=platform,
        date=date_str,
        defaults={"deposit_amount": Decimal("0.00"), "receipt_left": False, "note": ""},
    )

    if "depositAmount" in payload:
        entry.deposit_amount = _safe_decimal(payload["depositAmount"])
    if "receiptLeft" in payload:
        entry.receipt_left = bool(payload["receiptLeft"])
    if "note" in payload:
        entry.note = payload.get("note") or ""

    entry.save()
    return JsonResponse({"entry": _serialize_entry(entry)})


# ── Day detail ────────────────────────────────────────────────────────────────

@csrf_exempt
def receipt_day_detail(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    platform = request.GET.get("platform") or "airstay"
    date_str = request.GET.get("date")
    if not date_str:
        return JsonResponse({"error": "Provide a date."}, status=400)

    try:
        entry = DailyEntry.objects.prefetch_related(
            "receipt_items",
            "receipt_items__reservation_links",
            "receipt_items__reservation_links__reservation",
            "receipt_items__reservation_links__reservation__property",
        ).get(platform=platform, date=date_str)
        entry_data = _serialize_entry(entry)
        items = [_serialize_item(item) for item in entry.receipt_items.all()]
    except DailyEntry.DoesNotExist:
        entry_data = {
            "id": None,
            "date": date_str,
            "depositAmount": "0.00",
            "receiptLeft": False,
            "note": "",
        }
        items = []

    return JsonResponse({"entry": entry_data, "items": items})


# ── Receipt items ─────────────────────────────────────────────────────────────

@csrf_exempt
def receipt_item_list(request):
    """POST: create a new receipt item for a day."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    payload = json_payload(request)
    platform = payload.get("platform") or "airstay"
    date_str = payload.get("date")
    if not date_str:
        return JsonResponse({"error": "Provide a date."}, status=400)

    value = _safe_decimal(payload.get("value"), "0.00")

    entry, _ = DailyEntry.objects.get_or_create(
        platform=platform,
        date=date_str,
        defaults={"deposit_amount": Decimal("0.00"), "receipt_left": False, "note": ""},
    )

    item = ReceiptItem.objects.create(
        daily_entry=entry,
        value=value,
        note=payload.get("note") or "",
    )

    reservation_ids = payload.get("reservationIds") or []
    for res_id in reservation_ids:
        try:
            reservation = Reservation.objects.get(pk=res_id)
            ReceiptItemReservation.objects.get_or_create(
                receipt_item=item, reservation=reservation
            )
        except Reservation.DoesNotExist:
            pass

    item.refresh_from_db()
    return JsonResponse({"item": _serialize_item(item)}, status=201)


@csrf_exempt
def receipt_item_detail(request, item_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        item = ReceiptItem.objects.prefetch_related(
            "reservation_links",
            "reservation_links__reservation",
            "reservation_links__reservation__property",
        ).get(pk=item_id)
    except ReceiptItem.DoesNotExist:
        return JsonResponse({"error": "Receipt item not found."}, status=404)

    if request.method == "PATCH":
        payload = json_payload(request)

        if "value" in payload:
            item.value = _safe_decimal(payload["value"])
        if "note" in payload:
            item.note = payload.get("note") or ""
        item.save()

        if "reservationIds" in payload:
            reservation_ids = set(payload["reservationIds"] or [])
            # Remove links not in new set
            item.reservation_links.exclude(reservation_id__in=reservation_ids).delete()
            # Add new links
            for res_id in reservation_ids:
                try:
                    reservation = Reservation.objects.get(pk=res_id)
                    ReceiptItemReservation.objects.get_or_create(
                        receipt_item=item, reservation=reservation
                    )
                except Reservation.DoesNotExist:
                    pass

        item.refresh_from_db()
        return JsonResponse({"item": _serialize_item(item)})

    if request.method == "DELETE":
        item.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


# ── Available reservations for linking ────────────────────────────────────────

@csrf_exempt
def receipt_available_reservations(request):
    """GET: reservations for a month that can be linked to a receipt item."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    platform = request.GET.get("platform") or "airstay"
    year_str = request.GET.get("year")
    month_str = request.GET.get("month")
    current_item_id = request.GET.get("currentItemId")

    try:
        year_int = int(year_str)
        month_int = int(month_str)
        _, days_in_month = calendar.monthrange(year_int, month_int)
        month_start = date(year_int, month_int, 1)
        month_end = date(year_int, month_int, days_in_month)
    except (TypeError, ValueError):
        return JsonResponse({"error": "Provide a valid year and month."}, status=400)

    today = date.today()

    # Reservations that touch the selected month, not upcoming, not maintenance
    reservations = (
        Reservation.objects
        .select_related("property")
        .filter(
            property__platform=platform,
            check_in__lte=min(month_end, today),
            check_out__gt=month_start,
            is_archived=False,
        )
        .exclude(platform=Reservation.Platform.MAINTENANCE)
        .order_by("check_in", "property__name")
    )

    # Reservation IDs already linked (globally), except those linked to the current item
    linked_ids = set(
        ReceiptItemReservation.objects
        .exclude(receipt_item_id=current_item_id)
        .values_list("reservation_id", flat=True)
    ) if current_item_id else set(
        ReceiptItemReservation.objects.values_list("reservation_id", flat=True)
    )

    result = []
    for r in reservations:
        result.append({
            "id": str(r.id),
            "guestName": r.guest_name or r.guest_phone or "—",
            "guestPhone": r.guest_phone,
            "apartment": r.property.name,
            "checkIn": r.check_in.isoformat(),
            "checkOut": r.check_out.isoformat(),
            "totalPaid": str(r.total_price_eur),
            "alreadyLinked": r.id in linked_ids,
        })

    return JsonResponse({"reservations": result})
