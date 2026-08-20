import hashlib
import math
import uuid
from datetime import date, timedelta
from decimal import Decimal
from itertools import combinations

from django.utils.timezone import localdate
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from ..models import (
    BookingRequest,
    BookingSiteSettings,
    CancellationPolicy,
    CompanyProfile,
    HouseRule,
    PricingRule,
    Property,
    PropertyAmenity,
    PropertyPhoto,
    Reservation,
)
from ._pricing import calculate_price, _min_nights_required, resolve_promo_rule
from ._pricing_engine import base_rate_for
from ._utils import json_payload, throttle

# The split-stay search pairs every candidate with every other, so it grows
# quadratically. These caps keep an unauthenticated request cheap.
MAX_COMBINATION_CANDIDATES = 12
MAX_COMBINATION_RESULTS = 20


# ---------------------------------------------------------------------------
# Serializers (public — never include private fields like WiFi/door codes)
# ---------------------------------------------------------------------------

def _approximate_coords(prop, radius_m):
    """Return privacy-shifted (lat, lng) strings for the public site.

    The offset is deterministic per property (seeded by its id) so repeated
    requests cannot be averaged to recover the true point, and it is capped at
    60% of the circle radius so the real location is always inside the circle
    the guest sees. With radius 0 the exact coordinates pass through.
    """
    if prop.latitude is None or prop.longitude is None:
        return "", ""
    lat = float(prop.latitude)
    lng = float(prop.longitude)
    if not radius_m:
        return str(prop.latitude), str(prop.longitude)
    digest = hashlib.sha256(str(prop.id).encode()).digest()
    angle = (digest[0] * 256 + digest[1]) / 65536.0 * 2 * math.pi
    distance = radius_m * (0.2 + (digest[2] / 255.0) * 0.4)  # 20–60% of radius
    dlat = distance * math.cos(angle) / 111320.0
    dlng = distance * math.sin(angle) / (111320.0 * max(math.cos(math.radians(lat)), 0.01))
    return f"{lat + dlat:.5f}", f"{lng + dlng:.5f}"


def _serialize_public_property(prop, request, price_breakdown=None, site_settings=None, min_nights=None):
    photos = [
        request.build_absolute_uri(p.photo.url)
        for p in prop.photos.order_by("sort_order", "id")
        if p.photo
    ]
    # Include the property's main photo first so it always has an image.
    if prop.photo:
        main_photo = request.build_absolute_uri(prop.photo.url)
        if main_photo not in photos:
            photos.insert(0, main_photo)
    amenity_ids = list(
        PropertyAmenity.objects.filter(property=prop)
        .values_list("amenity_id", flat=True)
    )
    settings = site_settings or BookingSiteSettings.get()
    radius_m = settings.map_privacy_radius_m
    # Guests only ever see an approximate point inside the privacy circle;
    # exact coordinates stay internal (admin serializers).
    approx_lat, approx_lng = _approximate_coords(prop, radius_m)
    if min_nights is None and price_breakdown is not None:
        min_nights = price_breakdown.get("min_nights_required") or 0
    return {
        "id": str(prop.id),
        "name": prop.name,
        "bedrooms": prop.bedrooms,
        "beds": prop.beds,
        "bathrooms": prop.bathrooms,
        "maxGuests": prop.max_guests,
        "apartmentType": f"{prop.bedrooms} {'bedroom' if prop.bedrooms == 1 else 'bedrooms'}",
        "basePriceEur": str(base_rate_for(prop)),
        "description": prop.description or "",
        "locationLabel": prop.location_label or "",
        "latitude": approx_lat,
        "longitude": approx_lng,
        "mapRadiusM": radius_m,
        "minNights": min_nights or 0,
        "rating": str(prop.rating) if prop.rating is not None else "",
        "reviewCount": prop.review_count,
        "photos": photos,
        "amenityIds": amenity_ids,
        "priceBreakdown": price_breakdown,
    }


