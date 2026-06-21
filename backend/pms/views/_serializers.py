from datetime import date

from django.conf import settings

from ..models import Reservation
from ._roles import user_role


def property_apartment_type(prop):
    label = "bedroom" if prop.bedrooms == 1 else "bedrooms"
    return f"{prop.bedrooms} {label}"


def property_sync_status(prop):
    if prop.airbnb_ical_url and prop.booking_ical_url:
        return "connected"
    if prop.airbnb_ical_url or prop.booking_ical_url:
        return "partial"
    return "not_configured"


def serialize_user(user):
    return {
        "id": user.id,
        "username": user.username,
        "role": user_role(user),
        "isAuthenticated": user.is_authenticated,
    }


def serialize_managed_user(user):
    return {
        "id": user.id,
        "username": user.username,
        "role": user_role(user),
        "isActive": user.is_active,
        "isStaff": user.is_staff,
        "isSuperuser": user.is_superuser,
    }


def serialize_property(prop, request):
    photo_url = request.build_absolute_uri(prop.photo.url) if prop.photo else ""
    export_path = f"/api/calendars/{prop.calendar_export_token}.ics"
    public_base_url = getattr(settings, "PUBLIC_BASE_URL", "").rstrip("/")
    return {
        "id": str(prop.id),
        "name": prop.name,
        "bedrooms": prop.bedrooms,
        "beds": prop.beds,
        "bathrooms": prop.bathrooms,
        "floor": prop.floor or "",
        "wifiName": prop.wifi_name or "",
        "wifiPassword": prop.wifi_password or "",
        "apartmentType": property_apartment_type(prop),
        "basePriceEur": str(prop.base_price_eur),
        "photoUrl": photo_url,
        "address": prop.address or "Home in Prishtina, Kosovo",
        "airbnbIcalUrl": prop.airbnb_ical_url or "",
        "bookingIcalUrl": prop.booking_ical_url or "",
        "exportIcalUrl": f"{public_base_url}{export_path}" if public_base_url else request.build_absolute_uri(export_path),
        "syncStatus": property_sync_status(prop),
        "active": prop.active,
        "autoSyncEnabled": prop.auto_sync_enabled,
        "syncIntervalHours": prop.sync_interval_hours,
        "description": prop.description or "",
        "listingActive": prop.listing_active,
        "maxGuests": prop.max_guests or 0,
        "locationLabel": prop.location_label or "",
        "rating": str(prop.rating) if prop.rating is not None else "",
        "reviewCount": prop.review_count,
        "amenityIds": [str(aid) for aid in prop.property_amenities.values_list("amenity_id", flat=True).order_by()],
    }


def serialize_reservation(reservation):
    return {
        "id": str(reservation.id),
        "guestName": reservation.guest_name,
        "guestPhone": reservation.guest_phone,
        "paymentDue": reservation.payment_due.isoformat() if reservation.payment_due else "",
        "paid": reservation.paid,
        "notes": reservation.notes or "",
        "reservationType": reservation.platform,
        "propertyId": str(reservation.property_id),
        "apartment": reservation.property.name,
        "apartmentType": property_apartment_type(reservation.property),
        "checkIn": reservation.check_in.isoformat(),
        "checkOut": reservation.check_out.isoformat(),
        "totalNights": reservation.nights,
        "nightlyPrice": str(reservation.nightly_price_eur),
        "totalPaid": str(reservation.total_price_eur),
        "isArchived": reservation.is_archived,
        "archivedAt": reservation.archived_at.isoformat() if reservation.archived_at else "",
    }


def serialize_door_code(door_code):
    last_checkout = (
        Reservation.objects.filter(
            property=door_code.property,
            check_out__lte=date.today(),
            is_archived=False,
        )
        .order_by("-check_out")
        .values_list("check_out", flat=True)
        .first()
    )
    needs_change = bool(
        last_checkout and (not door_code.date_changed or door_code.date_changed < last_checkout)
    )
    return {
        "id": str(door_code.id),
        "propertyId": str(door_code.property_id),
        "apartmentNumber": door_code.property.name,
        "floor": door_code.property.floor or "",
        "wifiName": door_code.property.wifi_name or "",
        "wifiPassword": door_code.property.wifi_password or "",
        "oldCode": door_code.old_code,
        "newCode": door_code.new_code,
        "dateChanged": door_code.date_changed.isoformat() if door_code.date_changed else "",
        "changedBy": door_code.changed_by or "",
        "notes": door_code.notes,
        "lastCheckout": last_checkout.isoformat() if last_checkout else "",
        "needsChange": needs_change,
    }


