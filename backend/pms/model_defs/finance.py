import uuid
from builtins import property as builtin_property
from decimal import Decimal

from django.db import models

from .base import TimeStampedModel
from .properties import Property


class Expense(TimeStampedModel):
    class Category(models.TextChoices):
        CLEANING = "cleaning", "Cleaning"
        MAINTENANCE = "maintenance", "Maintenance"
        UTILITIES = "utilities", "Utilities"
        PLATFORM_FEES = "platform_fees", "Platform Fees"
        INSURANCE = "insurance", "Insurance"
        MORTGAGE = "mortgage", "Mortgage"
        SUPPLIES = "supplies", "Supplies"
        TAX = "tax", "Tax"
        OTHER = "other", "Other"

    class Frequency(models.TextChoices):
        ONE_TIME = "one_time", "One-Time"
        MONTHLY = "monthly", "Monthly"
        YEARLY = "yearly", "Yearly"

    property = models.ForeignKey(
        Property, on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses"
    )
    category = models.CharField(max_length=30, choices=Category.choices)
    description = models.CharField(max_length=255)
    amount_eur = models.DecimalField(max_digits=10, decimal_places=2)
    recurring = models.BooleanField(default=False)
    recurrence_frequency = models.CharField(
        max_length=10, choices=Frequency.choices, blank=True, null=True
    )
    date = models.DateField()
    receipt_url = models.URLField(blank=True, null=True)

    class Meta:
        ordering = ["-date"]
        indexes = [
            models.Index(fields=["property", "date"]),
            models.Index(fields=["category", "date"]),
            models.Index(fields=["recurring", "recurrence_frequency"]),
        ]

    def __str__(self):
        prop = self.property.name if self.property else "Global"
        return f"{prop} - {self.category} - EUR {self.amount_eur} ({self.date})"

    @builtin_property
    def is_global(self):
        return self.property is None


class FinancialReport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(
        Property, on_delete=models.SET_NULL, null=True, blank=True, related_name="financial_reports"
    )
    period_start = models.DateField()
    period_end = models.DateField()
    total_revenue_eur = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    total_expenses_eur = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    net_profit_eur = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    occupancy_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    avg_nightly_rate_eur = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    total_nights_booked = models.PositiveIntegerField(default=0)
    total_nights_free = models.PositiveIntegerField(default=0)
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-period_start"]
        indexes = [
            models.Index(fields=["property", "period_start", "period_end"]),
        ]

    def __str__(self):
        prop = self.property.name if self.property else "All Properties"
        return f"{prop} - {self.period_start} to {self.period_end}"

    def save(self, *args, **kwargs):
        self.net_profit_eur = self.total_revenue_eur - self.total_expenses_eur
        super().save(*args, **kwargs)


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

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["frequency", "start_year", "start_month"]),
            models.Index(fields=["category", "start_year", "start_month"]),
        ]

    def __str__(self):
        return f"{self.name} - EUR {self.amount_eur}"


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
