import uuid
from datetime import date, timedelta
from decimal import Decimal
from itertools import combinations

from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..models import (
    BookingRequest,
    BookingSiteSettings,
    CancellationPolicy,
    HouseRule,
    PricingRule,
    PromoCode,
    Property,
    PropertyAmenity,
    PropertyPhoto,
    Reservation,
)
from ._pricing import calculate_price, _match_scope
from ._utils import json_payload


# ---------------------------------------------------------------------------
# Serializers (public — never include private fields like WiFi/door codes)
# ---------------------------------------------------------------------------

def _serialize_public_property(prop, request, price_breakdown=None):
    photos = [
        request.build_absolute_uri(p.photo.url)
        for p in prop.photos.order_by("sort_order", "id")
        if p.photo
    ]
    amenity_ids = list(
        PropertyAmenity.objects.filter(property=prop)
        .values_list("amenity_id", flat=True)
    )
    return {
        "id": str(prop.id),
        "name": prop.name,
        "bedrooms": prop.bedrooms,
        "maxGuests": prop.max_guests,
        "apartmentType": f"{prop.bedrooms} {'bedroom' if prop.bedrooms == 1 else 'bedrooms'}",
        "basePriceEur": str(prop.base_price_eur),
        "description": prop.description or "",
        "photos": photos,
        "amenityIds": amenity_ids,
        "priceBreakdown": price_breakdown,
    }


def _serialize_booking_request(req, request):
    prop_photo = req.property.photos.order_by("sort_order", "id").first()
    photo_url = request.build_absolute_uri(prop_photo.photo.url) if prop_photo and prop_photo.photo else ""
    return {
        "token": str(req.token),
        "status": req.status,
        "property": {
            "id": str(req.property_id),
            "name": req.property.name,
            "photoUrl": photo_url,
        },
        "guestName": req.guest_name,
        "guestEmail": req.guest_email,
        "guestPhone": req.guest_phone,
        "checkIn": req.check_in.isoformat(),
        "checkOut": req.check_out.isoformat(),
        "nights": req.nights,
        "guestsCount": req.guests_count,
        "totalPriceEur": str(req.total_price_eur),
        "priceBreakdown": req.price_breakdown,
        "expiresAt": req.expires_at.isoformat(),
        "rejectionMessage": req.rejection_message,
        "createdAt": req.created_at.isoformat(),
    }


