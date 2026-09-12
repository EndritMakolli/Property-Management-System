from django.contrib import admin

from .models import (
    ExpenseCategory,
    FinanceExpense,
    FinancialObligation,
    Guest,
    Property,
    PropertyReview,
    Reservation,
    Loan,
)


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "bedrooms",
        "photo",
        "active",
    )
    fields = (
        "name",
        "bedrooms",
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




@admin.register(PropertyReview)
class PropertyReviewAdmin(admin.ModelAdmin):
    list_display = ("property", "rating", "created_at")
    list_filter = ("rating",)
