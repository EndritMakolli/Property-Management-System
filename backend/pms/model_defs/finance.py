import uuid
from builtins import property as builtin_property
from decimal import Decimal

from django.db import models

from .base import TimeStampedModel
from .properties import Property


# `Expense` was removed in migration 0063: zero rows, queried by no view, and
# superseded by `FinanceExpense` below - which is what `ExpensePayment`
# actually points at. Two near-identically named models where only one works
# is how a write eventually lands in the wrong table.


class ExpenseCategory(TimeStampedModel):
    name = models.CharField(max_length=120, unique=True)
    color = models.CharField(max_length=20, blank=True, default="#6b7280")

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "Expense categories"

    def __str__(self):
        return self.name


class FinanceExpense(TimeStampedModel):
    class Frequency(models.TextChoices):
        ONE_TIME = "one_time", "One time"
        REPEATED = "repeated", "Repeated"

    class Platform(models.TextChoices):
        AIRSTAY = "airstay", "AirStay"
        FLEET = "fleet", "Fleet"

    name = models.CharField(max_length=255)
    category = models.ForeignKey(
        ExpenseCategory, on_delete=models.PROTECT, related_name="finance_expenses"
    )
    amount_eur = models.DecimalField(max_digits=10, decimal_places=2)
    frequency = models.CharField(
        max_length=20, choices=Frequency.choices, default=Frequency.ONE_TIME
    )
    start_year = models.PositiveIntegerField()
    start_month = models.PositiveIntegerField()
    end_year = models.PositiveIntegerField(blank=True, null=True)
    end_month = models.PositiveIntegerField(blank=True, null=True)
    platform = models.CharField(
        max_length=20,
        choices=Platform.choices,
        blank=True,
        null=True,
        default=None,
    )
    notes = models.TextField(blank=True)
    # LEGACY payment flag — superseded by per-month ExpensePayment rows so a
    # repeated expense can be paid in July and still show unpaid in August.
    # Kept for backward-compatible backups; not written by the UI anymore.
    paid = models.BooleanField(default=False)
    vendor = models.CharField(max_length=255, blank=True, default="")
    invoice_date = models.DateField(null=True, blank=True)
    invoice_file = models.FileField(upload_to="expenses/", null=True, blank=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["frequency", "start_year", "start_month"]),
            models.Index(fields=["category", "start_year", "start_month"]),
        ]

    def __str__(self):
        return f"{self.name} - EUR {self.amount_eur}"


class ExpensePayment(TimeStampedModel):
    """One paid month of an expense.

    A one-time expense has at most one payment (its start month); a repeated
    expense gets one row per month it was paid, so history is preserved and a
    new month starts unpaid automatically.
    """

    expense = models.ForeignKey(
        FinanceExpense, on_delete=models.CASCADE, related_name="payments"
    )
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    # Snapshot of the expense amount when it was paid, so later edits to the
    # expense don't rewrite payment history.
    amount_eur = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        ordering = ["year", "month"]
        constraints = [
            models.UniqueConstraint(
                fields=["expense", "year", "month"], name="unique_expense_payment_month"
            ),
        ]
        indexes = [
            models.Index(fields=["year", "month"]),
        ]

    def __str__(self):
        return f"{self.expense.name} — {self.year}-{self.month:02d} paid"


class Loan(TimeStampedModel):
    name = models.CharField(max_length=255)
    monthly_value_eur = models.DecimalField(max_digits=10, decimal_places=2)
    start_year = models.PositiveIntegerField()
    start_month = models.PositiveIntegerField()
    end_year = models.PositiveIntegerField()
    end_month = models.PositiveIntegerField()
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["start_year", "start_month", "end_year", "end_month"]),
        ]

    def __str__(self):
        return f"{self.name} - EUR {self.monthly_value_eur}/month"


class FinancialObligation(TimeStampedModel):
    company_name = models.CharField(max_length=255)
    description = models.CharField(max_length=255, blank=True)
    amount_eur = models.DecimalField(max_digits=10, decimal_places=2)
    due_date = models.DateField(blank=True, null=True)
    paid = models.BooleanField(default=False)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["paid", "due_date", "company_name"]
        indexes = [
            models.Index(fields=["paid", "due_date"]),
        ]

    def __str__(self):
        return f"{self.company_name} - EUR {self.amount_eur}"