def serialize_lockbox_code(lockbox_code):
    return {
        "id": str(lockbox_code.id),
        "name": lockbox_code.name or "",
        "apartmentNumber": lockbox_code.apartment_number,
        "oldCode": lockbox_code.old_code,
        "newCode": lockbox_code.new_code,
        "dateChanged": lockbox_code.date_changed.isoformat() if lockbox_code.date_changed else "",
        "changedBy": lockbox_code.changed_by or "",
        "notes": lockbox_code.notes,
    }


def serialize_expense_category(category):
    return {
        "id": str(category.id),
        "name": category.name,
        "color": category.color or "#6b7280",
    }


def serialize_finance_expense(expense):
    return {
        "id": str(expense.id),
        "name": expense.name,
        "categoryId": str(expense.category_id),
        "categoryName": expense.category.name,
        "categoryColor": expense.category.color or "#6b7280",
        "amountEur": str(expense.amount_eur),
        "frequency": expense.frequency,
        "startYear": expense.start_year,
        "startMonth": expense.start_month,
        "endYear": expense.end_year,
        "endMonth": expense.end_month,
        "platform": expense.platform or "",
        "notes": expense.notes,
    }


def serialize_loan(loan):
    return {
        "id": str(loan.id),
        "name": loan.name,
        "monthlyValueEur": str(loan.monthly_value_eur),
        "startYear": loan.start_year,
        "startMonth": loan.start_month,
        "endYear": loan.end_year,
        "endMonth": loan.end_month,
        "notes": loan.notes,
    }


def serialize_financial_obligation(obligation):
    return {
        "id": str(obligation.id),
        "companyName": obligation.company_name,
        "description": obligation.description,
        "amountEur": str(obligation.amount_eur),
        "dueDate": obligation.due_date.isoformat() if obligation.due_date else "",
        "paid": obligation.paid,
        "notes": obligation.notes,
    }


def serialize_maintenance_issue(issue, request):
    return {
        "id": str(issue.id),
        "propertyId": str(issue.property_id),
        "propertyName": issue.property.name,
        "description": issue.description,
        "reporterName": issue.reporter_name,
        "reportedAt": issue.reported_at.isoformat(),
        "photos": [
            {
                "id": str(photo.id),
                "url": request.build_absolute_uri(photo.photo.url),
            }
            for photo in issue.photos.all()
        ],
    }


def serialize_clean_status(clean_status):
    return {
        "propertyId": str(clean_status.property_id),
        "propertyName": clean_status.property.name,
        "isCleaned": clean_status.is_cleaned,
        "cleanedAt": clean_status.cleaned_at.isoformat() if clean_status.cleaned_at else "",
        "cleanedBy": clean_status.cleaned_by or "",
    }


def serialize_monthly_tax(tax):
    return {
        "id": str(tax.id),
        "year": tax.year,
        "month": tax.month,
        "tvsh": str(tax.tvsh),
        "tatimNeFitim": str(tax.tatim_ne_fitim),
        "notes": tax.notes,
    }


def serialize_sync_log(log):
    return {
        "id": str(log.id),
        "propertyId": str(log.property_id),
        "propertyName": log.property.name,
        "channel": log.channel,
        "status": log.status,
        "importedCount": log.imported_count,
        "updatedCount": log.updated_count,
        "skippedCount": log.skipped_count,
        "conflictCount": log.conflict_count,
        "errorMessage": log.error_message,
        "syncedAt": log.synced_at.isoformat(),
    }


def serialize_reservation_audit(log):
    return {
        "id": str(log.id),
        "reservationId": str(log.reservation_id),
        "changedBy": log.changed_by,
        "changedAt": log.changed_at.isoformat(),
        "fieldName": log.field_name,
        "oldValue": log.old_value,
        "newValue": log.new_value,
    }
