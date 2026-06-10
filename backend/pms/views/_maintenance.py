from datetime import timezone, datetime

from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import ApartmentCleanStatus, MaintenanceIssue, MaintenancePhoto, Property
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_clean_status, serialize_maintenance_issue
from ._utils import json_payload


@csrf_exempt
def maintenance_issue_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method == "GET":
        property_id = request.GET.get("property")
        issues = MaintenanceIssue.objects.select_related("property").prefetch_related("photos")
        if property_id:
            issues = issues.filter(property_id=property_id)
        return JsonResponse({"issues": [serialize_maintenance_issue(issue, request) for issue in issues]})

    if request.method == "POST":
        if "multipart/form-data" in (request.content_type or "") or request.FILES:
            property_id = request.POST.get("propertyId", "")
            description = (request.POST.get("description") or "").strip()
            reporter_name = (request.POST.get("reporterName") or request.user.username).strip()
        else:
            payload = json_payload(request)
            property_id = payload.get("propertyId", "")
            description = (payload.get("description") or "").strip()
            reporter_name = (payload.get("reporterName") or request.user.username).strip()

        if not description:
            return JsonResponse({"error": "Enter a description."}, status=400)
        try:
            prop = Property.objects.get(pk=property_id)
        except Property.DoesNotExist:
            return JsonResponse({"error": "Property not found."}, status=404)

        issue = MaintenanceIssue.objects.create(
            property=prop,
            description=description,
            reporter_name=reporter_name,
        )

        for uploaded_file in request.FILES.getlist("photos"):
            MaintenancePhoto.objects.create(issue=issue, photo=uploaded_file)

        issue.refresh_from_db()
        return JsonResponse({"issue": serialize_maintenance_issue(issue, request)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def maintenance_issue_detail(request, issue_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    try:
        issue = MaintenanceIssue.objects.select_related("property").prefetch_related("photos").get(pk=issue_id)
    except MaintenanceIssue.DoesNotExist:
        return JsonResponse({"error": "Issue not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            if "description" in payload:
                issue.description = (payload.get("description") or "").strip()
            if "reporterName" in payload:
                issue.reporter_name = payload.get("reporterName") or ""
            issue.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"issue": serialize_maintenance_issue(issue, request)})

    if request.method == "DELETE":
        issue.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def maintenance_photo_delete(request, photo_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        photo = MaintenancePhoto.objects.get(pk=photo_id)
    except MaintenancePhoto.DoesNotExist:
        return JsonResponse({"error": "Photo not found."}, status=404)

    if request.method != "DELETE":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    photo.photo.delete(save=False)
    photo.delete()
    return JsonResponse({"deleted": True})


@csrf_exempt
def clean_status_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method == "GET":
        properties = Property.objects.filter(active=True).order_by("name")
        status_map = {cs.property_id: cs for cs in ApartmentCleanStatus.objects.select_related("property").all()}
        result = []
        for prop in properties:
            if prop.id in status_map:
                result.append(serialize_clean_status(status_map[prop.id]))
            else:
                result.append({
                    "propertyId": str(prop.id),
                    "propertyName": prop.name,
                    "isCleaned": False,
                    "cleanedAt": "",
                    "cleanedBy": "",
                })
        return JsonResponse({"cleanStatuses": result})

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def clean_status_mark(request, property_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        prop = Property.objects.get(pk=property_id, active=True)
    except Property.DoesNotExist:
        return JsonResponse({"error": "Property not found."}, status=404)

    payload = json_payload(request)
    is_cleaned = bool(payload.get("isCleaned", True))

    clean_status, _ = ApartmentCleanStatus.objects.get_or_create(property=prop)
    clean_status.is_cleaned = is_cleaned
    clean_status.cleaned_at = datetime.now(timezone.utc) if is_cleaned else None
    clean_status.cleaned_by = request.user.username if is_cleaned else ""
    clean_status.save()

    return JsonResponse({"cleanStatus": serialize_clean_status(clean_status)})
