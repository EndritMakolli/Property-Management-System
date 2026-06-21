from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.http.multipartparser import MultiPartParser
from django.utils import timezone

from ..models import (
    Amenity,
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
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_property, serialize_reservation
from ._utils import decimal_value, json_payload


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _serialize_amenity(amenity):
    return {
        "id": str(amenity.id),
        "name": amenity.name,
        "icon": amenity.icon or "",
        "sortOrder": amenity.sort_order,
    }


def _serialize_house_rule(rule):
    return {
        "id": str(rule.id),
        "text": rule.text,
        "sortOrder": rule.sort_order,
        "active": rule.active,
    }


def _serialize_pricing_rule(rule):
    return {
        "id": str(rule.id),
        "ruleType": rule.rule_type,
        "scope": rule.scope,
        "propertyId": str(rule.property_id) if rule.property_id else None,
        "bedroomGroup": rule.bedroom_group,
        "enabled": rule.enabled,
        "minNights": rule.min_nights,
        "discountPct": str(rule.discount_pct) if rule.discount_pct is not None else None,
        "daysBeforeCheckin": rule.days_before_checkin,
        "startDate": rule.start_date.isoformat() if rule.start_date else None,
        "endDate": rule.end_date.isoformat() if rule.end_date else None,
        "adjustmentType": rule.adjustment_type or "",
        "adjustmentValue": str(rule.adjustment_value) if rule.adjustment_value is not None else None,
        "createdAt": rule.created_at.isoformat(),
    }


def _serialize_promo_code(promo):
    return {
        "id": str(promo.id),
        "code": promo.code,
        "discountType": promo.discount_type,
        "discountValue": str(promo.discount_value),
        "scope": promo.scope,
        "propertyId": str(promo.property_id) if promo.property_id else None,
        "bedroomGroup": promo.bedroom_group,
        "usageLimit": promo.usage_limit,
        "usageCount": promo.usage_count,
        "active": promo.active,
        "createdAt": promo.created_at.isoformat(),
    }


def _serialize_cancellation_policy(policy):
    return {
        "id": str(policy.id),
        "scope": policy.scope,
        "propertyId": str(policy.property_id) if policy.property_id else None,
        "bedroomGroup": policy.bedroom_group,
        "policyType": policy.policy_type,
        "daysBeforeCheckin": policy.days_before_checkin,
        "refundPct": str(policy.refund_pct) if policy.refund_pct is not None else None,
        "autoProcess": policy.auto_process,
        "createdAt": policy.created_at.isoformat(),
    }


def _serialize_booking_settings(settings):
    return {
        "whatsappNumber": settings.whatsapp_number,
        "buildingAddress": settings.building_address,
        "buildingName": settings.building_name,
        "sameDayBookingEnabled": settings.same_day_booking_enabled,
        "sameDayBookingCutoffHour": settings.same_day_booking_cutoff_hour,
        "advanceBookingLimitMonths": settings.advance_booking_limit_months,
        "nonRefundableDiscountPct": str(settings.non_refundable_discount_pct),
    }


def _serialize_booking_request_pms(req, request):
    prop_photo = req.property.photos.order_by("sort_order", "id").first()
    photo_url = request.build_absolute_uri(prop_photo.photo.url) if prop_photo and prop_photo.photo else ""
    return {
        "id": str(req.id),
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
        "promoCode": req.promo_code.code if req.promo_code else None,
    }


def _serialize_property_photo(photo, request):
    return {
        "id": str(photo.id),
        "url": request.build_absolute_uri(photo.photo.url) if photo.photo else "",
        "sortOrder": photo.sort_order,
    }


# ---------------------------------------------------------------------------
# Booking Requests
# ---------------------------------------------------------------------------

def booking_request_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    # Expire stale pending requests
    BookingRequest.objects.filter(
        status=BookingRequest.Status.PENDING,
        expires_at__lt=timezone.now(),
    ).update(status=BookingRequest.Status.EXPIRED)

    pending = BookingRequest.objects.filter(
        status=BookingRequest.Status.PENDING,
    ).select_related("property", "promo_code").prefetch_related("property__photos").order_by("-created_at")

    # Recent confirmed direct bookings (last 10, expandable)
    offset = int(request.GET.get("offset") or "0")
    limit = int(request.GET.get("limit") or "10")
    confirmed = Reservation.objects.filter(
        platform=Reservation.Platform.DIRECT,
        is_archived=False,
    ).select_related("property").order_by("-created_at")[offset:offset + limit]
    total_confirmed = Reservation.objects.filter(
        platform=Reservation.Platform.DIRECT,
        is_archived=False,
    ).count()

    return JsonResponse({
        "pendingRequests": [_serialize_booking_request_pms(r, request) for r in pending],
        "confirmedBookings": [serialize_reservation(r) for r in confirmed],
        "totalConfirmed": total_confirmed,
    })


def booking_request_approve(request, request_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        req = BookingRequest.objects.select_related("property", "promo_code").get(pk=request_id)
    except BookingRequest.DoesNotExist:
        return JsonResponse({"error": "Booking request not found."}, status=404)

    if req.status != BookingRequest.Status.PENDING:
        return JsonResponse({"error": f"Cannot approve a request with status '{req.status}'."}, status=400)

    # Check for overlapping reservations (someone may have booked in the meantime)
    has_conflict = Reservation.objects.filter(
        property=req.property,
        check_in__lt=req.check_out,
        check_out__gt=req.check_in,
        is_archived=False,
    ).exclude(platform=Reservation.Platform.MAINTENANCE).exists()
    if has_conflict:
        return JsonResponse({"error": "A conflicting reservation exists for these dates."}, status=409)

    with transaction.atomic():
        nights = req.nights
        total = req.total_price_eur
        nightly = (total / nights).quantize(Decimal("0.01")) if nights else req.property.base_price_eur

        reservation = Reservation(
            property=req.property,
            guest_name=req.guest_name,
            guest_phone=req.guest_phone,
            guest_email=req.guest_email,
            platform=Reservation.Platform.DIRECT,
            check_in=req.check_in,
            check_out=req.check_out,
            guests_count=req.guests_count,
            nightly_price_eur=nightly,
            paid=False,
            online_payment_status=Reservation.OnlinePaymentStatus.NONE,
            is_non_refundable=False,
            price_breakdown_json=req.price_breakdown,
            notes=f"Direct booking via website (Pay at Property). Approved from request {req.id}.",
        )
        reservation.save()

        req.status = BookingRequest.Status.APPROVED
        req.reservation = reservation
        req.save(update_fields=["status", "reservation"])

    return JsonResponse({
        "message": "Request approved and reservation created.",
        "reservationId": str(reservation.id),
        "request": _serialize_booking_request_pms(req, request),
    })


def booking_request_reject(request, request_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        req = BookingRequest.objects.select_related("property").get(pk=request_id)
    except BookingRequest.DoesNotExist:
        return JsonResponse({"error": "Booking request not found."}, status=404)

    if req.status != BookingRequest.Status.PENDING:
        return JsonResponse({"error": f"Cannot reject a request with status '{req.status}'."}, status=400)

    payload = json_payload(request)
    rejection_message = (payload.get("rejectionMessage") or "").strip()

    req.status = BookingRequest.Status.REJECTED
    req.rejection_message = rejection_message
    req.save(update_fields=["status", "rejection_message"])

    return JsonResponse({
        "message": "Request rejected.",
        "request": _serialize_booking_request_pms(req, request),
    })


# ---------------------------------------------------------------------------
# Pricing Rules
# ---------------------------------------------------------------------------

def pricing_rule_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        rules = PricingRule.objects.select_related("property").order_by("rule_type", "scope")
        return JsonResponse({"pricingRules": [_serialize_pricing_rule(r) for r in rules]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            rule = _apply_pricing_rule_payload(PricingRule(), payload)
            rule.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"pricingRule": _serialize_pricing_rule(rule)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def pricing_rule_detail(request, rule_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        rule = PricingRule.objects.get(pk=rule_id)
    except PricingRule.DoesNotExist:
        return JsonResponse({"error": "Pricing rule not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            rule = _apply_pricing_rule_payload(rule, payload)
            rule.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"pricingRule": _serialize_pricing_rule(rule)})

    if request.method == "DELETE":
        rule.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def _apply_pricing_rule_payload(rule, payload):
    if "ruleType" in payload:
        rule.rule_type = payload["ruleType"]
    if "scope" in payload:
        rule.scope = payload["scope"]
    if "propertyId" in payload:
        pid = payload.get("propertyId")
        rule.property_id = pid if pid else None
    if "bedroomGroup" in payload:
        bg = payload.get("bedroomGroup")
        rule.bedroom_group = int(bg) if bg else None
    if "enabled" in payload:
        rule.enabled = bool(payload["enabled"])
    if "minNights" in payload:
        mn = payload.get("minNights")
        rule.min_nights = int(mn) if mn else None
    if "discountPct" in payload:
        dp = payload.get("discountPct")
        rule.discount_pct = Decimal(str(dp)) if dp else None
    if "daysBeforeCheckin" in payload:
        db = payload.get("daysBeforeCheckin")
        rule.days_before_checkin = int(db) if db else None
    if "startDate" in payload:
        sd = payload.get("startDate")
        rule.start_date = date.fromisoformat(sd) if sd else None
    if "endDate" in payload:
        ed = payload.get("endDate")
        rule.end_date = date.fromisoformat(ed) if ed else None
    if "adjustmentType" in payload:
        rule.adjustment_type = payload.get("adjustmentType") or None
    if "adjustmentValue" in payload:
        av = payload.get("adjustmentValue")
        rule.adjustment_value = Decimal(str(av)) if av else None
    return rule


# ---------------------------------------------------------------------------
# Promo Codes
# ---------------------------------------------------------------------------

def promo_code_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        codes = PromoCode.objects.select_related("property").order_by("code")
        return JsonResponse({"promoCodes": [_serialize_promo_code(c) for c in codes]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            promo = _apply_promo_payload(PromoCode(), payload)
            promo.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"promoCode": _serialize_promo_code(promo)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def promo_code_detail(request, code_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        promo = PromoCode.objects.get(pk=code_id)
    except PromoCode.DoesNotExist:
        return JsonResponse({"error": "Promo code not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            promo = _apply_promo_payload(promo, payload)
            promo.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"promoCode": _serialize_promo_code(promo)})

    if request.method == "DELETE":
        promo.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def _apply_promo_payload(promo, payload):
    if "code" in payload:
        promo.code = (payload.get("code") or "").strip().upper()
    if "discountType" in payload:
        promo.discount_type = payload["discountType"]
    if "discountValue" in payload:
        promo.discount_value = Decimal(str(payload["discountValue"]))
    if "scope" in payload:
        promo.scope = payload["scope"]
    if "propertyId" in payload:
        pid = payload.get("propertyId")
        promo.property_id = pid if pid else None
    if "bedroomGroup" in payload:
        bg = payload.get("bedroomGroup")
        promo.bedroom_group = int(bg) if bg else None
    if "usageLimit" in payload:
        ul = payload.get("usageLimit")
        promo.usage_limit = int(ul) if ul else None
    if "active" in payload:
        promo.active = bool(payload["active"])
    return promo


# ---------------------------------------------------------------------------
# Cancellation Policies
# ---------------------------------------------------------------------------

def cancellation_policy_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        policies = CancellationPolicy.objects.select_related("property").order_by("scope", "policy_type")
        return JsonResponse({"cancellationPolicies": [_serialize_cancellation_policy(p) for p in policies]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            policy = _apply_policy_payload(CancellationPolicy(), payload)
            policy.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"cancellationPolicy": _serialize_cancellation_policy(policy)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def cancellation_policy_detail(request, policy_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        policy = CancellationPolicy.objects.get(pk=policy_id)
    except CancellationPolicy.DoesNotExist:
        return JsonResponse({"error": "Cancellation policy not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            policy = _apply_policy_payload(policy, payload)
            policy.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"cancellationPolicy": _serialize_cancellation_policy(policy)})

    if request.method == "DELETE":
        policy.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def _apply_policy_payload(policy, payload):
    if "scope" in payload:
        policy.scope = payload["scope"]
    if "propertyId" in payload:
        pid = payload.get("propertyId")
        policy.property_id = pid if pid else None
    if "bedroomGroup" in payload:
        bg = payload.get("bedroomGroup")
        policy.bedroom_group = int(bg) if bg else None
    if "policyType" in payload:
        policy.policy_type = payload["policyType"]
    if "daysBeforeCheckin" in payload:
        db = payload.get("daysBeforeCheckin")
        policy.days_before_checkin = int(db) if db else None
    if "refundPct" in payload:
        rp = payload.get("refundPct")
        policy.refund_pct = Decimal(str(rp)) if rp else None
    if "autoProcess" in payload:
        policy.auto_process = bool(payload["autoProcess"])
    return policy


# ---------------------------------------------------------------------------
# Amenities
# ---------------------------------------------------------------------------

def amenity_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        amenities = Amenity.objects.order_by("sort_order", "name")
        return JsonResponse({"amenities": [_serialize_amenity(a) for a in amenities]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            name = (payload.get("name") or "").strip()
            if not name:
                return JsonResponse({"error": {"name": "Name is required."}}, status=400)
            amenity = Amenity(
                name=name,
                icon=(payload.get("icon") or "").strip(),
                sort_order=int(payload.get("sortOrder") or 0),
            )
            amenity.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"amenity": _serialize_amenity(amenity)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def amenity_detail(request, amenity_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        amenity = Amenity.objects.get(pk=amenity_id)
    except Amenity.DoesNotExist:
        return JsonResponse({"error": "Amenity not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            if "name" in payload:
                amenity.name = (payload.get("name") or "").strip()
            if "icon" in payload:
                amenity.icon = (payload.get("icon") or "").strip()
            if "sortOrder" in payload:
                amenity.sort_order = int(payload.get("sortOrder") or 0)
            amenity.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"amenity": _serialize_amenity(amenity)})

    if request.method == "DELETE":
        amenity.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


# ---------------------------------------------------------------------------
# House Rules
# ---------------------------------------------------------------------------

def house_rule_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        rules = HouseRule.objects.order_by("sort_order", "id")
        return JsonResponse({"houseRules": [_serialize_house_rule(r) for r in rules]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            text = (payload.get("text") or "").strip()
            if not text:
                return JsonResponse({"error": {"text": "Rule text is required."}}, status=400)
            rule = HouseRule(
                text=text,
                sort_order=int(payload.get("sortOrder") or 0),
                active=bool(payload.get("active", True)),
            )
            rule.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"houseRule": _serialize_house_rule(rule)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def house_rule_detail(request, rule_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        rule = HouseRule.objects.get(pk=rule_id)
    except HouseRule.DoesNotExist:
        return JsonResponse({"error": "House rule not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            if "text" in payload:
                rule.text = (payload.get("text") or "").strip()
            if "sortOrder" in payload:
                rule.sort_order = int(payload.get("sortOrder") or 0)
            if "active" in payload:
                rule.active = bool(payload["active"])
            rule.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"houseRule": _serialize_house_rule(rule)})

    if request.method == "DELETE":
        rule.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


# ---------------------------------------------------------------------------
# Booking Site Settings
# ---------------------------------------------------------------------------

def booking_settings_pms(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    settings = BookingSiteSettings.get()

    if request.method == "GET":
        return JsonResponse({"bookingSettings": _serialize_booking_settings(settings)})

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            if "whatsappNumber" in payload:
                settings.whatsapp_number = (payload.get("whatsappNumber") or "").strip()
            if "buildingAddress" in payload:
                settings.building_address = payload.get("buildingAddress") or ""
            if "buildingName" in payload:
                settings.building_name = (payload.get("buildingName") or "").strip()
            if "sameDayBookingEnabled" in payload:
                settings.same_day_booking_enabled = bool(payload["sameDayBookingEnabled"])
            if "sameDayBookingCutoffHour" in payload:
                h = int(payload.get("sameDayBookingCutoffHour") or 18)
                if not (0 <= h <= 23):
                    return JsonResponse({"error": "Cutoff hour must be 0–23."}, status=400)
                settings.same_day_booking_cutoff_hour = h
            if "advanceBookingLimitMonths" in payload:
                settings.advance_booking_limit_months = int(payload.get("advanceBookingLimitMonths") or 12)
            if "nonRefundableDiscountPct" in payload:
                settings.non_refundable_discount_pct = Decimal(str(payload["nonRefundableDiscountPct"]))
            settings.save()
        except (ValueError, TypeError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"bookingSettings": _serialize_booking_settings(settings)})

    return JsonResponse({"error": "Method not allowed."}, status=405)


# ---------------------------------------------------------------------------
# Property Photos
# ---------------------------------------------------------------------------

def property_photo_list(request, property_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        prop = Property.objects.get(pk=property_id)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    if request.method == "GET":
        photos = PropertyPhoto.objects.filter(property=prop).order_by("sort_order", "id")
        return JsonResponse({"photos": [_serialize_property_photo(p, request) for p in photos]})

    if request.method == "POST":
        parser = MultiPartParser(request.META, request, request.upload_handlers)
        post_data, files = parser.parse()
        if not files.get("photo"):
            return JsonResponse({"error": "A photo file is required."}, status=400)
        sort_order = int(post_data.get("sortOrder") or PropertyPhoto.objects.filter(property=prop).count())
        photo = PropertyPhoto(property=prop, photo=files["photo"], sort_order=sort_order)
        photo.save()
        return JsonResponse({"photo": _serialize_property_photo(photo, request)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def property_photo_detail(request, property_id, photo_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        photo = PropertyPhoto.objects.get(pk=photo_id, property_id=property_id)
    except PropertyPhoto.DoesNotExist:
        return JsonResponse({"error": "Photo not found."}, status=404)

    if request.method == "DELETE":
        photo.photo.delete(save=False)
        photo.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def property_photo_reorder(request, property_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        items = payload.get("photos") or []
        with transaction.atomic():
            for item in items:
                PropertyPhoto.objects.filter(
                    pk=item["id"], property_id=property_id
                ).update(sort_order=int(item["sortOrder"]))
    except (ValueError, KeyError, TypeError) as e:
        return JsonResponse({"error": str(e)}, status=400)

    photos = PropertyPhoto.objects.filter(property_id=property_id).order_by("sort_order", "id")
    return JsonResponse({"photos": [_serialize_property_photo(p, request) for p in photos]})


# ---------------------------------------------------------------------------
# Property Amenities (assign amenities to a property)
# ---------------------------------------------------------------------------

def property_amenity_update(request, property_id):
    """PATCH — set the full list of amenity IDs for a property."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        prop = Property.objects.get(pk=property_id)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    try:
        payload = json_payload(request)
        amenity_ids = payload.get("amenityIds") or []
        with transaction.atomic():
            PropertyAmenity.objects.filter(property=prop).delete()
            for aid in amenity_ids:
                amenity = Amenity.objects.get(pk=aid)
                PropertyAmenity.objects.create(property=prop, amenity=amenity)
    except Amenity.DoesNotExist:
        return JsonResponse({"error": "One or more amenity IDs are invalid."}, status=400)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)

    result_ids = list(PropertyAmenity.objects.filter(property=prop).values_list("amenity_id", flat=True))
    return JsonResponse({"amenityIds": [str(aid) for aid in result_ids]})
