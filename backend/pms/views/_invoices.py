"""Invoices: CRUD, per-year number allocation, and a one-time import of
invoices saved by the old localStorage-only tool."""

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils.timezone import localdate

from ..models import CompanyProfile, Guest, Invoice, Reservation
from ._company import serialize_company_profile
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._utils import date_value, decimal_value, json_payload


def serialize_invoice(invoice):
    return {
        "id": str(invoice.id),
        "number": invoice.number,
        "issueDate": invoice.issue_date.isoformat() if invoice.issue_date else "",
        "dueDate": invoice.due_date.isoformat() if invoice.due_date else "",
        "status": invoice.status,
        "paid": invoice.paid,
        "clientName": invoice.client_name,
        "clientAddress": invoice.client_address,
        "clientCity": invoice.client_city,
        "clientCountry": invoice.client_country,
        "clientTaxId": invoice.client_tax_id,
        "clientVatId": invoice.client_vat_id,
        "clientEmail": invoice.client_email,
        "clientPhone": invoice.client_phone,
        "guestId": str(invoice.guest_id) if invoice.guest_id else "",
        "reservationId": str(invoice.reservation_id) if invoice.reservation_id else "",
        "lineItems": list(invoice.line_items or []),
        "taxRate": str(invoice.tax_rate),
        "pricesIncludeVat": invoice.prices_include_vat,
        "currency": invoice.currency,
        "notes": invoice.notes,
        "companySnapshot": dict(invoice.company_snapshot or {}),
        "createdBy": invoice.created_by,
        "subtotal": str(invoice.subtotal),
        "taxAmount": str(invoice.tax_amount),
        "total": str(invoice.total),
        "createdAt": invoice.created_at.isoformat() if invoice.created_at else "",
        "updatedAt": invoice.updated_at.isoformat() if invoice.updated_at else "",
    }


def clean_line_items(raw):
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValidationError({"lineItems": "Send line items as a list."})
    items = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ValidationError({"lineItems": "Each line item must be an object."})
        description = str(entry.get("description") or "").strip()
        if not description:
            continue
        quantity = str(entry.get("quantity") or "1").strip() or "1"
        unit_price = str(entry.get("unitPrice") or "0").strip() or "0"
        # Validate they parse as numbers.
        decimal_value(quantity, "lineItems.quantity")
        decimal_value(unit_price, "lineItems.unitPrice")
        items.append({"description": description, "quantity": quantity, "unitPrice": unit_price})
    return items


CLIENT_FIELDS = {
    "clientName": "client_name",
    "clientAddress": "client_address",
    "clientCity": "client_city",
    "clientCountry": "client_country",
    "clientTaxId": "client_tax_id",
    "clientVatId": "client_vat_id",
    "clientEmail": "client_email",
    "clientPhone": "client_phone",
}


def apply_invoice_payload(invoice, payload):
    if "number" in payload and (payload.get("number") or "").strip():
        invoice.number = payload["number"].strip()
    if "issueDate" in payload:
        invoice.issue_date = date_value(payload.get("issueDate"), "issueDate")
    if "dueDate" in payload:
        invoice.due_date = date_value(payload.get("dueDate"), "dueDate", required=False)
    if "status" in payload:
        status = payload.get("status") or Invoice.Status.DRAFT
        if status not in Invoice.Status.values:
            raise ValidationError({"status": "Choose draft, finalized or archived."})
        invoice.status = status
    if "paid" in payload:
        invoice.paid = bool(payload.get("paid"))
    for api_key, field in CLIENT_FIELDS.items():
        if api_key in payload:
            setattr(invoice, field, (payload.get(api_key) or "").strip())
    if "guestId" in payload:
        raw = payload.get("guestId")
        invoice.guest = Guest.objects.get(pk=raw) if raw else None
    if "reservationId" in payload:
        raw = payload.get("reservationId")
        invoice.reservation = Reservation.objects.get(pk=raw) if raw else None
    if "lineItems" in payload:
        invoice.line_items = clean_line_items(payload.get("lineItems"))
    if "taxRate" in payload:
        raw = payload.get("taxRate")
        invoice.tax_rate = decimal_value(str(raw), "taxRate") if raw not in (None, "") else 0
    if "pricesIncludeVat" in payload:
        invoice.prices_include_vat = bool(payload.get("pricesIncludeVat"))
    if "currency" in payload:
        invoice.currency = (payload.get("currency") or "EUR").strip().upper()[:3] or "EUR"
    if "notes" in payload:
        invoice.notes = payload.get("notes") or ""
    return invoice


def next_invoice_number(year):
    prefix = f"INV-{year}-"
    count = Invoice.objects.filter(number__startswith=prefix).count()
    return f"{prefix}{count + 1:03d}"


