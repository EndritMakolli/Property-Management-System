from datetime import date
from django.utils.timezone import localdate
from django.core.exceptions import ValidationError

from ..models import ExpenseCategory, FinanceExpense, Property
from ._utils import date_value, decimal_value


def apply_reservation_payload(reservation, payload):
    if "guestName" in payload:
        reservation.guest_name = (payload.get("guestName") or "").strip()
    if "guestPhone" in payload:
        reservation.guest_phone = (payload.get("guestPhone") or "").strip()
    if "propertyId" in payload:
        new_property = Property.objects.get(pk=payload.get("propertyId"))
        # Moving a channel-imported booking to another apartment pins it: a later
        # sync must keep it here and must not re-block the original apartment.
        if (
            reservation.pk
            and reservation.external_uid
            and reservation.property_id
            and str(reservation.property_id) != str(new_property.id)
        ):
            reservation.pinned_property = True
        reservation.property = new_property
    if "checkIn" in payload:
        reservation.check_in = date_value(payload.get("checkIn"), "checkIn")
    if "checkOut" in payload:
        reservation.check_out = date_value(payload.get("checkOut"), "checkOut")
    if "reservationType" in payload:
        reservation.platform = payload.get("reservationType")
    if "paymentDue" in payload:
        reservation.payment_due = date_value(payload.get("paymentDue"), "paymentDue", required=False)
    if "paid" in payload:
        reservation.paid = bool(payload.get("paid"))
    if "notes" in payload:
        reservation.notes = payload.get("notes") or ""
    if "nightlyPrice" in payload:
        reservation.nightly_price_eur = decimal_value(payload.get("nightlyPrice"), "nightlyPrice")
    return reservation


def apply_finance_expense_payload(expense, payload):
    if "name" in payload:
        expense.name = (payload.get("name") or "").strip()
    if "categoryId" in payload:
        expense.category = ExpenseCategory.objects.get(pk=payload.get("categoryId"))
    if "amountEur" in payload:
        expense.amount_eur = decimal_value(payload.get("amountEur"), "amountEur")
    if "frequency" in payload:
        expense.frequency = payload.get("frequency") or FinanceExpense.Frequency.ONE_TIME
    if "startYear" in payload:
        expense.start_year = int(payload.get("startYear"))
    if "startMonth" in payload:
        expense.start_month = int(payload.get("startMonth"))
    if "endYear" in payload:
        expense.end_year = int(payload.get("endYear")) if payload.get("endYear") else None
    if "endMonth" in payload:
        expense.end_month = int(payload.get("endMonth")) if payload.get("endMonth") else None
    if "platform" in payload:
        expense.platform = payload.get("platform") or None
    if "notes" in payload:
        expense.notes = payload.get("notes") or ""

    if not expense.name:
        raise ValidationError({"name": "Enter an expense name."})
    if expense.start_month < 1 or expense.start_month > 12:
        raise ValidationError({"startMonth": "Choose a valid start month."})
    if expense.end_month and (expense.end_month < 1 or expense.end_month > 12):
        raise ValidationError({"endMonth": "Choose a valid end month."})

    return expense


def apply_loan_payload(loan, payload):
    if "name" in payload:
        loan.name = (payload.get("name") or "").strip()
    if "monthlyValueEur" in payload:
        loan.monthly_value_eur = decimal_value(payload.get("monthlyValueEur"), "monthlyValueEur")
    if "startYear" in payload:
        loan.start_year = int(payload.get("startYear"))
    if "startMonth" in payload:
        loan.start_month = int(payload.get("startMonth"))
    if "endYear" in payload:
        loan.end_year = int(payload.get("endYear"))
    if "endMonth" in payload:
        loan.end_month = int(payload.get("endMonth"))
    if "notes" in payload:
        loan.notes = payload.get("notes") or ""

    if not loan.name:
        raise ValidationError({"name": "Enter a loan name."})
    for field_name in ("start_month", "end_month"):
        value = getattr(loan, field_name)
        if value < 1 or value > 12:
            raise ValidationError({field_name: "Choose a valid month."})

    return loan


def apply_obligation_payload(obligation, payload):
    if "companyName" in payload:
        obligation.company_name = (payload.get("companyName") or "").strip()
    if "description" in payload:
        obligation.description = payload.get("description") or ""
    if "amountEur" in payload:
        obligation.amount_eur = decimal_value(payload.get("amountEur"), "amountEur")
    if "dueDate" in payload:
        obligation.due_date = date_value(payload.get("dueDate"), "dueDate", required=False)
    if "paid" in payload:
        obligation.paid = bool(payload.get("paid"))
    if "notes" in payload:
        obligation.notes = payload.get("notes") or ""

    if not obligation.company_name:
        raise ValidationError({"companyName": "Enter a company name."})

    return obligation


def apply_door_code_payload(code, payload, changed_by=""):
    if "newCode" in payload:
        new_code = (payload.get("newCode") or "").strip()
        if new_code != code.new_code:
            code.old_code = code.new_code
            code.new_code = new_code
            code.date_changed = localdate()
            code.changed_by = changed_by
    if "notes" in payload:
        code.notes = payload.get("notes") or ""
    return code


def apply_lockbox_code_payload(code, payload, changed_by=""):
    if "name" in payload:
        code.name = (payload.get("name") or "").strip()
    if "apartmentNumber" in payload:
        code.apartment_number = (payload.get("apartmentNumber") or "").strip()
    if "newCode" in payload:
        new_code = (payload.get("newCode") or "").strip()
        if new_code != code.new_code:
            code.old_code = code.new_code
            code.new_code = new_code
            code.date_changed = localdate()
            code.changed_by = changed_by
    if "notes" in payload:
        code.notes = payload.get("notes") or ""
    return code
