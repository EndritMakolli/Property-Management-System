import calendar
from datetime import datetime, timezone
from urllib.error import URLError

from django.core.exceptions import ValidationError
from django.http import HttpResponse, JsonResponse
from django.http.multipartparser import MultiPartParser

from ..models import Property, PropertyReview, Reservation, SyncLog
from ._ical import escape_ical, fetch_ical_events, import_ical_reservations, reservation_label_for_export
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_property
from ._utils import decimal_value, json_payload


def property_list(request):
    if request.method == "GET":
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
        if denied:
            return denied
        platform = request.GET.get("platform") or Property.Platform.AIRSTAY
        properties = (
            Property.objects.filter(active=True, platform=platform)
            .prefetch_related("property_amenities")
            .order_by("name")
        )
        return JsonResponse({"properties": [serialize_property(prop, request) for prop in properties]})

    if request.method == "POST":
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
        if denied:
            return denied
        try:
            name = (request.POST.get("name") or "").strip()
            if not name:
                raise ValidationError({"name": "Enter a property name."})
            bedrooms = int(request.POST.get("bedrooms") or "1")
            if bedrooms < 0:
                raise ValidationError({"bedrooms": "Bedrooms cannot be negative."})
            platform = request.POST.get("platform") or Property.Platform.AIRSTAY
            if platform not in Property.Platform.values:
                platform = Property.Platform.AIRSTAY
            listing_active_raw = request.POST.get("listingActive", "true")
            listing_active = listing_active_raw not in ("false", "0", "False")
            max_guests_raw = request.POST.get("maxGuests")
            beds_raw = request.POST.get("beds")
            bathrooms_raw = request.POST.get("bathrooms")
            rating_raw = (request.POST.get("rating") or "").strip()
            review_count_raw = request.POST.get("reviewCount")
            prop = Property(
                name=name,
                bedrooms=bedrooms,
                beds=int(beds_raw) if beds_raw else 1,
                bathrooms=int(bathrooms_raw) if bathrooms_raw else 1,
                address=request.POST.get("address") or "",
                floor=request.POST.get("floor") or "",
                wifi_name=request.POST.get("wifiName") or "",
                wifi_password=request.POST.get("wifiPassword") or "",
                base_price_eur=decimal_value(request.POST.get("basePriceEur"), "basePriceEur"),
                platform=platform,
                active=True,
                description=request.POST.get("description") or "",
                listing_active=listing_active,
                max_guests=int(max_guests_raw) if max_guests_raw else None,
                location_label=request.POST.get("locationLabel") or "",
                rating=decimal_value(rating_raw, "rating") if rating_raw else None,
                review_count=int(review_count_raw) if review_count_raw else 0,
            )
            if request.FILES.get("photo"):
                prop.photo = request.FILES["photo"]
            prop.save()
        except ValueError:
            return JsonResponse({"error": {"bedrooms": "Enter a valid bedroom number."}}, status=400)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"property": serialize_property(prop, request)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def property_detail(request, property_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        prop = Property.objects.get(pk=property_id)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    if request.method == "PATCH":
        try:
            is_multipart = request.content_type and request.content_type.startswith("multipart/")
            if is_multipart:
                parser = MultiPartParser(request.META, request, request.upload_handlers)
                post_data, files = parser.parse()
                payload = post_data
            else:
                payload = json_payload(request)
                files = {}

            if "name" in payload:
                prop.name = (payload.get("name") or "").strip()
                if not prop.name:
                    raise ValidationError({"name": "Enter a property name."})
            if "bedrooms" in payload:
                prop.bedrooms = int(payload.get("bedrooms") or "0")
                if prop.bedrooms < 0:
                    raise ValidationError({"bedrooms": "Bedrooms cannot be negative."})
            if "beds" in payload:
                prop.beds = int(payload.get("beds") or "1")
            if "bathrooms" in payload:
                prop.bathrooms = int(payload.get("bathrooms") or "1")
            if "locationLabel" in payload:
                prop.location_label = payload.get("locationLabel") or ""
            if "rating" in payload:
                rating_val = (str(payload.get("rating")) if payload.get("rating") is not None else "").strip()
                prop.rating = decimal_value(rating_val, "rating") if rating_val else None
            if "reviewCount" in payload:
                rc = payload.get("reviewCount")
                prop.review_count = int(rc) if rc not in (None, "") else 0
            if "basePriceEur" in payload:
                prop.base_price_eur = decimal_value(payload.get("basePriceEur"), "basePriceEur")
            if "address" in payload:
                prop.address = payload.get("address") or ""
            if "floor" in payload:
                prop.floor = payload.get("floor") or ""
            if "wifiName" in payload:
                prop.wifi_name = payload.get("wifiName") or ""
            if "wifiPassword" in payload:
                prop.wifi_password = payload.get("wifiPassword") or ""
            if "autoSyncEnabled" in payload:
                prop.auto_sync_enabled = bool(payload.get("autoSyncEnabled"))
            if "syncIntervalHours" in payload:
                prop.sync_interval_hours = int(payload.get("syncIntervalHours") or 24)
            if "description" in payload:
                prop.description = payload.get("description") or ""
            if "listingActive" in payload:
                raw = payload.get("listingActive")
                prop.listing_active = raw not in ("false", "0", "False", False)
            if "maxGuests" in payload:
                raw_mg = payload.get("maxGuests")
                prop.max_guests = int(raw_mg) if raw_mg else None
            if not is_multipart:
                if "airbnbIcalUrl" in payload:
                    prop.airbnb_ical_url = (payload.get("airbnbIcalUrl") or "").strip() or None
                if "bookingIcalUrl" in payload:
                    prop.booking_ical_url = (payload.get("bookingIcalUrl") or "").strip() or None
            if files.get("photo"):
                prop.photo = files["photo"]
            prop.full_clean()
            prop.save()
        except ValueError:
            return JsonResponse({"error": {"bedrooms": "Enter a valid bedroom number."}}, status=400)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"property": serialize_property(prop, request)})

    if request.method == "DELETE":
        denied = require_roles(request, [ROLE_ADMIN])
        if denied:
            return denied
        prop.active = False
        prop.save(update_fields=["active"])
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def _serialize_property_review(review):
    return {
        "id": str(review.id),
        "guestName": review.guest_name,
        "rating": review.rating,
        "comment": review.comment,
        "stayLabel": review.stay_label,
    }


