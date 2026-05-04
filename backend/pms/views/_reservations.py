import calendar
from datetime import date

from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import Property, Reservation
from ._payloads import apply_reservation_payload
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_reservation
from ._utils import json_payload


@csrf_exempt
def reservation_list(request):
    if request.method == "GET":
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
        if denied:
            return denied

        year = request.GET.get("year")
        month = request.GET.get("month")
        property_id = request.GET.get("property")
        reservations = Reservation.objects.select_related("guest", "property").order_by(
            "check_in", "property__name"
        )

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

        return JsonResponse({"reservations": [serialize_reservation(item) for item in reservations]})

    if request.method == "POST":
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
        if denied:
            return denied
        try:
            payload = json_payload(request)
            reservation = apply_reservation_payload(Reservation(), payload)
            reservation.save()
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
            reservation = apply_reservation_payload(reservation, payload)
            reservation.save()
        except Property.DoesNotExist:
            return JsonResponse({"error": "Choose an existing property."}, status=400)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"reservation": serialize_reservation(reservation)})

    if request.method == "DELETE":
        reservation.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)
