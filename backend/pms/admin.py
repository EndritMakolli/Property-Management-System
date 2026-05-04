from django.contrib import admin

from .models import (
    ClaudeTask,
    Expense,
    ExpenseCategory,
    FinanceExpense,
    FinancialObligation,
    FinancialReport,
    Guest,
    GuestStay,
    Inquiry,
    Property,
    Reservation,
    Loan,
)


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "bedrooms",
        "base_price_eur",
        "photo",
        "active",
    )
    fields = (
        "name",
        "bedrooms",
        "base_price_eur",
        "photo",
        "active",
    )
    list_filter = ("active", "bedrooms")
    search_fields = ("name",)


@admin.register(Guest)
class GuestAdmin(admin.ModelAdmin):
    list_display = ("full_name", "email", "phone", "nationality", "is_returning", "created_at")
    list_filter = ("is_returning", "nationality")
    search_fields = ("first_name", "last_name", "email", "phone", "whatsapp_number")
    readonly_fields = ("created_at", "updated_at", "total_stays", "total_nights", "total_paid_eur")


@admin.register(Reservation)
class ReservationAdmin(admin.ModelAdmin):
    list_display = (
        "property",
        "guest_name",
        "guest_phone",
        "check_in",
        "check_out",
        "nights",
        "platform",
        "paid",
        "payment_due",
        "total_price_eur",
        "nightly_price_eur",
        "platform_commission_eur",
        "net_revenue_eur",
    )
    fields = (
        "property",
        "guest_name",
        "guest_phone",
        "check_in",
        "check_out",
        "nights",
        "platform",
        "paid",
        "payment_due",
        "nightly_price_eur",
        "total_price_eur",
        "platform_commission_eur",
        "net_revenue_eur",
        "notes",
    )
    list_filter = ("platform", "paid", "property")
    search_fields = (
        "guest_name",
        "guest_phone",
        "property__name",
        "platform_reservation_id",
        "external_uid",
    )
    readonly_fields = (
        "nights",
        "total_price_eur",
        "platform_commission_eur",
        "net_revenue_eur",
        "created_at",
        "updated_at",
    )
    date_hierarchy = "check_in"


@admin.register(GuestStay)
class GuestStayAdmin(admin.ModelAdmin):
    list_display = ("guest", "property", "check_in", "check_out", "nights", "amount_paid_eur", "platform")
    list_filter = ("platform", "property")
    search_fields = ("guest__first_name", "guest__last_name", "property__name")
    date_hierarchy = "check_in"


@admin.register(Inquiry)
class InquiryAdmin(admin.ModelAdmin):
    list_display = ("guest", "property", "platform", "status", "check_in_requested", "check_out_requested", "created_at")
    list_filter = ("platform", "status", "property")
    search_fields = ("content", "guest__first_name", "guest__last_name", "property__name")
    date_hierarchy = "created_at"


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ("description", "property", "category", "amount_eur", "date", "recurring", "recurrence_frequency")
    list_filter = ("category", "recurring", "recurrence_frequency", "property")
    search_fields = ("description", "property__name")
    date_hierarchy = "date"


@admin.register(FinancialReport)
class FinancialReportAdmin(admin.ModelAdmin):
    list_display = (
        "property",
        "period_start",
        "period_end",
        "total_revenue_eur",
        "total_expenses_eur",
        "net_profit_eur",
        "occupancy_rate",
    )
    list_filter = ("property",)
    date_hierarchy = "period_start"


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "created_at")
    search_fields = ("name",)


@admin.register(FinanceExpense)
class FinanceExpenseAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "category",
        "amount_eur",
        "frequency",
        "start_month",
        "start_year",
        "end_month",
        "end_year",
    )
    list_filter = ("frequency", "category", "start_year")
    search_fields = ("name", "notes")


@admin.register(Loan)
class LoanAdmin(admin.ModelAdmin):
    list_display = ("name", "monthly_value_eur", "start_month", "start_year", "end_month", "end_year")
    search_fields = ("name", "notes")


@admin.register(FinancialObligation)
class FinancialObligationAdmin(admin.ModelAdmin):
    list_display = ("company_name", "description", "amount_eur", "due_date", "paid")
    list_filter = ("paid",)
    search_fields = ("company_name", "description", "notes")


@admin.register(ClaudeTask)
class ClaudeTaskAdmin(admin.ModelAdmin):
    list_display = ("task_type", "status", "triggered_by", "created_at", "completed_at")
    list_filter = ("task_type", "status", "triggered_by")
    search_fields = ("error_message",)
    readonly_fields = ("created_at", "updated_at", "completed_at")
