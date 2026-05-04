from django.urls import path

from . import views

urlpatterns = [
    path("auth/me/", views.auth_me, name="auth-me"),
    path("auth/login/", views.auth_login, name="auth-login"),
    path("auth/logout/", views.auth_logout, name="auth-logout"),
    path("users/", views.user_list, name="user-list"),
    path("users/<int:user_id>/", views.user_detail, name="user-detail"),
    path("properties/", views.property_list, name="property-list"),
    path("properties/<uuid:property_id>/", views.property_detail, name="property-detail"),
    path("properties/<uuid:property_id>/sync/", views.property_sync, name="property-sync"),
    path("properties/<uuid:property_id>/calendar.ics", views.property_calendar_export, name="property-calendar-export"),
    path("calendars/<uuid:export_token>.ics", views.public_property_calendar_export, name="public-property-calendar-export"),
    path("reservations/", views.reservation_list, name="reservation-list"),
    path("reservations/<uuid:reservation_id>/", views.reservation_detail, name="reservation-detail"),
    path("codes/door/", views.door_code_list, name="door-code-list"),
    path("codes/door/<uuid:code_id>/", views.door_code_detail, name="door-code-detail"),
    path("codes/lockboxes/", views.lockbox_code_list, name="lockbox-code-list"),
    path("codes/lockboxes/<uuid:code_id>/", views.lockbox_code_detail, name="lockbox-code-detail"),
    path("finance/summary/", views.finance_summary, name="finance-summary"),
    path("finance/categories/", views.expense_category_list, name="expense-category-list"),
    path("finance/expenses/", views.finance_expense_list, name="finance-expense-list"),
    path("finance/expenses/<uuid:expense_id>/", views.finance_expense_detail, name="finance-expense-detail"),
    path("finance/loans/", views.loan_list, name="loan-list"),
    path("finance/loans/<uuid:loan_id>/", views.loan_detail, name="loan-detail"),
    path("finance/obligations/", views.obligation_list, name="obligation-list"),
    path("finance/obligations/<uuid:obligation_id>/", views.obligation_detail, name="obligation-detail"),
]
