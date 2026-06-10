from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import Property, SyncLog
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_sync_log


@csrf_exempt
def sync_log_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    property_id = request.GET.get("property")
    logs = SyncLog.objects.select_related("property").all()[:200]
    if property_id:
        logs = SyncLog.objects.select_related("property").filter(property_id=property_id)[:100]

    return JsonResponse({"syncLogs": [serialize_sync_log(log) for log in logs]})
