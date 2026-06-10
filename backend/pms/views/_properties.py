import calendar
from datetime import datetime, timezone
from urllib.error import URLError

from django.core.exceptions import ValidationError
from django.http import HttpResponse, JsonResponse
from django.http.multipartparser import MultiPartParser
from django.views.decorators.csrf import csrf_exempt

from ..models import Property, Reservation, SyncLog
from ._ical import escape_ical, fetch_ical_events, import_ical_reservations, reservation_label_for_export
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_property
from ._utils import decimal_value, json_payload


@csrf_exempt
def property_list(request):
    if request.method == "GET":
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
        if denied:
            return denied
        platform = request.GET.get("platform") or Property.Platform.AIRSTAY
        properties = Property.objects.filter(active=True, platform=platform).order_by("name")
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
            prop = Property(
                name=name,
                bedrooms=bedrooms,
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


@csrf_exempt
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


@csrf_exempt
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
            conflict_count=0,
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


def build_property_calendar_response(prop):
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    reservations = Reservation.objects.filter(property=prop).order_by("check_in")
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
            f"SUMMARY:{escape_ical(reservation_label_for_export(reservation))}",
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

    return build_property_calendar_response(prop)


def property_calendar_export(request, property_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        prop = Property.objects.get(pk=property_id)
    except Property.DoesNotExist:
        return HttpResponse("Property not found.", status=404, content_type="text/plain")

    return build_property_calendar_response(prop)
