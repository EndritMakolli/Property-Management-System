import json
from datetime import date
from decimal import Decimal, InvalidOperation
from functools import wraps

from django.utils.timezone import localdate
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django_ratelimit.decorators import ratelimit

from ..models import FinanceExpense


def throttle(rate, key="ip", methods=("POST",)):
    """Rate-limit a view by client IP, returning a JSON 429 (not an HTML 403).

    Backed by django-ratelimit + Django's cache. On a single Render instance the
    default in-memory cache is enough; switch to a shared cache (Redis) if you
    ever run multiple workers/instances so the limit is enforced globally.
    """
    def decorator(view):
        @wraps(view)
        def guarded(request, *args, **kwargs):
            if getattr(request, "limited", False):
                return JsonResponse(
                    {"error": "Too many requests. Please wait a moment and try again."},
                    status=429,
                )
            return view(request, *args, **kwargs)

        return ratelimit(key=key, rate=rate, method=list(methods), block=False)(guarded)

    return decorator


def json_payload(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        raise ValidationError("Invalid JSON payload.")


def decimal_value(value, field_name):
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, ValueError):
        raise ValidationError({field_name: "Enter a valid number."})


def date_value(value, field_name, required=True):
    if not value:
        if required:
            raise ValidationError({field_name: "Choose a date."})
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValidationError({field_name: "Enter a valid date."})


def selected_period(request):
    try:
        year = int(request.GET.get("year") or localdate().year)
        month = int(request.GET.get("month") or localdate().month)
        if month < 1 or month > 12:
            raise ValueError
    except ValueError:
        raise ValidationError("Choose a valid month and year.")
    return year, month


def period_number(year, month):
    return year * 12 + month


def is_active_for_month(item, year, month):
    selected = period_number(year, month)
    start = period_number(item.start_year, item.start_month)

    if selected < start:
        return False

    if getattr(item, "frequency", None) == FinanceExpense.Frequency.ONE_TIME:
        return selected == start

    if item.end_year and item.end_month:
        return selected <= period_number(item.end_year, item.end_month)

    return True
