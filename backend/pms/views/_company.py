"""Company profile (singleton): identity, tax/bank details, logo and map
location. Shown on invoices and (name/coords only) on the public site."""

from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.http import JsonResponse

from ..models import CompanyProfile
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles, user_role
from ._utils import json_payload

TEXT_FIELDS = {
    "name": "name",
    "address": "address",
    "city": "city",
    "country": "country",
    "taxId": "tax_id",
    "vatId": "vat_id",
    "email": "email",
    "phone": "phone",
    "website": "website",
    "bankName": "bank_name",
    "iban": "iban",
    "swift": "swift",
    "bankName2": "bank_name2",
    "iban2": "iban2",
    "swift2": "swift2",
}


def coord_value(raw, field, low, high):
    if raw in (None, ""):
        return None
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise ValidationError({field: "Enter a valid coordinate."})
    if value < low or value > high:
        raise ValidationError({field: f"Coordinate must be between {low} and {high}."})
    return value


def serialize_company_profile(profile, request):
    return {
        "name": profile.name,
        "address": profile.address,
        "city": profile.city,
        "country": profile.country,
        "taxId": profile.tax_id,
        "vatId": profile.vat_id,
        "email": profile.email,
        "phone": profile.phone,
        "website": profile.website,
        "logoUrl": request.build_absolute_uri(profile.logo.url) if profile.logo else "",
        "bankName": profile.bank_name,
        "iban": profile.iban,
        "swift": profile.swift,
        "bankName2": profile.bank_name2,
        "iban2": profile.iban2,
        "swift2": profile.swift2,
        "latitude": str(profile.latitude) if profile.latitude is not None else "",
        "longitude": str(profile.longitude) if profile.longitude is not None else "",
        "defaultTaxRate": str(profile.default_tax_rate),
    }


def apply_company_payload(profile, payload):
    for api_key, field in TEXT_FIELDS.items():
        if api_key in payload:
            setattr(profile, field, (payload.get(api_key) or "").strip())
    if "latitude" in payload:
        profile.latitude = coord_value(payload.get("latitude"), "latitude", Decimal("-90"), Decimal("90"))
    if "longitude" in payload:
        profile.longitude = coord_value(payload.get("longitude"), "longitude", Decimal("-180"), Decimal("180"))
    if "defaultTaxRate" in payload:
        raw = payload.get("defaultTaxRate")
        if raw not in (None, ""):
            try:
                profile.default_tax_rate = Decimal(str(raw))
            except (InvalidOperation, ValueError):
                raise ValidationError({"defaultTaxRate": "Enter a valid tax rate."})
    return profile


def company_profile(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    profile = CompanyProfile.get()

    if request.method == "GET":
        return JsonResponse({"company": serialize_company_profile(profile, request)})

    # Writes are admin-only.
    if user_role(request.user) != ROLE_ADMIN:
        return JsonResponse({"error": "Only an admin can edit the company profile."}, status=403)

    if request.method == "POST":
        # Multipart: text fields + optional logo upload / removal. Use Django's
        # native parsing — the CSRF middleware has already consumed the POST
        # body, so a manual MultiPartParser here would silently read nothing.
        try:
            payload = request.POST
            profile = apply_company_payload(profile, payload)
            if request.FILES.get("logo"):
                profile.logo = request.FILES["logo"]
            elif payload.get("removeLogo") in ("1", "true", "True"):
                profile.logo = None
            profile.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"company": serialize_company_profile(profile, request)})

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            profile = apply_company_payload(profile, payload)
            profile.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"company": serialize_company_profile(profile, request)})

    return JsonResponse({"error": "Method not allowed."}, status=405)
