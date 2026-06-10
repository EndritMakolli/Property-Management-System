from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import MonthlyTax
from ._roles import ROLE_ADMIN, require_roles
from ._serializers import serialize_monthly_tax
from ._utils import decimal_value, json_payload


@csrf_exempt
def tax_list(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    if request.method == "GET":
        year = request.GET.get("year")
        taxes = MonthlyTax.objects.all()
        if year:
            taxes = taxes.filter(year=int(year))
        return JsonResponse({"taxes": [serialize_monthly_tax(t) for t in taxes]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            year = int(payload.get("year") or 0)
            month = int(payload.get("month") or 0)
            if not year or month < 1 or month > 12:
                raise ValidationError({"month": "Choose a valid year and month."})
            tax, _ = MonthlyTax.objects.get_or_create(year=year, month=month)
            tax.tvsh = decimal_value(payload.get("tvsh", "0"), "tvsh")
            tax.tatim_ne_fitim = decimal_value(payload.get("tatimNeFitim", "0"), "tatimNeFitim")
            tax.notes = payload.get("notes") or ""
            tax.save()
        except (ValueError, ValidationError) as error:
            if isinstance(error, ValidationError):
                return JsonResponse(
                    {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                    status=400,
                )
            return JsonResponse({"error": "Invalid data."}, status=400)
        return JsonResponse({"tax": serialize_monthly_tax(tax)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def tax_detail(request, tax_id):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    try:
        tax = MonthlyTax.objects.get(pk=tax_id)
    except MonthlyTax.DoesNotExist:
        return JsonResponse({"error": "Tax record not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            if "tvsh" in payload:
                tax.tvsh = decimal_value(payload.get("tvsh", "0"), "tvsh")
            if "tatimNeFitim" in payload:
                tax.tatim_ne_fitim = decimal_value(payload.get("tatimNeFitim", "0"), "tatimNeFitim")
            if "notes" in payload:
                tax.notes = payload.get("notes") or ""
            tax.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"tax": serialize_monthly_tax(tax)})

    if request.method == "DELETE":
        tax.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)