def _serialize_review(review):
    return {
        "id": str(review.id),
        "guestName": review.guest_name,
        "rating": review.rating,
        "comment": review.comment,
        "stayLabel": review.stay_label,
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
    today = localdate()
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

    company = CompanyProfile.get()
    return JsonResponse({
        "whatsappNumber": settings.whatsapp_number,
        "buildingAddress": settings.building_address,
        "buildingName": settings.building_name,
        "houseRules": house_rules,
        "cancellationPolicies": cancellation_policies,
        "sameDayBookingEnabled": settings.same_day_booking_enabled,
        "sameDayBookingCutoffHour": settings.same_day_booking_cutoff_hour,
        "advanceBookingLimitMonths": settings.advance_booking_limit_months,
        "mapRadiusM": settings.map_privacy_radius_m,
        # Public-safe company facts only — never tax or bank details.
        "companyName": company.name,
        "companyLatitude": str(company.latitude) if company.latitude is not None else "",
        "companyLongitude": str(company.longitude) if company.longitude is not None else "",
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

    # Same rule as /booking/availability/: an apartment must hold at least the
    # party, and may hold more. Without this the map page — which prints each
    # apartment's capacity on its card — offered two-person studios to a party
    # of five. A missing or unparseable value means "no preference".
    try:
        guests = int(request.GET.get("guests") or "1")
    except (TypeError, ValueError):
        guests = 1
    if guests > 1:
        props = props.filter(max_guests__gte=guests)

    # Optional stay dates let listings (e.g. the map page) show the real
    # rule-adjusted price for the guest's dates instead of the base rate.
    check_in = check_out = None
    try:
        if request.GET.get("check_in") and request.GET.get("check_out"):
            check_in = _parse_date(request.GET.get("check_in"), "check_in")
            check_out = _parse_date(request.GET.get("check_out"), "check_out")
            if check_out <= check_in:
                check_in = check_out = None
    except ValueError:
        check_in = check_out = None

    site_settings = BookingSiteSettings.get()
    today = localdate()
    serialized = []
    for prop in props:
        breakdown = None
        if check_in and check_out:
            breakdown = calculate_price(prop, check_in, check_out, public=True)
            min_nights = breakdown.get("min_nights_required") or 0
        else:
            min_nights = _min_nights_required(prop, today, today + timedelta(days=1))
        serialized.append(
            _serialize_public_property(
                prop, request,
                price_breakdown=breakdown,
                site_settings=site_settings,
                min_nights=min_nights,
            )
        )

    return JsonResponse({"properties": serialized})


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

    today = localdate()
    data = _serialize_public_property(
        prop, request,
        min_nights=_min_nights_required(prop, today, today + timedelta(days=1)),
    )
    data["amenities"] = amenities
    data["reviews"] = [_serialize_review(r) for r in prop.reviews.all()]
    return JsonResponse({"property": data})


@csrf_exempt
def booking_property_calendar(request, property_id):
    """GET — blocked date ranges for a property over the next 12 months."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True, platform=Property.Platform.AIRSTAY)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    today = localdate()
    horizon = today + timedelta(days=365)

    reservations = Reservation.objects.filter(
        property_id=prop.id,
        is_archived=False,
        check_out__gt=today,
        check_in__lt=horizon,
    ).values("check_in", "check_out")

    pending = BookingRequest.objects.filter(
        property_id=prop.id,
        status=BookingRequest.Status.PENDING,
        check_out__gt=today,
        check_in__lt=horizon,
    ).values("check_in", "check_out")

    blocked = [
        {"checkIn": row["check_in"].isoformat(), "checkOut": row["check_out"].isoformat()}
        for row in list(reservations) + list(pending)
    ]
    return JsonResponse({"blocked": blocked})


@csrf_exempt
@throttle("60/m", methods=("GET",))
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

    site_settings = BookingSiteSettings.get()
    available = []
    min_stay_blocked = []
    unavailable_ids = set()

    for prop in all_props:
        if not _is_property_available(prop.id, check_in, check_out):
            unavailable_ids.add(prop.id)
            continue
        if prop.max_guests < guests:
            continue
        breakdown = calculate_price(prop, check_in, check_out, public=True)
        if breakdown["errors"]:
            # Free but the requested stay is too short — surface it with its
            # minimum instead of hiding the apartment without explanation.
            min_required = breakdown.get("min_nights_required") or 0
            if min_required and nights < min_required:
                min_stay_blocked.append({
                    "property": _serialize_public_property(
                        prop, request, site_settings=site_settings, min_nights=min_required,
                    ),
                    "minNights": min_required,
                })
            continue
        available.append({
            "property": _serialize_public_property(
                prop, request, price_breakdown=breakdown, site_settings=site_settings,
            ),
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

        # Bound the pair search: it is O(n^2) on an unauthenticated endpoint.
        candidate_props = candidate_props[:MAX_COMBINATION_CANDIDATES]

        # Price each candidate ONCE. Pricing inside the pair loop repeated the
        # same ~5 queries per property for every pair it appeared in.
        priced = {}
        for prop in candidate_props:
            bd = calculate_price(prop, check_in, check_out, public=True)
            if not bd["errors"]:
                priced[prop.id] = bd

        for combo in combinations(candidate_props, 2):
            total_guests = sum(p.max_guests for p in combo)
            if total_guests < guests:
                continue
            if any(prop.id not in priced for prop in combo):
                continue
            combo_items = [
                {
                    "property": _serialize_public_property(
                        prop, request, price_breakdown=priced[prop.id], site_settings=site_settings,
                    ),
                }
                for prop in combo
            ]
            combo_total = sum((Decimal(priced[prop.id]["total"]) for prop in combo), Decimal("0"))
            combinations_list.append({
                "apartments": combo_items,
                "combinedTotal": str(combo_total),
                "nights": nights,
            })

        combinations_list.sort(key=lambda x: Decimal(x["combinedTotal"]))
        combinations_list = combinations_list[:MAX_COMBINATION_RESULTS]

    return JsonResponse({
        "available": available,
        "combinations": combinations_list,
        "minStayBlocked": min_stay_blocked,
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
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True, platform=Property.Platform.AIRSTAY)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    promo_rule, promo_error = resolve_promo_rule(promo_code_str, prop, check_in, check_out)

    breakdown = calculate_price(
        prop, check_in, check_out,
        is_non_refundable=is_non_refundable, promo_rule=promo_rule, public=True,
    )
    return JsonResponse({
        "priceBreakdown": breakdown,
        "promoError": promo_error or None,
        "promoApplied": promo_rule is not None,
    })


@csrf_exempt
@throttle("30/h")  # stop promo-code enumeration from a single IP
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
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True, platform=Property.Platform.AIRSTAY)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    promo_rule, promo_error = resolve_promo_rule(code, prop, check_in, check_out)
    if promo_rule is None:
        # An empty code resolves to (None, "") — resolve_promo_rule treats
        # "no code entered" as a non-error for the pricing path, but this
        # endpoint exists solely to validate a code the guest typed in.
        return JsonResponse({"valid": False, "error": promo_error or "That promo code is not valid."})

    is_pct = promo_rule.adjustment_type in (
        PricingRule.AdjustmentType.PCT_INCREASE,
        PricingRule.AdjustmentType.PCT_DECREASE,
    )
    # Full (non-public) breakdown on purpose: resolve_promo_rule deliberately
    # leaves the minimum-subtotal check to the engine (it needs pass-1's
    # subtotal, which isn't known until pricing runs), so a code below its
    # minimum spend resolves here as a real rule that simply earns 0.00 in
    # pass 2. That must not read as "valid" to the guest — surface the
    # engine's own reason for the zero instead of returning a discount of
    # nothing under valid: true.
    breakdown = calculate_price(prop, check_in, check_out, promo_rule=promo_rule)
    if Decimal(breakdown["promo_amount"]) <= Decimal("0"):
        reason = next(
            (r["reason"] for r in breakdown["rules"] if r["id"] == str(promo_rule.pk)),
            "",
        )
        return JsonResponse({
            "valid": False,
            "error": reason or "That promo code does not apply to this stay.",
        })
    return JsonResponse({
        "valid": True,
        "promoCode": promo_rule.code,
        "discountType": "percentage" if is_pct else "fixed_amount",
        "discountValue": str(promo_rule.adjustment_value),
        "promoAmount": breakdown["promo_amount"],
        "newTotal": breakdown["total"],
    })


@csrf_exempt
@throttle("10/h")  # prevent booking-request spam from a single IP
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
    if not guest_phone:
        errors["guestPhone"] = "Phone number is required."
    # Email is optional for booking requests: guests supply only name + phone.
    if errors:
        return JsonResponse({"error": errors}, status=400)

    try:
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True, platform=Property.Platform.AIRSTAY)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    settings = BookingSiteSettings.get()
    window_errors = _validate_booking_window(check_in, check_out, settings)
    if window_errors:
        return JsonResponse({"error": window_errors[0]}, status=400)

    if not _is_property_available(prop.id, check_in, check_out):
        return JsonResponse({"error": "This apartment is no longer available for the selected dates."}, status=409)

    # The two CREATE paths only: an invalid code is silently dropped, exactly
    # as today.
    promo_rule, _ = resolve_promo_rule(promo_code_str, prop, check_in, check_out)

    # public=True: this breakdown is PERSISTED (BookingRequest.price_breakdown)
    # and re-served later via booking_reservation_detail and the PMS staff
    # view — it must never carry staff diagnostics or non-applied rule names.
    breakdown = calculate_price(
        prop, check_in, check_out, is_non_refundable=False, promo_rule=promo_rule, public=True,
    )
    if breakdown["errors"]:
        return JsonResponse({"error": breakdown["errors"][0]}, status=400)

    with transaction.atomic():
        # No usage-count increment here: a pending request must consume
        # nothing. Usage is counted at approval, in booking_request_approve.
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
            promo_code=promo_rule,
        )

    return JsonResponse({
        "token": str(req.token),
        "expiresAt": req.expires_at.isoformat(),
        "message": "Your booking request has been received. We will confirm within 24 hours.",
    }, status=201)


@csrf_exempt
@throttle("10/h")  # prevent direct-booking spam from a single IP
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
        prop = Property.objects.get(pk=property_id, active=True, listing_active=True, platform=Property.Platform.AIRSTAY)
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

    # The two CREATE paths only: an invalid code is silently dropped, exactly
    # as today.
    promo_rule, _ = resolve_promo_rule(promo_code_str, prop, check_in, check_out)

    # public=True: this breakdown is PERSISTED (Reservation.price_breakdown_json)
    # and re-served later via booking_reservation_detail — see the note on the
    # booking-request path above.
    breakdown = calculate_price(
        prop, check_in, check_out,
        is_non_refundable=is_non_refundable, promo_rule=promo_rule, public=True,
    )
    if breakdown["errors"]:
        return JsonResponse({"error": breakdown["errors"][0]}, status=400)

    total = Decimal(breakdown["total"])
    first_night = Decimal(breakdown["average_nightly_rate"])
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

        if promo_rule:
            PricingRule.objects.filter(pk=promo_rule.pk).update(
                usage_count=F("usage_count") + 1
            )

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
    today = localdate()
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