def property_review_list(request, property_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        prop = Property.objects.get(pk=property_id)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    if request.method == "GET":
        return JsonResponse({"reviews": [_serialize_property_review(r) for r in prop.reviews.all()]})

    if request.method == "POST":
        payload = json_payload(request)
        guest_name = (payload.get("guestName") or "").strip()
        if not guest_name:
            return JsonResponse({"error": {"guestName": "Enter a guest name."}}, status=400)
        try:
            rating = int(payload.get("rating") or 5)
        except (ValueError, TypeError):
            rating = 5
        rating = max(1, min(5, rating))
        review = PropertyReview.objects.create(
            property=prop,
            guest_name=guest_name,
            rating=rating,
            comment=payload.get("comment") or "",
            stay_label=payload.get("stayLabel") or "",
        )
        return JsonResponse({"review": _serialize_property_review(review)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def property_review_detail(request, property_id, review_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "DELETE":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    PropertyReview.objects.filter(pk=review_id, property_id=property_id).delete()
    return JsonResponse({}, status=204)


def property_sync(request, property_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        prop = Property.objects.get(pk=property_id)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        channel = payload.get("channel") or "airbnb"
        if channel == Reservation.Platform.AIRBNB:
            ical_url = prop.airbnb_ical_url
            if not ical_url:
                return JsonResponse({"error": "Add an Airbnb iCal link first."}, status=400)
        elif channel == Reservation.Platform.BOOKING:
            ical_url = prop.booking_ical_url
            if not ical_url:
                return JsonResponse({"error": "Add a Booking.com iCal link first."}, status=400)
        else:
            return JsonResponse({"error": "Choose airbnb or booking as the channel."}, status=400)

        events = fetch_ical_events(ical_url)
        result = import_ical_reservations(prop, channel, events)
        SyncLog.objects.create(
            property=prop,
            channel=channel,
            status="completed",
            imported_count=result["imported"],
            updated_count=result["updated"],
            skipped_count=result["skipped"],
            conflict_count=result.get("conflicts", 0),
            error_message="; ".join(result["errors"]) if result["errors"] else "",
        )
    except (URLError, TimeoutError):
        SyncLog.objects.create(
            property=prop,
            channel=payload.get("channel", "airbnb"),
            status="failed",
            error_message="Could not reach the calendar link.",
        )
        return JsonResponse({"error": "Could not reach the calendar link."}, status=400)
    except ValidationError as error:
        return JsonResponse(
            {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
            status=400,
        )

    return JsonResponse({"sync": result})


def build_property_calendar_response(prop, public=False):
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    # Only live reservations block the calendar — archived/cancelled ones must not.
    reservations = Reservation.objects.filter(property=prop, is_archived=False).order_by("check_in")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//PMS//Property Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_ical(prop.name)}",
    ]
    for reservation in reservations:
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{reservation.id}@pms",
            f"DTSTAMP:{timestamp}",
            f"DTSTART;VALUE=DATE:{reservation.check_in.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{reservation.check_out.strftime('%Y%m%d')}",
            f"SUMMARY:{escape_ical(reservation_label_for_export(reservation, public))}",
            "TRANSP:OPAQUE",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")

    response = HttpResponse("\r\n".join(lines) + "\r\n", content_type="text/calendar; charset=utf-8")
    response["Content-Disposition"] = f'inline; filename="{prop.id}.ics"'
    response["Cache-Control"] = "no-cache"
    return response


def public_property_calendar_export(request, export_token):
    try:
        prop = Property.objects.get(calendar_export_token=export_token, active=True)
    except Property.DoesNotExist:
        return HttpResponse("Calendar not found.", status=404, content_type="text/plain")

    return build_property_calendar_response(prop, public=True)


def property_calendar_export(request, property_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        prop = Property.objects.get(pk=property_id)
    except Property.DoesNotExist:
        return HttpResponse("Property not found.", status=404, content_type="text/plain")

    return build_property_calendar_response(prop)
