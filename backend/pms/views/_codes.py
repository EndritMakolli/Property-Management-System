from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import DoorCode, LockboxCode, Property
from ._payloads import apply_door_code_payload, apply_lockbox_code_payload
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._serializers import serialize_door_code, serialize_lockbox_code
from ._utils import json_payload


@csrf_exempt
def door_code_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method == "GET":
        properties = Property.objects.filter(active=True).order_by("name")
        coded_ids = set(DoorCode.objects.values_list("property_id", flat=True))
        for prop in properties:
            if prop.id not in coded_ids:
                DoorCode.objects.create(property=prop)
        door_codes = DoorCode.objects.select_related("property").filter(property__active=True)
        return JsonResponse({"doorCodes": [serialize_door_code(item) for item in door_codes]})

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def door_code_detail(request, code_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        door_code = DoorCode.objects.select_related("property").get(pk=code_id)
    except DoorCode.DoesNotExist:
        return JsonResponse({"error": "Door code not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            apply_door_code_payload(door_code, payload, changed_by=request.user.username)
            door_code.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"doorCode": serialize_door_code(door_code)})

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def lockbox_code_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
    if denied:
        return denied

    if request.method == "GET":
        lockbox_codes = LockboxCode.objects.all()
        return JsonResponse({"lockboxCodes": [serialize_lockbox_code(item) for item in lockbox_codes]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            lockbox_code = apply_lockbox_code_payload(LockboxCode(), payload, changed_by=request.user.username)
            lockbox_code.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"lockboxCode": serialize_lockbox_code(lockbox_code)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def lockbox_code_detail(request, code_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        lockbox_code = LockboxCode.objects.get(pk=code_id)
    except LockboxCode.DoesNotExist:
        return JsonResponse({"error": "Lockbox code not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            apply_lockbox_code_payload(lockbox_code, payload, changed_by=request.user.username)
            lockbox_code.save()
        except ValidationError as error:
            return JsonResponse(
                {"error": error.message_dict if hasattr(error, "message_dict") else error.messages},
                status=400,
            )
        return JsonResponse({"lockboxCode": serialize_lockbox_code(lockbox_code)})

    if request.method == "DELETE":
        lockbox_code.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)
