"""Servicing and registration for the Fleet vehicles.

`vehicle_alerts` is the single answer to "what needs attention on this
vehicle". The codes page, the dashboard and the notifications all call it, so
none of them can disagree about whether a van is overdue - which is exactly
what happens when three screens each do their own date arithmetic.
"""

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.utils.timezone import localdate

from ..models import Property
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._utils import date_value, json_payload

# Fallbacks only. Each vehicle carries its own window - see the model - and
# these are what a row created before the fields existed reads as.
REGISTRATION_WARNING_DAYS = 30
SERVICE_WARNING_DAYS = 30
SERVICE_WARNING_KM = 800


def _window(value, fallback):
    """A vehicle's own window, or the default. Zero is a real answer: it means
    "only tell me once it is overdue", so it must not fall through."""
    return fallback if value is None else value


def _add_months(start, months):
    """start + N months, clamping the day into a shorter month."""
    import calendar

    total = start.month - 1 + months
    year = start.year + total // 12
    month = total % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return start.replace(year=year, month=month, day=day)


def _service_alert(vehicle, today):
    """One alert for the next service, or None. Never two for the same job.

    A vehicle can be past due on the calendar *and* on the odometer. That is
    still one service to book, so the more urgent reading wins and only one
    alert comes out.
    """
    if not vehicle.last_service_date and vehicle.last_service_km is None:
        return {
            "kind": "service_unknown",
            "severity": "info",
            "message": "No service history recorded yet.",
        }

    overdue_reasons = []
    soon_reasons = []

    if vehicle.last_service_date and vehicle.service_interval_months:
        due = _add_months(vehicle.last_service_date, vehicle.service_interval_months)
        if today > due:
            overdue_reasons.append(f"{(today - due).days} days overdue")
        elif (due - today).days <= _window(vehicle.service_warning_days, SERVICE_WARNING_DAYS):
            soon_reasons.append(f"due in {(due - today).days} days")

    if (
        vehicle.last_service_km is not None
        and vehicle.current_km is not None
        and vehicle.service_interval_km
    ):
        driven = vehicle.current_km - vehicle.last_service_km
        remaining = vehicle.service_interval_km - driven
        if remaining < 0:
            overdue_reasons.append(f"{abs(remaining):,} km overdue")
        elif remaining <= _window(vehicle.service_warning_km, SERVICE_WARNING_KM):
            soon_reasons.append(f"{remaining:,} km to go")

    if overdue_reasons:
        return {
            "kind": "service_overdue",
            "severity": "overdue",
            "message": "Service overdue — " + ", ".join(overdue_reasons) + ".",
        }
    if soon_reasons:
        return {
            "kind": "service_due_soon",
            "severity": "soon",
            "message": "Service " + ", ".join(soon_reasons) + ".",
        }
    return None


def _registration_alert(vehicle, today):
    if not vehicle.registration_expiry:
        return {
            "kind": "registration_unknown",
            "severity": "info",
            "message": "No registration expiry recorded yet.",
        }

    days = (vehicle.registration_expiry - today).days
    if days < 0:
        return {
            "kind": "registration_expired",
            "severity": "overdue",
            "message": f"Registration expired {abs(days)} days ago.",
        }
    if days <= _window(vehicle.registration_warning_days, REGISTRATION_WARNING_DAYS):
        # Zero days left still means it is legal to drive today.
        when = "today" if days == 0 else f"in {days} days"
        return {
            "kind": "registration_due_soon",
            "severity": "soon",
            "message": f"Registration expires {when}.",
        }
    return None


def vehicle_alerts(vehicle, today=None):
    """Everything wanting attention on one vehicle, most urgent first."""
    today = today or localdate()
    alerts = [_service_alert(vehicle, today), _registration_alert(vehicle, today)]
    order = {"overdue": 0, "soon": 1, "info": 2}
    return sorted(
        [alert for alert in alerts if alert], key=lambda a: order.get(a["severity"], 3)
    )


