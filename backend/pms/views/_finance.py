import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.http import JsonResponse

from ..model_defs.monthly import monthly_periods
from ..models import (
    ExpenseCategory,
    ExpensePayment,
    FinanceExpense,
    FinancialObligation,
    Loan,
    MonthlyTax,
    Reservation,
)
from ._payloads import apply_finance_expense_payload, apply_loan_payload, apply_obligation_payload
from ._roles import ROLE_ADMIN, require_roles
from ._serializers import (
    serialize_expense_category,
    serialize_finance_expense,
    serialize_financial_obligation,
    serialize_loan,
)
from ._utils import is_active_for_month, json_payload, selected_period

# NOTE on the time basis used across the Expenses module: every statistic is
# keyed by the EXPENSE MONTH (start_year/start_month plus the recurrence),
# never by invoice date or payment date. invoice_date is metadata only.


def paid_amounts_for_month(year, month):
    """{expense_id: amount actually paid} for the given month.

    The amount comes from the ExpensePayment snapshot, not the expense's
    current value, so editing an expense later never rewrites what was paid.
    If an expense's price rises after payment, the difference correctly shows
    up as still unpaid.
    """
    return {
        expense_id: amount
        for expense_id, amount in ExpensePayment.objects.filter(
            year=year, month=month
        ).values_list("expense_id", "amount_eur")
    }


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

    # Month-specific paid state for each row. The Total/Paid/Unpaid tiles are
    # derived on the client from these rows so they honour the platform and
    # category filters the page applies — one source of truth, not two.
    paid_ids = set(paid_amounts_for_month(year, month))

    return JsonResponse({
        "summary": {
            "airstay": platform_summary("airstay"),
            "fleet": platform_summary("fleet"),
            "loanPaymentsEur": str(loan_total),
            "totalDebtEur": str(unpaid_obligations_total),
        },
        "expenses": [
            serialize_finance_expense(e, request, paid_expense_ids=paid_ids) for e in all_expenses
        ],
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
    if reservation.platform == "monthly" and reservation.monthly_price_eur is not None:
        # Flat rent per anniversary period, attributed to the period-start month.
        return sum(
            (
                reservation.monthly_price_eur
                for start, _end in monthly_periods(reservation.check_in, reservation.check_out)
                if month_start <= start <= month_end
            ),
            Decimal("0.00"),
        )

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
        return JsonResponse({"expenses": [serialize_finance_expense(item, request) for item in expenses]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            expense = apply_finance_expense_payload(FinanceExpense(), payload)
            expense.save()
            # Creating an expense already marked paid = its first month is paid.
            if payload.get("paid"):
                ExpensePayment.objects.get_or_create(
                    expense=expense,
                    year=expense.start_year,
                    month=expense.start_month,
                    defaults={"amount_eur": expense.amount_eur},
                )
        except (ExpenseCategory.DoesNotExist, ValueError):
            return JsonResponse(
                {"error": "Choose a valid expense category and date range."}, status=400
            )
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"expense": serialize_finance_expense(expense, request)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def expense_payment_view(request, expense_id):
    """POST {year, month, paid} — set an expense's paid state for one month."""
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        expense = FinanceExpense.objects.select_related("category").get(pk=expense_id)
    except FinanceExpense.DoesNotExist:
        return JsonResponse({"error": "Expense not found."}, status=404)

    try:
        payload = json_payload(request)
        year = int(payload.get("year"))
        month = int(payload.get("month"))
        paid = bool(payload.get("paid"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "Provide year, month and paid."}, status=400)

    if month < 1 or month > 12 or year < 2000 or year > 2100:
        return JsonResponse({"error": "Choose a valid month."}, status=400)
    if not is_active_for_month(expense, year, month):
        return JsonResponse(
            {"error": "This expense is not active in the selected month."}, status=400
        )

    if paid:
        ExpensePayment.objects.get_or_create(
            expense=expense,
            year=year,
            month=month,
            defaults={"amount_eur": expense.amount_eur},
        )
    else:
        ExpensePayment.objects.filter(expense=expense, year=year, month=month).delete()

    return JsonResponse({
        "expense": serialize_finance_expense(
            expense, request, paid_expense_ids={expense.id} if paid else set()
        )
    })


def finance_outstanding_expenses(request):
    """GET — every unpaid expense month up to and including the current month.

    The Payments page needs arrears, not just this month: a July wage left
    unpaid must stay visible in August. Looks back `?months=` months (default
    24, max 60) so old finished expenses don't pile up forever.
    """
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        lookback = int(request.GET.get("months") or 24)
    except ValueError:
        lookback = 24
    lookback = max(1, min(lookback, 60))

    today = date.today()
    current_period = today.year * 12 + (today.month - 1)
    first_period = current_period - (lookback - 1)

    paid_lookup = set(
        ExpensePayment.objects.filter(
            year__gte=first_period // 12
        ).values_list("expense_id", "year", "month")
    )

    outstanding = []
    for expense in FinanceExpense.objects.select_related("category"):
        for period in range(first_period, current_period + 1):
            year, month = period // 12, period % 12 + 1
            if not is_active_for_month(expense, year, month):
                continue
            if (expense.id, year, month) in paid_lookup:
                continue
            row = serialize_finance_expense(expense, request)
            row["year"] = year
            row["month"] = month
            outstanding.append(row)

    # Oldest arrears first — those need attention most.
    outstanding.sort(key=lambda row: (row["year"], row["month"], row["name"]))
    total = sum((Decimal(row["amountEur"]) for row in outstanding), Decimal("0.00"))

    return JsonResponse({"outstanding": outstanding, "totalEur": str(total)})


def _month_range_from_params(request):
    """Resolve ?all=1, ?year= or ?start=YYYY-MM&end=YYYY-MM into a month list."""
    start_raw = (request.GET.get("start") or "").strip()
    end_raw = (request.GET.get("end") or "").strip()
    if request.GET.get("all"):
        today = date.today()
        first = (
            FinanceExpense.objects.order_by("start_year", "start_month")
            .values_list("start_year", "start_month")
            .first()
        )
        start_year, start_month = first if first else (today.year, 1)
        # Guard against typo years creating enormous ranges.
        if today.year - start_year > 30:
            start_year, start_month = today.year - 30, 1
        return [
            (p // 12, p % 12 + 1)
            for p in range(
                start_year * 12 + (start_month - 1), today.year * 12 + today.month
            )
        ]
    if start_raw and end_raw:
        try:
            start_year, start_month = (int(p) for p in start_raw.split("-")[:2])
            end_year, end_month = (int(p) for p in end_raw.split("-")[:2])
        except (TypeError, ValueError):
            raise ValidationError("Use YYYY-MM for start and end.")
        if not (1 <= start_month <= 12 and 1 <= end_month <= 12):
            raise ValidationError("Use YYYY-MM for start and end.")
    else:
        try:
            year = int(request.GET.get("year") or date.today().year)
        except ValueError:
            raise ValidationError("Choose a valid year.")
        start_year, start_month = year, 1
        end_year, end_month = year, 12

    start_period = start_year * 12 + (start_month - 1)
    end_period = end_year * 12 + (end_month - 1)
    if end_period < start_period:
        raise ValidationError("The end month is before the start month.")
    if end_period - start_period + 1 > 120:
        raise ValidationError("Choose a range of at most 10 years.")

    return [(p // 12, p % 12 + 1) for p in range(start_period, end_period + 1)]


def finance_analytics(request):
    """GET — per-month expense series + top lists for a period.

    Period: ?year=YYYY (default: current year) or ?start=YYYY-MM&end=YYYY-MM.
    Amounts always use the expense's current amount as the consistent basis
    (payment snapshots stay in the DB for audit but are not mixed in here).
    """
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        months = _month_range_from_params(request)
    except ValidationError as error:
        return JsonResponse({"error": error.messages}, status=400)

    if not months:
        # e.g. ?all=1 when the only expenses start in a future month.
        return JsonResponse({
            "months": [],
            "topExpenses": [],
            "topRecurring": [],
            "topCategories": [],
            "categories": [serialize_expense_category(c) for c in ExpenseCategory.objects.all()],
            "start": "",
            "end": "",
        })

    expenses = list(FinanceExpense.objects.select_related("category"))
    # Amount paid per (expense, month) — the snapshot, so historical paid
    # figures stay put when an expense's current amount is edited later.
    paid_lookup = {
        (expense_id, year, month): amount
        for expense_id, year, month, amount in ExpensePayment.objects.filter(
            year__gte=months[0][0], year__lte=months[-1][0]
        ).values_list("expense_id", "year", "month", "amount_eur")
    }
    tax_lookup = {
        (t.year, t.month): (t.tvsh or Decimal("0")) + (t.tatim_ne_fitim or Decimal("0"))
        for t in MonthlyTax.objects.filter(year__gte=months[0][0], year__lte=months[-1][0])
    }

    month_rows = []
    expense_totals = defaultdict(lambda: Decimal("0.00"))
    expense_months = defaultdict(int)
    category_totals = defaultdict(lambda: Decimal("0.00"))

    for year, month in months:
        total = Decimal("0.00")
        paid = Decimal("0.00")
        by_category = defaultdict(lambda: Decimal("0.00"))
        for expense in expenses:
            if not is_active_for_month(expense, year, month):
                continue
            amount = expense.amount_eur
            total += amount
            by_category[str(expense.category_id)] += amount
            expense_totals[expense.id] += amount
            expense_months[expense.id] += 1
            category_totals[str(expense.category_id)] += amount
            paid += paid_lookup.get((expense.id, year, month), Decimal("0.00"))
        month_rows.append({
            "year": year,
            "month": month,
            "totalEur": str(total),
            "paidEur": str(paid),
            # Never negative: an overpaid month (amount later reduced) reads as
            # fully settled rather than a negative outstanding balance.
            "unpaidEur": str(max(total - paid, Decimal("0.00"))),
            "taxesEur": str(tax_lookup.get((year, month), Decimal("0.00"))),
            "byCategory": {cat_id: str(amount) for cat_id, amount in by_category.items()},
        })

    categories = {str(c.id): c for c in ExpenseCategory.objects.all()}

    def expense_entry(expense):
        return {
            "id": str(expense.id),
            "name": expense.name,
            "vendor": expense.vendor or "",
            "frequency": expense.frequency,
            "categoryId": str(expense.category_id),
            "categoryName": expense.category.name,
            "categoryColor": expense.category.color or "#6b7280",
            "amountEur": str(expense.amount_eur),
            "totalEur": str(expense_totals[expense.id]),
            "monthsActive": expense_months[expense.id],
        }

    active_expenses = [e for e in expenses if expense_totals[e.id] > 0]
    top_expenses = sorted(active_expenses, key=lambda e: expense_totals[e.id], reverse=True)[:12]
    top_recurring = sorted(
        (e for e in active_expenses if e.frequency == FinanceExpense.Frequency.REPEATED),
        key=lambda e: expense_totals[e.id],
        reverse=True,
    )[:12]
    top_categories = sorted(
        (
            {
                "id": cat_id,
                "name": categories[cat_id].name if cat_id in categories else "Unknown",
                "color": (categories[cat_id].color or "#6b7280") if cat_id in categories else "#6b7280",
                "totalEur": str(total),
            }
            for cat_id, total in category_totals.items()
            if total > 0
        ),
        key=lambda row: Decimal(row["totalEur"]),
        reverse=True,
    )

    return JsonResponse({
        "months": month_rows,
        "topExpenses": [expense_entry(e) for e in top_expenses],
        "topRecurring": [expense_entry(e) for e in top_recurring],
        "topCategories": top_categories,
        "categories": [serialize_expense_category(c) for c in categories.values()],
        "start": f"{months[0][0]:04d}-{months[0][1]:02d}",
        "end": f"{months[-1][0]:04d}-{months[-1][1]:02d}",
    })


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
        return JsonResponse({"expense": serialize_finance_expense(expense, request)})

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
