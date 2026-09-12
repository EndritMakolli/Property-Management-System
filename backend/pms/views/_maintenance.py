
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.http import JsonResponse

from ..models import ApartmentCleanStatus, MaintenanceIssue, MaintenancePhoto, Property
from ._expense_ai import _validate_upload
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, is_management, require_roles
from ._serializers import serialize_clean_status, serialize_maintenance_issue
from ._utils import json_payload


def maintenance_issue_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method == "GET":
        property_id = request.GET.get("property")
        issues = MaintenanceIssue.objects.select_related(
            "property", "resolved_by"
        ).prefetch_related("photos")
        if is_management(request):
            issues = issues.filter(property__hidden_from_management=False)
        if property_id:
            issues = issues.filter(property_id=property_id)
        # The list answers "what needs doing". A tap that has been fixed is
        # history, and is asked for deliberately with ?resolved=1.
        issues = issues.filter(is_resolved=request.GET.get("resolved") == "1")
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
            # Cleaning staff can reach this endpoint, so validate: an unchecked
            # .html/.svg here would be stored XSS aimed at admins.
            upload_error = _validate_upload(uploaded_file, label="image")
            if upload_error:
                issue.delete()
                return JsonResponse({"error": upload_error}, status=400)
            MaintenancePhoto.objects.create(issue=issue, photo=uploaded_file)

        issue.refresh_from_db()
        return JsonResponse({"issue": serialize_maintenance_issue(issue, request)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def maintenance_issue_detail(request, issue_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    try:
        issue = (
            MaintenanceIssue.objects.select_related("property", "resolved_by")
            .prefetch_related("photos")
            .get(pk=issue_id)
        )
    except MaintenanceIssue.DoesNotExist:
        return JsonResponse({"error": "Issue not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            if "description" in payload:
                issue.description = (payload.get("description") or "").strip()
            if "reporterName" in payload:
                issue.reporter_name = payload.get("reporterName") or ""
            # Only the keys sent: editing the wording of a fixed issue must not
            # quietly reopen it.
            if "isResolved" in payload:
                resolved = bool(payload.get("isResolved"))
                if resolved and not issue.is_resolved:
                    issue.is_resolved = True
                    issue.resolved_at = timezone.now()
                    issue.resolved_by = request.user if request.user.is_authenticated else None
                elif not resolved:
                    # Reopening clears the record rather than leaving a stale
                    # "fixed by" against something that is broken again.
                    issue.is_resolved = False
                    issue.resolved_at = None
                    issue.resolved_by = None
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


def clean_status_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method == "GET":
        properties = Property.objects.filter(active=True).order_by("name")
        if is_management(request):
            properties = properties.filter(hidden_from_management=False)
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
    clean_status.cleaned_at = timezone.now() if is_cleaned else None
    clean_status.cleaned_by = request.user.username if is_cleaned else ""
    clean_status.save()

    return JsonResponse({"cleanStatus": serialize_clean_status(clean_status)})
