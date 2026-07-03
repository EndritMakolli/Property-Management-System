from django.http import JsonResponse

from ..models import Property, SyncLog
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, is_management, require_roles
from ._serializers import serialize_sync_log


def sync_log_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    property_id = request.GET.get("property")
    logs = SyncLog.objects.select_related("property")
    if is_management(request):
        logs = logs.filter(property__hidden_from_management=False)
    if property_id:
        logs = logs.filter(property_id=property_id)[:100]
    else:
        logs = logs[:200]

    return JsonResponse({"syncLogs": [serialize_sync_log(log) for log in logs]})
