import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.http import JsonResponse

from ..models import ExpenseCategory, FinanceExpense, FinancialObligation, Loan, Reservation
from ._payloads import apply_finance_expense_payload, apply_loan_payload, apply_obligation_payload
from ._roles import ROLE_ADMIN, require_roles
from ._serializers import (
    serialize_expense_category,
    serialize_finance_expense,
    serialize_financial_obligation,
    serialize_loan,
)
from ._utils import is_active_for_month, json_payload, selected_period


def finance_summary(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        year, month = selected_period(request)
    except ValidationError as error:
        return JsonResponse({"error": error.messages}, status=400)

    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])

    all_expenses = [
        e for e in FinanceExpense.objects.filter(start_year__lte=year).select_related("category")
        if is_active_for_month(e, year, month)
    ]
    loans = [
        l for l in Loan.objects.filter(start_year__lte=year)
        if is_active_for_month(l, year, month)
    ]
    obligations = FinancialObligation.objects.all()
    loan_total = sum((l.monthly_value_eur for l in loans), Decimal("0.00"))
    unpaid_obligations_total = sum(
        (o.amount_eur for o in obligations if not o.paid), Decimal("0.00")
    )

    def platform_summary(property_platform):
        platform_reservations = Reservation.objects.filter(
            check_in__lte=month_end,
            check_out__gt=month_start,
            is_archived=False,
            platform__in=["airbnb", "booking", "private"],
            property__platform=property_platform,
        )
        turnover = sum(
            (reservation_revenue_inside_month(r, month_start, month_end) for r in platform_reservations),
            Decimal("0.00"),
        )
        # Include platform-specific expenses + shared (platform=None) expenses
        platform_expenses = [e for e in all_expenses if e.platform == property_platform or e.platform is None]
        expenses_total = sum((e.amount_eur for e in platform_expenses), Decimal("0.00"))
        return {
            "turnoverEur": str(turnover),
            "expensesEur": str(expenses_total),
            "profitEur": str(turnover - expenses_total),
        }

    return JsonResponse({
        "summary": {
            "airstay": platform_summary("airstay"),
            "fleet": platform_summary("fleet"),
            "loanPaymentsEur": str(loan_total),
            "totalDebtEur": str(unpaid_obligations_total),
        },
        "expenses": [serialize_finance_expense(e) for e in all_expenses],
        "loans": [serialize_loan(l) for l in loans],
        "obligations": [serialize_financial_obligation(o) for o in obligations],
    })


def expense_category_list(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method == "GET":
        categories = ExpenseCategory.objects.all()
        return JsonResponse({"categories": [serialize_expense_category(item) for item in categories]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            name = (payload.get("name") or "").strip()
            if not name:
                raise ValidationError({"name": "Enter a category name."})
            color = (payload.get("color") or "#6b7280").strip()
            category, _created = ExpenseCategory.objects.get_or_create(name=name, defaults={"color": color})
            if not _created and "color" in payload:
                category.color = color
                category.save(update_fields=["color"])
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"category": serialize_expense_category(category)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def expense_category_detail(request, category_id):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    try:
        category = ExpenseCategory.objects.get(pk=category_id)
    except ExpenseCategory.DoesNotExist:
        return JsonResponse({"error": "Category not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            fields = []
            name = (payload.get("name") or "").strip()
            if name:
                category.name = name
                fields.append("name")
            color = (payload.get("color") or "").strip()
            if color:
                category.color = color
                fields.append("color")
            if fields:
                category.save(update_fields=fields)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"category": serialize_expense_category(category)})

    if request.method == "DELETE":
        if category.finance_expenses.exists():
            return JsonResponse(
                {"error": "Cannot delete a category that has expenses assigned to it."},
                status=400,
            )
        category.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def reservation_revenue_inside_month(reservation, month_start, month_end):
    if not reservation.nights:
        return Decimal("0.00")

    overlap_start = max(reservation.check_in, month_start)
    overlap_end = min(reservation.check_out, month_end + date.resolution)
    nights_in_month = max((overlap_end - overlap_start).days, 0)

    if nights_in_month <= 0:
        return Decimal("0.00")

    cents = Decimal("0.01")
    nightly_share = reservation.total_price_eur / Decimal(reservation.nights)
    return (nightly_share * Decimal(nights_in_month)).quantize(
        cents, rounding=ROUND_HALF_UP
    )


def finance_expense_list(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method == "GET":
        expenses = FinanceExpense.objects.select_related("category")
        return JsonResponse({"expenses": [serialize_finance_expense(item) for item in expenses]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            expense = apply_finance_expense_payload(FinanceExpense(), payload)
            expense.save()
        except (ExpenseCategory.DoesNotExist, ValueError):
            return JsonResponse(
                {"error": "Choose a valid expense category and date range."}, status=400
            )
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"expense": serialize_finance_expense(expense)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def finance_expense_detail(request, expense_id):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    try:
        expense = FinanceExpense.objects.select_related("category").get(pk=expense_id)
    except FinanceExpense.DoesNotExist:
        return JsonResponse({"error": "Expense not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            expense = apply_finance_expense_payload(expense, payload)
            expense.save()
        except (ExpenseCategory.DoesNotExist, ValueError):
            return JsonResponse(
                {"error": "Choose a valid expense category and date range."}, status=400
            )
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"expense": serialize_finance_expense(expense)})

    if request.method == "DELETE":
        expense.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def loan_list(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method == "GET":
        loans = Loan.objects.all()
        return JsonResponse({"loans": [serialize_loan(item) for item in loans]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            loan = apply_loan_payload(Loan(), payload)
            loan.save()
        except (ValueError, ValidationError) as error:
            if isinstance(error, ValidationError):
                return JsonResponse(
                    {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                    status=400,
                )
            return JsonResponse({"error": "Choose a valid loan date range."}, status=400)
        return JsonResponse({"loan": serialize_loan(loan)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def loan_detail(request, loan_id):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    try:
        loan = Loan.objects.get(pk=loan_id)
    except Loan.DoesNotExist:
        return JsonResponse({"error": "Loan not found."}, status=404)

    if request.method == "DELETE":
        loan.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def obligation_list(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method == "GET":
        obligations = FinancialObligation.objects.all()
        return JsonResponse({"obligations": [serialize_financial_obligation(item) for item in obligations]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            obligation = apply_obligation_payload(FinancialObligation(), payload)
            obligation.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"obligation": serialize_financial_obligation(obligation)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def obligation_detail(request, obligation_id):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    try:
        obligation = FinancialObligation.objects.get(pk=obligation_id)
    except FinancialObligation.DoesNotExist:
        return JsonResponse({"error": "Obligation not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            obligation = apply_obligation_payload(obligation, payload)
            obligation.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"obligation": serialize_financial_obligation(obligation)})

    if request.method == "DELETE":
        obligation.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)