def _create_invoice(payload, request):
    invoice = Invoice(issue_date=localdate())
    apply_invoice_payload(invoice, payload)
    invoice.created_by = request.user.username
    if not invoice.company_snapshot:
        invoice.company_snapshot = serialize_company_profile(CompanyProfile.get(), request)

    year = invoice.issue_date.year if invoice.issue_date else localdate().year
    explicit_number = bool((payload.get("number") or "").strip())
    for attempt in range(2):
        if not explicit_number:
            invoice.number = next_invoice_number(year)
        try:
            with transaction.atomic():
                invoice.save()
            return invoice
        except IntegrityError:
            if explicit_number or attempt == 1:
                raise ValidationError({"number": f"Invoice number '{invoice.number}' already exists."})
    return invoice


def invoice_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        invoices = Invoice.objects.all()
        status = request.GET.get("status")
        if status in Invoice.Status.values:
            invoices = invoices.filter(status=status)
        year = request.GET.get("year")
        if year:
            try:
                invoices = invoices.filter(issue_date__year=int(year))
            except ValueError:
                return JsonResponse({"error": "Choose a valid year."}, status=400)
        search = (request.GET.get("search") or "").strip()
        if search:
            invoices = invoices.filter(Q(number__icontains=search) | Q(client_name__icontains=search))
        return JsonResponse({"invoices": [serialize_invoice(item) for item in invoices]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            invoice = _create_invoice(payload, request)
        except (Guest.DoesNotExist, Reservation.DoesNotExist):
            return JsonResponse({"error": "Linked client or reservation not found."}, status=400)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"invoice": serialize_invoice(invoice)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def invoice_detail(request, invoice_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        invoice = Invoice.objects.get(pk=invoice_id)
    except Invoice.DoesNotExist:
        return JsonResponse({"error": "Invoice not found."}, status=404)

    if request.method == "GET":
        return JsonResponse({"invoice": serialize_invoice(invoice)})

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            invoice = apply_invoice_payload(invoice, payload)
            invoice.save()
        except (Guest.DoesNotExist, Reservation.DoesNotExist):
            return JsonResponse({"error": "Linked client or reservation not found."}, status=400)
        except IntegrityError:
            return JsonResponse({"error": {"number": "That invoice number already exists."}}, status=400)
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"invoice": serialize_invoice(invoice)})

    if request.method == "DELETE":
        invoice.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


def invoice_import(request):
    """One-time import of invoices from the old localStorage tool.

    Accepts {"invoices": [...]} in the old InvoiceRecord shape; duplicates
    (by number) are skipped so re-running is safe.
    """
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    payload = json_payload(request)
    rows = payload.get("invoices")
    if not isinstance(rows, list):
        return JsonResponse({"error": "Send {\"invoices\": [...]}."}, status=400)

    imported = 0
    skipped = 0
    errors = []
    for row in rows:
        if not isinstance(row, dict):
            skipped += 1
            continue
        number = str(row.get("invoiceNumber") or "").strip()
        if not number or Invoice.objects.filter(number=number).exists():
            skipped += 1
            continue
        client = row.get("client") or {}
        old_status = row.get("status") or "draft"
        try:
            invoice = Invoice(
                number=number,
                issue_date=date_value(row.get("issueDate"), "issueDate"),
                due_date=date_value(row.get("dueDate"), "dueDate", required=False),
                status=Invoice.Status.FINALIZED if old_status == "paid" else Invoice.Status.DRAFT,
                paid=old_status == "paid",
                client_name=str(client.get("name") or ""),
                client_address=str(client.get("address") or ""),
                client_city=str(client.get("city") or ""),
                client_country=str(client.get("country") or ""),
                client_tax_id=str(client.get("taxId") or ""),
                client_vat_id=str(client.get("vatId") or ""),
                client_email=str(client.get("email") or ""),
                client_phone=str(client.get("phone") or ""),
                line_items=clean_line_items(row.get("lineItems")),
                tax_rate=decimal_value(str(row.get("taxRate") or "0"), "taxRate"),
                # The old tool added tax on top of line prices — keep those totals.
                prices_include_vat=False,
                currency=str(row.get("currency") or "EUR")[:3].upper(),
                notes=str(row.get("notes") or ""),
                company_snapshot=row.get("company") or {},
                created_by=request.user.username,
            )
            invoice.save()
            imported += 1
        except (ValidationError, IntegrityError) as error:
            skipped += 1
            errors.append(f"{number}: {error}")

    return JsonResponse({"imported": imported, "skipped": skipped, "errors": errors[:10]})
