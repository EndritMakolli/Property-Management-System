import json
from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError

from ..models import FinanceExpense


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
        year = int(request.GET.get("year") or date.today().year)
        month = int(request.GET.get("month") or date.today().month)
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
