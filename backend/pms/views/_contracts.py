"""Contract drafts: read them, edit them, and fill one in for a reservation.

The placeholder engine is `render_template` from `_drafts.py`, not a second one.
Two engines would drift, and the operator would have to learn which brackets
mean what on which screen.

Unlike the guest replies, a contract is *printed and signed*, so an unresolved
placeholder is reported back rather than left to be noticed. It is still shown
in the body - a contract with a visible "(guest name)" is obviously wrong,
whereas one silently missing the clause is not.
"""

from django.http import JsonResponse
from django.utils.timezone import localdate

from ..models import (
    CompanyProfile,
    ContractTemplate,
    Property,
    Reservation,
    ReservationContract,
)
from ._drafts import format_stay_date, render_template
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._utils import json_payload

# Fleet rents cars, AirStay rents apartments. The reservation's property knows
# which business it belongs to, so nobody has to pick the right draft by hand.
KIND_FOR_PLATFORM = {
    Property.Platform.FLEET: ContractTemplate.Kind.VEHICLE,
    Property.Platform.AIRSTAY: ContractTemplate.Kind.APARTMENT,
}


def serialize_contract_template(template):
    return {
        "kind": template.kind,
        "label": template.get_kind_display(),
        "bodySq": template.body_sq,
        "bodyEn": template.body_en,
        "updatedAt": template.updated_at.isoformat() if template.updated_at else "",
    }


def contract_template_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    return JsonResponse({
        "templates": [
            serialize_contract_template(row) for row in ContractTemplate.objects.all()
        ]
    })


def contract_template_detail(request, kind):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        template = ContractTemplate.objects.get(kind=kind)
    except ContractTemplate.DoesNotExist:
        return JsonResponse({"error": "Contract template not found."}, status=404)

    if request.method == "GET":
        return JsonResponse({"template": serialize_contract_template(template)})

    if request.method == "PATCH":
        payload = json_payload(request)
        # Only the keys sent: editing the English body must not blank the
        # Albanian one just because the form did not send it.
        if "bodySq" in payload:
            template.body_sq = payload.get("bodySq") or ""
        if "bodyEn" in payload:
            template.body_en = payload.get("bodyEn") or ""
        template.save()
        return JsonResponse({"template": serialize_contract_template(template)})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def contract_values(reservation, language):
    """Everything a contract draft can refer to, for one reservation."""
    company = CompanyProfile.get()
    prop = reservation.property
    guest = reservation.guest

    return {
        # The parties
        "company name": company.name or "",
        "company tax id": company.tax_id or "",
        "company address": ", ".join(
            part for part in [company.address or "", company.city or ""] if part
        ),
        "company city": company.city or "",
        "guest name": (reservation.guest_name or "").strip(),
        "guest phone": (reservation.guest_phone or "").strip(),
        "guest email": (reservation.guest_email or "").strip(),
        # There is no personal ID *number* on the client record - only uploaded
        # ID documents, which are deliberately never exposed outside the
        # role-checked download view. So this stays blank and is written in by
        # hand at the desk. Do not wire it to `id_document_url`: that is a link
        # to a passport scan, and a contract is printed and handed over.
        "guest id number": "",
        "nationality": (getattr(guest, "nationality", "") or "") if guest else "",
        # What is being let
        "apartment": prop.name,
        "apartment address": prop.address or "",
        "apartment floor": prop.floor or "",
        "vehicle": prop.name,
        "registration": prop.licence_plate or "",
        "odometer": str(prop.current_km) if prop.current_km is not None else "",
        "licence number": "",
        # The period and the money
        "check-in": format_stay_date(reservation.check_in, language),
        "check-out": format_stay_date(reservation.check_out, language),
        "nights": str(reservation.nights),
        "guests": str(reservation.guests_count),
        "total price": _money(reservation.total_price_eur),
        "nightly price": _money(reservation.nightly_price_eur),
        "deposit": "",
        "today": format_stay_date(localdate(), language),
    }


