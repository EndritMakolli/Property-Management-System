"""Expense invoice upload + AI extraction.

  • POST/DELETE /api/finance/expenses/<id>/invoice/  — attach or remove the
    supplier-invoice file on an expense.
  • GET  /api/finance/expenses/extract/  — {"enabled": bool} feature probe.
  • POST /api/finance/expenses/extract/  — upload an invoice image/PDF; Claude
    reads it and returns {vendor, name, amount, date, category…} so the expense
    form can be prefilled. The file is NOT stored here — the frontend re-sends
    it to the attach endpoint once the user confirms the expense.
"""

import base64
import json

from django.conf import settings
from django.http import JsonResponse

from ..models import ExpenseCategory, FinanceExpense
from ._roles import ROLE_ADMIN, require_roles
from ._serializers import serialize_finance_expense
from ._utils import throttle

ALLOWED_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
}

MAX_FILE_BYTES = 10 * 1024 * 1024  # matches Django's upload cap

EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "vendor": {"type": "string", "description": "The supplier/company that issued the invoice"},
        "name": {"type": "string", "description": "Short expense label, e.g. 'KEDS electricity March'"},
        "amount": {"type": "string", "description": "Grand total including VAT, as a plain decimal string"},
        "currency": {"type": "string", "description": "3-letter currency code, e.g. EUR"},
        "invoiceDate": {"type": "string", "description": "Invoice date as YYYY-MM-DD, or empty if unreadable"},
        "suggestedCategory": {"type": "string", "description": "One of the provided category names, or empty"},
        "notes": {"type": "string", "description": "Anything notable: invoice number, due date, period covered"},
    },
    "required": ["vendor", "name", "amount", "currency", "invoiceDate", "suggestedCategory", "notes"],
    "additionalProperties": False,
}


def _extraction_prompt(category_names):
    categories = ", ".join(category_names) if category_names else "(none defined yet)"
    return (
        "Extract the key fields from this supplier invoice or receipt.\n"
        "Business context: Kosovo — amounts are usually EUR and dates are often "
        "written DD.MM.YYYY; normalize dates to YYYY-MM-DD.\n"
        f"Existing expense categories: {categories}. Pick the closest one as "
        "suggestedCategory, or leave it empty if none fits.\n"
        "amount = the grand total including VAT. name = a short expense label "
        "like 'KEDS electricity March 2026'. If a field is unreadable, use an "
        "empty string — never invent values."
    )


def _validate_upload(upload):
    if not upload:
        return "Attach an invoice file (image or PDF)."
    if upload.size > MAX_FILE_BYTES:
        return "The file is larger than 10 MB — scan it at a lower resolution."
    content_type = (upload.content_type or "").lower()
    if content_type not in ALLOWED_TYPES:
        return "Upload an image (JPG/PNG/WebP/GIF) or a PDF."
    return None


def expense_invoice(request, expense_id):
    """Attach or remove the invoice file on an expense."""
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    try:
        expense = FinanceExpense.objects.select_related("category").get(pk=expense_id)
    except FinanceExpense.DoesNotExist:
        return JsonResponse({"error": "Expense not found."}, status=404)

    if request.method == "POST":
        upload = request.FILES.get("file")
        error = _validate_upload(upload)
        if error:
            return JsonResponse({"error": error}, status=400)
        expense.invoice_file = upload
        expense.save(update_fields=["invoice_file", "updated_at"])
        return JsonResponse({"expense": serialize_finance_expense(expense, request)})

    if request.method == "DELETE":
        if expense.invoice_file:
            expense.invoice_file.delete(save=False)
            expense.invoice_file = None
            expense.save(update_fields=["invoice_file", "updated_at"])
        return JsonResponse({"expense": serialize_finance_expense(expense, request)})

    return JsonResponse({"error": "Method not allowed."}, status=405)


@throttle("10/m", methods=("POST",))
def expense_extract(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    enabled = bool(getattr(settings, "ANTHROPIC_API_KEY", ""))

    if request.method == "GET":
        return JsonResponse({"enabled": enabled})

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    if not enabled:
        return JsonResponse(
            {"error": "AI extraction is not configured (set ANTHROPIC_API_KEY in backend/.env)."},
            status=503,
        )

    upload = request.FILES.get("file")
    error = _validate_upload(upload)
    if error:
        return JsonResponse({"error": error}, status=400)

    content_type = (upload.content_type or "").lower()
    data = base64.standard_b64encode(upload.read()).decode("utf-8")
    if content_type == "application/pdf":
        file_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": data},
        }
    else:
        file_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": content_type, "data": data},
        }

    categories = list(ExpenseCategory.objects.values_list("name", flat=True))

    import anthropic

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    try:
        response = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=1024,
            output_config={"format": {"type": "json_schema", "schema": EXTRACT_SCHEMA}},
            messages=[
                {
                    "role": "user",
                    "content": [file_block, {"type": "text", "text": _extraction_prompt(categories)}],
                }
            ],
        )
    except anthropic.APIStatusError as error:
        return JsonResponse(
            {"error": f"The AI service rejected the request ({error.status_code}). Fill the form manually."},
            status=502,
        )
    except anthropic.APIConnectionError:
        return JsonResponse(
            {"error": "Could not reach the AI service. Check the internet connection and try again."},
            status=502,
        )

    if response.stop_reason == "refusal":
        return JsonResponse(
            {"error": "The AI could not process this document. Fill the form manually."},
            status=422,
        )

    text = next((block.text for block in response.content if block.type == "text"), "")
    try:
        extracted = json.loads(text)
    except (ValueError, TypeError):
        return JsonResponse(
            {"error": "Could not read this document — fill the form manually."},
            status=422,
        )

    # Map the suggested category name back to an id the form can select.
    suggested = (extracted.get("suggestedCategory") or "").strip()
    category_id = ""
    if suggested:
        match = ExpenseCategory.objects.filter(name__iexact=suggested).first()
        if match:
            category_id = str(match.id)
            suggested = match.name

    return JsonResponse(
        {
            "extracted": {
                "vendor": extracted.get("vendor") or "",
                "name": extracted.get("name") or "",
                "amountEur": extracted.get("amount") or "",
                "currency": extracted.get("currency") or "EUR",
                "invoiceDate": extracted.get("invoiceDate") or "",
                "categoryId": category_id,
                "categoryName": suggested,
                "notes": extracted.get("notes") or "",
            }
        }
    )