def serialize_vehicle_service(vehicle, today=None):
    return {
        "id": str(vehicle.id),
        "name": vehicle.name,
        "photoUrl": vehicle.photo.url if vehicle.photo else "",
        "brand": vehicle.brand,
        "model": vehicle.model,
        "chassisNumber": vehicle.chassis_number,
        "licencePlate": vehicle.licence_plate,
        "allowedCountries": vehicle.allowed_countries,
        "lastServiceDate": vehicle.last_service_date.isoformat() if vehicle.last_service_date else "",
        "lastServiceKm": vehicle.last_service_km,
        "currentKm": vehicle.current_km,
        "serviceIntervalKm": vehicle.service_interval_km,
        "serviceIntervalMonths": vehicle.service_interval_months,
        "serviceWarningDays": vehicle.service_warning_days,
        "serviceWarningKm": vehicle.service_warning_km,
        "registrationWarningDays": vehicle.registration_warning_days,
        "registrationDate": vehicle.registration_date.isoformat() if vehicle.registration_date else "",
        "registrationExpiry": vehicle.registration_expiry.isoformat() if vehicle.registration_expiry else "",
        "alerts": vehicle_alerts(vehicle, today),
    }


def fleet_service_list(request):
    """GET — every vehicle with its service record and what it needs."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    today = localdate()
    vehicles = Property.objects.filter(
        active=True, platform=Property.Platform.FLEET
    ).order_by("name")
    return JsonResponse({
        "vehicles": [serialize_vehicle_service(vehicle, today) for vehicle in vehicles]
    })


def fleet_service_detail(request, property_id):
    """PATCH — record a service or a registration renewal."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        # Scoped to fleet: an apartment has no service record, and a 404 says
        # that more honestly than silently writing kilometres onto a flat.
        vehicle = Property.objects.get(pk=property_id, platform=Property.Platform.FLEET)
    except (Property.DoesNotExist, ValueError):
        return JsonResponse({"error": "Vehicle not found."}, status=404)

    payload = json_payload(request)
    try:
        for api_key, field in (
            ("lastServiceDate", "last_service_date"),
            ("registrationDate", "registration_date"),
            ("registrationExpiry", "registration_expiry"),
        ):
            if api_key in payload:
                setattr(
                    vehicle, field, date_value(payload.get(api_key), api_key, required=False)
                )

        for api_key, field in (
            ("brand", "brand"),
            ("model", "model"),
            ("chassisNumber", "chassis_number"),
            ("licencePlate", "licence_plate"),
            ("allowedCountries", "allowed_countries"),
        ):
            if api_key in payload:
                setattr(vehicle, field, (payload.get(api_key) or "").strip())

        for api_key, field in (
            ("lastServiceKm", "last_service_km"),
            ("currentKm", "current_km"),
            ("serviceIntervalKm", "service_interval_km"),
            ("serviceIntervalMonths", "service_interval_months"),
            ("serviceWarningDays", "service_warning_days"),
            ("serviceWarningKm", "service_warning_km"),
            ("registrationWarningDays", "registration_warning_days"),
        ):
            if api_key in payload:
                raw = payload.get(api_key)
                value = int(raw) if raw not in (None, "") else None
                # A negative window would silently never fire; say so instead.
                if value is not None and value < 0:
                    raise ValidationError({api_key: "Enter zero or more."})
                setattr(vehicle, field, value)

        # Kilometres do not go backwards. A transposed digit here would push the
        # next service out of sight rather than showing an obviously wrong number.
        if (
            vehicle.current_km is not None
            and vehicle.last_service_km is not None
            and vehicle.current_km < vehicle.last_service_km
        ):
            raise ValidationError(
                {"currentKm": "The odometer cannot read less than it did at the last service."}
            )
    except (TypeError, ValueError):
        return JsonResponse({"error": {"currentKm": "Enter kilometres as a whole number."}}, status=400)
    except ValidationError as error:
        return JsonResponse(
            {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
            status=400,
        )

    vehicle.save()
    return JsonResponse({"vehicle": serialize_vehicle_service(vehicle)})