def _money(value):
    """245.00 -> 245, 208.25 stays. Prose, not accounting."""
    text = str(value or "0")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def reservation_contract(request, reservation_id):
    """The contract for one reservation.

    GET    - the saved draft if there is one, otherwise rendered fresh from the
             template. A reservation nobody has edited behaves exactly as it
             always did.
    PUT    - save the draft: the terms as edited, plus the few things written
             in by hand at the desk.
    DELETE - throw the draft away and go back to the template. The way out of a
             mess must not be deleting the reservation.
    """
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method not in ("GET", "PUT", "PATCH", "DELETE"):
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        reservation = Reservation.objects.select_related("property", "guest").get(
            pk=reservation_id
        )
    except (Reservation.DoesNotExist, ValueError):
        return JsonResponse({"error": "Reservation not found."}, status=404)

    kind = KIND_FOR_PLATFORM.get(
        reservation.property.platform, ContractTemplate.Kind.APARTMENT
    )
    try:
        template = ContractTemplate.objects.get(kind=kind)
    except ContractTemplate.DoesNotExist:
        return JsonResponse({"error": "No contract draft has been set up yet."}, status=404)

    # Anything that is not Albanian falls back to English rather than returning
    # an empty contract for a language nobody has written.
    language = "sq" if request.GET.get("language") == "sq" else "en"

    draft = ReservationContract.objects.filter(
        reservation=reservation, language=language
    ).first()

    if request.method == "DELETE":
        # Reset to the template. Nothing else is touched - the reservation, the
        # guest and the stay are not the contract's to delete.
        if draft:
            draft.delete()
        return JsonResponse({"ok": True, "isDraft": False})

    if request.method in ("PUT", "PATCH"):
        payload = json_payload(request)
        body_value = payload.get("body", "")
        if not isinstance(body_value, str):
            return JsonResponse({"error": {"body": "The contract terms must be text."}}, status=400)

        draft, _ = ReservationContract.objects.get_or_create(
            reservation=reservation, language=language
        )
        draft.body = body_value
        # Only the keys sent, so saving the terms does not blank an ID number
        # typed in a minute earlier by a form that did not send it.
        for api_key, field in (
            ("clientIdNumber", "client_id_number"),
            ("licenceNumber", "licence_number"),
            ("deposit", "deposit"),
        ):
            if api_key in payload:
                setattr(draft, field, str(payload.get(api_key) or "").strip()[:60])
        draft.updated_by = request.user if request.user.is_authenticated else None
        draft.save()

    body = template.body_sq if language == "sq" else template.body_en
    if not body.strip():
        body = template.body_en or template.body_sq
        language = "en"
        draft = ReservationContract.objects.filter(
            reservation=reservation, language=language
        ).first()

    values = contract_values(reservation, language)
    # The hand-filled fields belong to the draft, not to the guest record:
    # there is no ID number on Guest, and `id_document_url` is a passport scan
    # that a printed contract must never carry.
    if draft:
        values["guest id number"] = draft.client_id_number
        values["licence number"] = draft.licence_number
        values["deposit"] = draft.deposit

    if draft:
        # A saved draft is returned exactly as it was typed. Re-rendering it
        # through the template engine would resolve placeholders the operator
        # deliberately left in, and a draft that quietly refreshes itself has
        # thrown the edit away.
        rendered, unresolved = draft.body, []
    else:
        rendered, unresolved = render_template(body, values)

    company = CompanyProfile.get()
    prop = reservation.property
    is_vehicle = kind == ContractTemplate.Kind.VEHICLE

    # The parties and the stay are returned as data, not as text inside the
    # body: the document lays them out the way an invoice does, so nobody has
    # to retype the company's own address into a template to change a clause.
    return JsonResponse({
        "kind": kind,
        "language": language,
        "body": rendered,
        # Whether this is somebody's edit or a fresh render. The modal says so,
        # because "this has been changed" is the thing you need to know before
        # printing it.
        "isDraft": draft is not None,
        "updatedAt": draft.updated_at.isoformat() if draft else "",
        "updatedBy": draft.updated_by.username if draft and draft.updated_by else "",
        "fields": {
            "licenceNumber": values["licence number"],
            "deposit": values["deposit"],
        },
        # What the operator still has to fill in by hand before signing.
        "unresolved": unresolved,
        "reference": str(reservation.id)[:8].upper(),
        "issuedOn": localdate().isoformat(),
        "company": {
            "name": company.name or "",
            "address": company.address or "",
            "city": company.city or "",
            "country": company.country or "",
            "taxId": company.tax_id or "",
            "vatId": company.vat_id or "",
            "email": company.email or "",
            "phone": company.phone or "",
            "logoUrl": company.logo.url if company.logo else "",
        },
        "client": {
            "name": values["guest name"],
            "phone": values["guest phone"],
            "email": values["guest email"],
            "idNumber": values["guest id number"],
            "nationality": values["nationality"],
        },
        "subject": {
            "isVehicle": is_vehicle,
            "name": prop.name,
            "brand": prop.brand or "",
            "model": prop.model or "",
            "chassisNumber": prop.chassis_number or "",
            "licencePlate": prop.licence_plate or "",
            "allowedCountries": prop.allowed_countries or "",
            "detail": (prop.apartment_type if hasattr(prop, "apartment_type") else "") or "",
            "address": ", ".join(
                part for part in [prop.address or "", prop.floor or ""] if part
            ),
            "checkIn": reservation.check_in.isoformat(),
            "checkOut": reservation.check_out.isoformat(),
            "nights": reservation.nights,
            "guests": reservation.guests_count,
            "totalPriceEur": str(reservation.total_price_eur),
            "nightlyPriceEur": str(reservation.nightly_price_eur),
        },
    })
