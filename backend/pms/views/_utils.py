import json
from datetime import date
from decimal import Decimal, InvalidOperation
from functools import wraps

from django.conf import settings
from django.utils.timezone import localdate
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django_ratelimit.decorators import ratelimit

from ..models import FinanceExpense


def ratelimit_client_ip(request):
    """Client IP for rate limiting, tolerant of a missing proxy header.

    django-ratelimit raises ImproperlyConfigured (a 500) when
    RATELIMIT_IP_META_KEY names a header that is not present on the request —
    which turns any unproxied request into a server error on every throttled
    endpoint. Prefer the forwarded address when the deployment says a trusted
    proxy sets it, but always fall back to REMOTE_ADDR rather than blowing up.
    """
    if getattr(settings, "TRUST_PROXY_HEADERS", False):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            # Left-most entry is the original client; the rest are proxies.
            client = forwarded.split(",")[0].strip()
            if client:
                return client
    return request.META.get("REMOTE_ADDR") or "0.0.0.0"


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


def paginate(queryset, request, default_limit=20, max_limit=100):
    """Slice a queryset by ?limit / ?offset, returning (rows, total).

    The cap is the point: without it `?limit=100000` is the unbounded query
    paging was added to remove. Rubbish values fall back to the default rather
    than raising - a malformed query string should not be a 500.
    """
    def whole(name, fallback):
        try:
            return int(request.GET.get(name) or fallback)
        except (TypeError, ValueError):
            return fallback

    limit = max(1, min(whole("limit", default_limit), max_limit))
    offset = max(0, whole("offset", 0))
    # One COUNT before slicing; the slice itself is a LIMIT/OFFSET in SQL.
    total = queryset.count()
    return list(queryset[offset:offset + limit]), total
