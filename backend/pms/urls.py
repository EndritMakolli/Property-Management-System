from django.urls import path

from . import views

urlpatterns = [
    # Auth
    path("auth/me/", views.auth_me, name="auth-me"),
    path("auth/login/", views.auth_login, name="auth-login"),
    path("auth/logout/", views.auth_logout, name="auth-logout"),

    # Users
    path("users/", views.user_list, name="user-list"),
    path("users/<int:user_id>/", views.user_detail, name="user-detail"),

    # Properties (PMS)
    path("properties/", views.property_list, name="property-list"),
    path("properties/<uuid:property_id>/", views.property_detail, name="property-detail"),
    path("properties/<uuid:property_id>/sync/", views.property_sync, name="property-sync"),
    path("properties/<uuid:property_id>/calendar.ics", views.property_calendar_export, name="property-calendar-export"),
    path("properties/<uuid:property_id>/photos/", views.property_photo_list, name="property-photo-list"),
    path("properties/<uuid:property_id>/photos/reorder/", views.property_photo_reorder, name="property-photo-reorder"),
    path("properties/<uuid:property_id>/photos/<uuid:photo_id>/", views.property_photo_detail, name="property-photo-detail"),
    path("properties/<uuid:property_id>/amenities/", views.property_amenity_update, name="property-amenity-update"),
    path("calendars/<uuid:export_token>.ics", views.public_property_calendar_export, name="public-property-calendar-export"),

    # Reservations (PMS)
    path("reservations/", views.reservation_list, name="reservation-list"),
    path("reservations/<uuid:reservation_id>/", views.reservation_detail, name="reservation-detail"),
    path("reservations/<uuid:reservation_id>/restore/", views.reservation_restore, name="reservation-restore"),
    path("reservations/<uuid:reservation_id>/history/", views.reservation_history, name="reservation-history"),
    path("reservations/<uuid:reservation_id>/attachments/", views.reservation_attachment_list, name="reservation-attachment-list"),
    path("reservations/<uuid:reservation_id>/attachments/<uuid:attachment_id>/", views.reservation_attachment_detail, name="reservation-attachment-detail"),

    # Access Codes
    path("codes/door/", views.door_code_list, name="door-code-list"),
    path("codes/door/<uuid:code_id>/", views.door_code_detail, name="door-code-detail"),
    path("codes/lockboxes/", views.lockbox_code_list, name="lockbox-code-list"),
    path("codes/lockboxes/<uuid:code_id>/", views.lockbox_code_detail, name="lockbox-code-detail"),

    # Finance
    path("finance/summary/", views.finance_summary, name="finance-summary"),
    path("finance/categories/", views.expense_category_list, name="expense-category-list"),
    path("finance/categories/<uuid:category_id>/", views.expense_category_detail, name="expense-category-detail"),
    path("finance/expenses/", views.finance_expense_list, name="finance-expense-list"),
    path("finance/expenses/<uuid:expense_id>/", views.finance_expense_detail, name="finance-expense-detail"),
    path("finance/loans/", views.loan_list, name="loan-list"),
    path("finance/loans/<uuid:loan_id>/", views.loan_detail, name="loan-detail"),
    path("finance/obligations/", views.obligation_list, name="obligation-list"),
    path("finance/obligations/<uuid:obligation_id>/", views.obligation_detail, name="obligation-detail"),
    path("finance/taxes/", views.tax_list, name="tax-list"),
    path("finance/taxes/<uuid:tax_id>/", views.tax_detail, name="tax-detail"),

    # Maintenance
    path("maintenance/", views.maintenance_issue_list, name="maintenance-issue-list"),
    path("maintenance/<uuid:issue_id>/", views.maintenance_issue_detail, name="maintenance-issue-detail"),
    path("maintenance/photos/<uuid:photo_id>/", views.maintenance_photo_delete, name="maintenance-photo-delete"),

    # Clean Status
    path("clean-status/", views.clean_status_list, name="clean-status-list"),
    path("clean-status/<uuid:property_id>/mark/", views.clean_status_mark, name="clean-status-mark"),

    # Sync Logs
    path("sync-logs/", views.sync_log_list, name="sync-log-list"),

    # Receipts
    path("receipts/", views.receipt_monthly_view, name="receipt-monthly-view"),
    path("receipts/day/", views.receipt_day_upsert, name="receipt-day-upsert"),
    path("receipts/day/detail/", views.receipt_day_detail, name="receipt-day-detail"),
    path("receipts/items/", views.receipt_item_list, name="receipt-item-list"),
    path("receipts/items/<uuid:item_id>/", views.receipt_item_detail, name="receipt-item-detail"),
    path("receipts/reservations/", views.receipt_available_reservations, name="receipt-available-reservations"),

    # ---- Booking Engine: Public (no auth) ----
    path("booking/settings/", views.booking_settings, name="booking-settings-public"),
    path("booking/properties/", views.booking_properties, name="booking-properties"),
    path("booking/properties/<uuid:property_id>/", views.booking_property_detail, name="booking-property-detail"),
    path("booking/availability/", views.booking_availability, name="booking-availability"),
    path("booking/calculate/", views.booking_calculate, name="booking-calculate"),
    path("booking/promo-codes/validate/", views.booking_validate_promo, name="booking-validate-promo"),
    path("booking/requests/", views.booking_create_request, name="booking-create-request"),
    path("booking/bookings/", views.booking_create_direct, name="booking-create-direct"),
    path("booking/reservations/<uuid:token>/", views.booking_reservation_detail, name="booking-reservation-detail"),
    path("booking/reservations/<uuid:token>/cancel/", views.booking_cancel, name="booking-cancel"),
    path("booking/reservations/<uuid:token>/change-request/", views.booking_change_request, name="booking-change-request"),

    # ---- Booking Engine: PMS Management (requires auth) ----
    path("booking-requests/", views.booking_request_list, name="booking-request-list"),
    path("booking-requests/<uuid:request_id>/approve/", views.booking_request_approve, name="booking-request-approve"),
    path("booking-requests/<uuid:request_id>/reject/", views.booking_request_reject, name="booking-request-reject"),
    path("pricing-rules/", views.pricing_rule_list, name="pricing-rule-list"),
    path("pricing-rules/<uuid:rule_id>/", views.pricing_rule_detail, name="pricing-rule-detail"),
    path("promo-codes/", views.promo_code_list, name="promo-code-list"),
    path("promo-codes/<uuid:code_id>/", views.promo_code_detail, name="promo-code-detail"),
    path("cancellation-policies/", views.cancellation_policy_list, name="cancellation-policy-list"),
    path("cancellation-policies/<uuid:policy_id>/", views.cancellation_policy_detail, name="cancellation-policy-detail"),
    path("amenities/", views.amenity_list, name="amenity-list"),
    path("amenities/<uuid:amenity_id>/", views.amenity_detail, name="amenity-detail"),
    path("house-rules/", views.house_rule_list, name="house-rule-list"),
    path("house-rules/<uuid:rule_id>/", views.house_rule_detail, name="house-rule-detail"),
    path("booking-settings/", views.booking_settings_pms, name="booking-settings-pms"),
]
