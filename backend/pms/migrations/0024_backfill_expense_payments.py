"""Backfill per-month ExpensePayment rows from the legacy FinanceExpense.paid flag.

The old flag carried no month information, so it cannot tell us WHICH months of
a recurring expense were paid. We therefore translate it conservatively:

  * one-time expense, paid=True  → a payment for its single (start) month.
  * repeated expense, paid=True  → a payment for its most recent active month
                                   only (the current month, or its end month if
                                   it already finished).

Marking every month from the start would invent payment history and hide real
arrears, so earlier months are deliberately left unpaid for review.
"""

from datetime import date

from django.db import migrations


def backfill(apps, schema_editor):
    FinanceExpense = apps.get_model("pms", "FinanceExpense")
    ExpensePayment = apps.get_model("pms", "ExpensePayment")

    today = date.today()
    current_period = today.year * 12 + (today.month - 1)

    payments = []
    for expense in FinanceExpense.objects.filter(paid=True):
        start_period = expense.start_year * 12 + (expense.start_month - 1)
        if expense.frequency == "one_time":
            period = start_period
        else:
            period = current_period
            if expense.end_year and expense.end_month:
                period = min(period, expense.end_year * 12 + (expense.end_month - 1))
            # An expense that starts in the future (paid in advance) has no
            # earlier active month — credit its first month instead of dropping
            # the recorded payment.
            period = max(period, start_period)
        payments.append(
            ExpensePayment(
                expense=expense,
                year=period // 12,
                month=period % 12 + 1,
                amount_eur=expense.amount_eur,
            )
        )

    ExpensePayment.objects.bulk_create(payments, ignore_conflicts=True)


def unbackfill(apps, schema_editor):
    # Reverse: drop all payment rows (the legacy paid flags are untouched).
    apps.get_model("pms", "ExpensePayment").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("pms", "0023_bookingsitesettings_map_privacy_radius_m_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill, unbackfill),
    ]