def _serialize_direct_reservation(reservation, request):
    prop_photo = reservation.property.photos.order_by("sort_order", "id").first()
    photo_url = request.build_absolute_uri(prop_photo.photo.url) if prop_photo and prop_photo.photo else ""
    return {
        "token": str(reservation.booking_token),
        "status": "confirmed",
        "property": {
            "id": str(reservation.property_id),
            "name": reservation.property.name,
            "photoUrl": photo_url,
            "address": reservation.property.address or "",
        },
        "guestName": reservation.guest_name,
        "guestEmail": reservation.guest_email,
        "guestPhone": reservation.guest_phone,
        "checkIn": reservation.check_in.isoformat(),
        "checkOut": reservation.check_out.isoformat(),
        "nights": reservation.nights,
        "guestsCount": reservation.guests_count,
        "totalPriceEur": str(reservation.total_price_eur),
        "onlinePaymentStatus": reservation.online_payment_status,
        "onlinePaymentAmount": str(reservation.online_payment_amount),
        "isNonRefundable": reservation.is_non_refundable,
        "priceBreakdown": reservation.price_breakdown_json,
        "isArchived": reservation.is_archived,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_date(value, field_name):
    if not value:
        raise ValueError(f"{field_name} is required.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field_name} must be a date in YYYY-MM-DD format.")


def _validate_booking_window(check_in, check_out, settings):
    today = date.today()
    errors = []

    if check_in < today:
        errors.append("Check-in date cannot be in the past.")

    if check_out <= check_in:
        errors.append("Check-out must be after check-in.")

    if settings.same_day_booking_enabled:
        if check_in == today:
            now_hour = timezone.localtime(timezone.now()).hour
            if now_hour >= settings.same_day_booking_cutoff_hour:
                errors.append(
                    f"Same-day bookings must be made before "
                    f"{settings.same_day_booking_cutoff_hour}:00."
                )
    elif check_in == today:
        errors.append("Same-day booking is not available.")

    limit_date = date(today.year, today.month, 1)
    months = settings.advance_booking_limit_months
    for _ in range(months):
        if limit_date.month == 12:
            limit_date = limit_date.replace(year=limit_date.year + 1, month=1)
        else:
            limit_date = limit_date.replace(month=limit_date.month + 1)
    if check_in >= limit_date:
        errors.append(f"Bookings can only be made up to {months} months in advance.")

    return errors


def _dates_overlap(a_in, a_out, b_in, b_out):
    return a_in < b_out and a_out > b_in


def _is_property_available(property_id, check_in, check_out):
    """Return True if the property has no conflicting reservations or pending requests."""
    has_reservation = Reservation.objects.filter(
        property_id=property_id,
        check_in__lt=check_out,
        check_out__gt=check_in,
        is_archived=False,
    ).exclude(platform=Reservation.Platform.MAINTENANCE).exists()

    if has_reservation:
        return False

    has_pending_request = BookingRequest.objects.filter(
        property_id=property_id,
        check_in__lt=check_out,
        check_out__gt=check_in,
        status=BookingRequest.Status.PENDING,
    ).exists()

    return not has_pending_request


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

@csrf_exempt
def booking_settings(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    settings = BookingSiteSettings.get()
    house_rules = list(HouseRule.objects.filter(active=True).order_by("sort_order", "id").values("id", "text"))
    cancellation_policies = []
    for cp in CancellationPolicy.objects.filter(scope="all").order_by("policy_type"):
        cancellation_policies.append({
            "policyType": cp.policy_type,
            "daysBeforeCheckin": cp.days_before_checkin,
            "refundPct": str(cp.refund_pct) if cp.refund_pct is not None else None,
            "autoProcess": cp.auto_process,
        })

    return JsonResponse({
        "whatsappNumber": settings.whatsapp_number,
        "buildingAddress": settings.building_address,
        "buildingName": settings.building_name,
        "houseRules": house_rules,
        "cancellationPolicies": cancellation_policies,
        "sameDayBookingEnabled": settings.same_day_booking_enabled,
        "sameDayBookingCutoffHour": settings.same_day_booking_cutoff_hour,
        "advanceBookingLimitMonths": settings.advance_booking_limit_months,
    })


@csrf_exempt
def booking_properties(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    props = Property.objects.filter(
        active=True,
        listing_active=True,
        platform=Property.Platform.AIRSTAY,
    ).prefetch_related("photos", "property_amenities").order_by("bedrooms", "name")

    return JsonResponse({
        "properties": [_serialize_public_property(p, request) for p in props]
    })


@csrf_exempt
def booking_property_detail(request, property_id):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        prop = Property.objects.prefetch_related("photos", "property_amenities__amenity").get(
            pk=property_id, active=True, listing_active=True, platform=Property.Platform.AIRSTAY
        )
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    amenities = [
        {"id": str(pa.amenity.id), "name": pa.amenity.name, "icon": pa.amenity.icon}
        for pa in prop.property_amenities.select_related("amenity").order_by("amenity__sort_order", "amenity__name")
    ]

    data = _serialize_public_property(prop, request)
    data["amenities"] = amenities
    return JsonResponse({"property": data})


@csrf_exempt
def booking_availability(request):
    """
    GET /api/booking/availability/?check_in=&check_out=&guests=&amenities=id1,id2
    Returns available properties with price breakdowns.
    Also returns multi-apartment combinations if no single property fits guest count.
    """
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        check_in = _parse_date(request.GET.get("check_in"), "check_in")
        check_out = _parse_date(request.GET.get("check_out"), "check_out")
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)

    try:
        guests = int(request.GET.get("guests") or "1")
        if guests < 1:
            guests = 1
    except ValueError:
        guests = 1

    if check_out <= check_in:
        return JsonResponse({"error": "Check-out must be after check-in."}, status=400)

    nights = (check_out - check_in).days

    amenity_filter_raw = request.GET.get("amenities") or ""
    amenity_ids = [a.strip() for a in amenity_filter_raw.split(",") if a.strip()]

    all_props = Property.objects.filter(
        active=True,
        listing_active=True,
        platform=Property.Platform.AIRSTAY,
    ).prefetch_related("photos").order_by("bedrooms", "name")

    if amenity_ids:
        for aid in amenity_ids:
            all_props = all_props.filter(property_amenities__amenity_id=aid)
        all_props = all_props.distinct()

    available = []
    unavailable_ids = set()

    for prop in all_props:
        if not _is_property_available(prop.id, check_in, check_out):
            unavailable_ids.add(prop.id)
            continue
        if prop.max_guests < guests:
            continue
        breakdown = calculate_price(prop, check_in, check_out)
        if breakdown["errors"]:
            continue
        available.append({
            "property": _serialize_public_property(prop, request, price_breakdown=breakdown),
        })

    # Sort cheapest first
    available.sort(key=lambda x: Decimal(x["property"]["priceBreakdown"]["total"]))

    # Multi-apartment combinations when no single property fits or guest list is empty
    combinations_list = []
    if not available and guests > 1:
        # Find all individually available properties regardless of guest capacity
        candidate_props = []
        for prop in all_props:
            if prop.id in unavailable_ids:
                continue
            if _is_property_available(prop.id, check_in, check_out):
                candidate_props.append(prop)

        for combo in combinations(candidate_props, 2):
            total_guests = sum(p.max_guests for p in combo)
            if total_guests < guests:
                continue
            combo_items = []
            combo_total = Decimal("0")
            valid = True
            for prop in combo:
                bd = calculate_price(prop, check_in, check_out)
                if bd["errors"]:
                    valid = False
                    break
                combo_items.append({
                    "property": _serialize_public_property(prop, request, price_breakdown=bd),
                })
                combo_total += Decimal(bd["total"])
            if valid:
                combinations_list.append({
                    "apartments": combo_items,
                    "combinedTotal": str(combo_total),
                    "nights": nights,
                })

        combinations_list.sort(key=lambda x: Decimal(x["combinedTotal"]))

    return JsonResponse({
        "available": available,
        "combinations": combinations_list,
        "checkIn": check_in.isoformat(),
        "checkOut": check_out.isoformat(),
        "nights": nights,
        "guests": guests,
    })


@csrf_exempt
def booking_calculate(request):
    """POST — recalculate price for a property + dates + options."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        check_in = _parse_date(payload.get("checkIn"), "checkIn")
        check_out = _parse_date(payload.get("checkOut"), "checkOut")
        property_id = payload.get("propertyId")
        is_non_refundable = bool(payload.get("isNonRefundable"))
        promo_code_str = (payload.get("promoCode") or "").strip().upper()
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)

    try:
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    promo_obj = None
    promo_error = None
    if promo_code_str:
        try:
            promo_obj = PromoCode.objects.get(code=promo_code_str, active=True)
            if promo_obj.usage_limit is not None and promo_obj.usage_count >= promo_obj.usage_limit:
                promo_obj = None
                promo_error = "This promo code has reached its usage limit."
            elif not _match_scope(promo_obj, prop):
                promo_obj = None
                promo_error = "This promo code does not apply to this apartment."
        except PromoCode.DoesNotExist:
            promo_error = "Invalid promo code."

    breakdown = calculate_price(prop, check_in, check_out, is_non_refundable=is_non_refundable, promo_code_obj=promo_obj)
    return JsonResponse({
        "priceBreakdown": breakdown,
        "promoError": promo_error,
        "promoApplied": promo_obj is not None,
    })


@csrf_exempt
def booking_validate_promo(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        code = (payload.get("code") or "").strip().upper()
        property_id = payload.get("propertyId")
        check_in = _parse_date(payload.get("checkIn"), "checkIn")
        check_out = _parse_date(payload.get("checkOut"), "checkOut")
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)

    try:
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    try:
        promo = PromoCode.objects.get(code=code, active=True)
    except PromoCode.DoesNotExist:
        return JsonResponse({"valid": False, "error": "Invalid promo code."})

    if promo.usage_limit is not None and promo.usage_count >= promo.usage_limit:
        return JsonResponse({"valid": False, "error": "This promo code has reached its usage limit."})

    if not _match_scope(promo, prop):
        return JsonResponse({"valid": False, "error": "This promo code does not apply to this apartment."})

    breakdown = calculate_price(prop, check_in, check_out, promo_code_obj=promo)
    return JsonResponse({
        "valid": True,
        "promoCode": promo.code,
        "discountType": promo.discount_type,
        "discountValue": str(promo.discount_value),
        "promoAmount": breakdown["promo_amount"],
        "newTotal": breakdown["total"],
    })


@csrf_exempt
def booking_create_request(request):
    """POST — create a BookingRequest (Pay at Property path)."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        check_in = _parse_date(payload.get("checkIn"), "checkIn")
        check_out = _parse_date(payload.get("checkOut"), "checkOut")
        property_id = payload.get("propertyId")
        guest_name = (payload.get("guestName") or "").strip()
        guest_email = (payload.get("guestEmail") or "").strip()
        guest_phone = (payload.get("guestPhone") or "").strip()
        guests_count = int(payload.get("guestsCount") or "1")
        promo_code_str = (payload.get("promoCode") or "").strip().upper()
    except (ValueError, TypeError) as e:
        return JsonResponse({"error": str(e)}, status=400)

    errors = {}
    if not guest_name:
        errors["guestName"] = "Name is required."
    if not guest_email:
        errors["guestEmail"] = "Email is required."
    if not guest_phone:
        errors["guestPhone"] = "WhatsApp number is required."
    if errors:
        return JsonResponse({"error": errors}, status=400)

    try:
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    settings = BookingSiteSettings.get()
    window_errors = _validate_booking_window(check_in, check_out, settings)
    if window_errors:
        return JsonResponse({"error": window_errors[0]}, status=400)

    if not _is_property_available(prop.id, check_in, check_out):
        return JsonResponse({"error": "This apartment is no longer available for the selected dates."}, status=409)

    promo_obj = None
    if promo_code_str:
        try:
            promo_obj = PromoCode.objects.get(code=promo_code_str, active=True)
            if promo_obj.usage_limit is not None and promo_obj.usage_count >= promo_obj.usage_limit:
                promo_obj = None
            elif not _match_scope(promo_obj, prop):
                promo_obj = None
        except PromoCode.DoesNotExist:
            promo_obj = None

    breakdown = calculate_price(prop, check_in, check_out, is_non_refundable=False, promo_code_obj=promo_obj)
    if breakdown["errors"]:
        return JsonResponse({"error": breakdown["errors"][0]}, status=400)

    with transaction.atomic():
        if promo_obj:
            PromoCode.objects.filter(pk=promo_obj.pk).update(usage_count=promo_obj.usage_count + 1)

        req = BookingRequest.objects.create(
            property=prop,
            guest_name=guest_name,
            guest_email=guest_email,
            guest_phone=guest_phone,
            check_in=check_in,
            check_out=check_out,
            guests_count=guests_count,
            total_price_eur=Decimal(breakdown["total"]),
            price_breakdown=breakdown,
            status=BookingRequest.Status.PENDING,
            promo_code=promo_obj,
        )

    return JsonResponse({
        "token": str(req.token),
        "expiresAt": req.expires_at.isoformat(),
        "message": "Your booking request has been received. We will confirm within 24 hours.",
    }, status=201)


@csrf_exempt
def booking_create_direct(request):
    """
    POST — create a confirmed direct Reservation (online payment path).
    Payment is stubbed: we accept the booking immediately.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        check_in = _parse_date(payload.get("checkIn"), "checkIn")
        check_out = _parse_date(payload.get("checkOut"), "checkOut")
        property_id = payload.get("propertyId")
        guest_name = (payload.get("guestName") or "").strip()
        guest_email = (payload.get("guestEmail") or "").strip()
        guest_phone = (payload.get("guestPhone") or "").strip()
        guests_count = int(payload.get("guestsCount") or "1")
        payment_type = payload.get("paymentType") or "first_night"
        is_non_refundable = bool(payload.get("isNonRefundable"))
        promo_code_str = (payload.get("promoCode") or "").strip().upper()
    except (ValueError, TypeError) as e:
        return JsonResponse({"error": str(e)}, status=400)

    errors = {}
    if not guest_name:
        errors["guestName"] = "Name is required."
    if not guest_email:
        errors["guestEmail"] = "Email is required."
    if not guest_phone:
        errors["guestPhone"] = "WhatsApp number is required."
    if payment_type not in ("first_night", "full"):
        errors["paymentType"] = "Choose 'first_night' or 'full'."
    if errors:
        return JsonResponse({"error": errors}, status=400)

    try:
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    settings = BookingSiteSettings.get()
    window_errors = _validate_booking_window(check_in, check_out, settings)
    if window_errors:
        return JsonResponse({"error": window_errors[0]}, status=400)

    # Re-check availability right before booking (race condition guard)
    if not _is_property_available(prop.id, check_in, check_out):
        return JsonResponse(
            {"error": "Sorry, this apartment is no longer available for the selected dates."},
            status=409,
        )

    promo_obj = None
    if promo_code_str:
        try:
            promo_obj = PromoCode.objects.get(code=promo_code_str, active=True)
            if promo_obj.usage_limit is not None and promo_obj.usage_count >= promo_obj.usage_limit:
                promo_obj = None
            elif not _match_scope(promo_obj, prop):
                promo_obj = None
        except PromoCode.DoesNotExist:
            promo_obj = None

    breakdown = calculate_price(prop, check_in, check_out, is_non_refundable=is_non_refundable, promo_code_obj=promo_obj)
    if breakdown["errors"]:
        return JsonResponse({"error": breakdown["errors"][0]}, status=400)

    total = Decimal(breakdown["total"])
    first_night = Decimal(breakdown["first_night_price"])
    paid_amount = first_night if payment_type == "first_night" else total
    payment_status = (
        Reservation.OnlinePaymentStatus.FIRST_NIGHT
        if payment_type == "first_night"
        else Reservation.OnlinePaymentStatus.FULL
    )

    with transaction.atomic():
        # Double-check inside transaction
        if not _is_property_available(prop.id, check_in, check_out):
            return JsonResponse(
                {"error": "Sorry, this apartment is no longer available for the selected dates."},
                status=409,
            )

        if promo_obj:
            PromoCode.objects.filter(pk=promo_obj.pk).update(usage_count=promo_obj.usage_count + 1)

        reservation = Reservation(
            property=prop,
            guest_name=guest_name,
            guest_phone=guest_phone,
            guest_email=guest_email,
            platform=Reservation.Platform.DIRECT,
            check_in=check_in,
            check_out=check_out,
            guests_count=guests_count,
            nightly_price_eur=Decimal(breakdown["effective_nightly"]),
            paid=payment_status == Reservation.OnlinePaymentStatus.FULL,
            booking_token=uuid.uuid4(),
            online_payment_status=payment_status,
            online_payment_amount=paid_amount,
            is_non_refundable=is_non_refundable,
            price_breakdown_json=breakdown,
            notes=f"Direct booking via website. Payment: {payment_type}.",
        )
        # Override total_price_eur because Reservation.save() recomputes it from nightly × nights
        # which may differ from the discounted total. We set nightly to discounted rate.
        # Compute effective nightly that reproduces the total.
        nights = (check_out - check_in).days
        if nights > 0:
            from decimal import ROUND_HALF_UP as _R
            reservation.nightly_price_eur = (total / nights).quantize(Decimal("0.01"), _R)
        reservation.save()

    return JsonResponse({
        "bookingToken": str(reservation.booking_token),
        "reservationId": str(reservation.id),
        "message": "Your booking is confirmed!",
        "paidAmount": str(paid_amount),
        "remainingAmount": str(max(total - paid_amount, Decimal("0"))),
        "paymentStatus": payment_status,
    }, status=201)


@csrf_exempt
def booking_reservation_detail(request, token):
    """GET — guest retrieves their booking via secure token."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    # Try direct reservation first, then booking request
    try:
        reservation = Reservation.objects.select_related("property").get(booking_token=token)
        return JsonResponse({"type": "reservation", "data": _serialize_direct_reservation(reservation, request)})
    except Reservation.DoesNotExist:
        pass

    try:
        req = BookingRequest.objects.select_related("property").get(token=token)
        # Expire stale pending requests
        if req.status == BookingRequest.Status.PENDING and timezone.now() > req.expires_at:
            req.status = BookingRequest.Status.EXPIRED
            req.save(update_fields=["status"])
        return JsonResponse({"type": "request", "data": _serialize_booking_request(req, request)})
    except BookingRequest.DoesNotExist:
        pass

    return JsonResponse({"error": "Booking not found."}, status=404)


@csrf_exempt
def booking_cancel(request, token):
    """POST — guest cancels their booking via secure token."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    # Try direct reservation
    try:
        reservation = Reservation.objects.select_related("property").get(booking_token=token)
    except Reservation.DoesNotExist:
        # Try booking request
        try:
            req = BookingRequest.objects.get(token=token)
            if req.status not in (BookingRequest.Status.PENDING, BookingRequest.Status.APPROVED):
                return JsonResponse({"error": "This request cannot be cancelled."}, status=400)
            req.status = BookingRequest.Status.REJECTED
            req.rejection_message = "Cancelled by guest."
            req.save(update_fields=["status", "rejection_message"])
            return JsonResponse({"message": "Your request has been cancelled."})
        except BookingRequest.DoesNotExist:
            return JsonResponse({"error": "Booking not found."}, status=404)

    if reservation.is_archived:
        return JsonResponse({"error": "This reservation is already cancelled."}, status=400)

    # Check cancellation policy
    policy = _find_cancellation_policy(reservation.property)
    today = date.today()
    days_until_checkin = (reservation.check_in - today).days

    can_auto_cancel = False
    refund_amount = Decimal("0")

    if policy:
        if policy.policy_type == CancellationPolicy.PolicyType.FREE:
            if policy.days_before_checkin is None or days_until_checkin >= policy.days_before_checkin:
                can_auto_cancel = True
                refund_amount = reservation.online_payment_amount
        elif policy.policy_type == CancellationPolicy.PolicyType.PARTIAL and policy.auto_process:
            can_auto_cancel = True
            if policy.refund_pct:
                refund_amount = (reservation.online_payment_amount * policy.refund_pct / 100).quantize(Decimal("0.01"))
        elif policy.policy_type == CancellationPolicy.PolicyType.NON_REFUNDABLE and policy.auto_process:
            if not reservation.is_non_refundable:
                can_auto_cancel = True
                refund_amount = Decimal("0")
    else:
        # Default: free cancellation
        can_auto_cancel = True
        refund_amount = reservation.online_payment_amount

    if not can_auto_cancel:
        return JsonResponse({
            "error": "Please contact us to cancel this booking.",
            "contactWhatsapp": BookingSiteSettings.get().whatsapp_number,
        }, status=400)

    reservation.is_archived = True
    reservation.archived_at = timezone.now()
    reservation.save(update_fields=["is_archived", "archived_at"])

    return JsonResponse({
        "message": "Your booking has been cancelled.",
        "refundAmount": str(refund_amount),
        "note": "Refunds are processed within 5-10 business days." if refund_amount > 0 else "",
    })


def _find_cancellation_policy(property_obj):
    """Find most-specific cancellation policy for a property."""
    # Property-specific first
    policy = CancellationPolicy.objects.filter(scope="property", property=property_obj).first()
    if policy:
        return policy
    # Bedroom group
    policy = CancellationPolicy.objects.filter(scope="bedroom_group", bedroom_group=property_obj.bedrooms).first()
    if policy:
        return policy
    # Global
    return CancellationPolicy.objects.filter(scope="all").first()


@csrf_exempt
def booking_change_request(request, token):
    """POST — guest requests a date/apartment change (placeholder response for now)."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
    except Exception:
        return JsonResponse({"error": "Invalid request body."}, status=400)

    settings = BookingSiteSettings.get()
    return JsonResponse({
        "message": "Your change request has been received. We will contact you shortly.",
        "contactWhatsapp": settings.whatsapp_number,
    })
