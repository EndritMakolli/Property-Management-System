import calendar
from datetime import datetime, timezone
from urllib.error import URLError

from django.core.exceptions import ValidationError
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import Property, Reservation
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
        properties = Property.objects.filter(active=True).order_by("name")
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
            prop = Property(
                name=name,
                bedrooms=bedrooms,
                address=request.POST.get("address") or "",
                base_price_eur=decimal_value(request.POST.get("basePriceEur"), "basePriceEur"),
                active=True,
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
            payload = json_payload(request)
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
            if "airbnbIcalUrl" in payload:
                prop.airbnb_ical_url = (payload.get("airbnbIcalUrl") or "").strip() or None
            if "bookingIcalUrl" in payload:
                prop.booking_ical_url = (payload.get("bookingIcalUrl") or "").strip() or None
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
        if channel != Reservation.Platform.AIRBNB:
            return JsonResponse({"error": "Only Airbnb iCal sync is available right now."}, status=400)
        if not prop.airbnb_ical_url:
            return JsonResponse({"error": "Add an Airbnb iCal link first."}, status=400)
        events = fetch_ical_events(prop.airbnb_ical_url)
        result = import_ical_reservations(prop, Reservation.Platform.AIRBNB, events)
    except (URLError, TimeoutError):
        return JsonResponse({"error": "Could not reach the Airbnb calendar link."}, status=400)
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
