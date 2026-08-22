"""Reservation types — the editable vocabulary behind `Reservation.platform`.

Reading is open to every signed-in role: the dashboard a cleaner sees draws
reservation badges, so it needs the colours. Writing is admin-only, because a
colour here is global and a type here is part of the company's vocabulary.

Built-in types can be recoloured and relabelled but never deleted — the app
reasons about `monthly`, `booking` and `maintenance` by name, so deleting one
would break billing rather than merely a swatch.
"""

import re

from django.http import JsonResponse
from django.utils.text import slugify

from ..models import Reservation, ReservationType
from ._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, require_roles
from ._utils import json_payload

# A colour is written straight into a CSS custom property, so it must be a
# literal hex triplet and nothing else.
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def serialize_reservation_type(row):
    return {
        "id": str(row.id),
        "code": row.code,
        "label": row.label,
        "color": row.color,
        "sortOrder": row.sort_order,
        "isBuiltin": row.is_builtin,
        "active": row.active,
    }


def _clean_color(raw):
    """Return a valid colour, or None when the input is not one."""
    color = (raw or "").strip()
    return color if HEX_COLOR.match(color) else None


def reservation_type_list(request):
    if request.method == "GET":
        denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_CLEANING])
        if denied:
            return denied
        rows = ReservationType.objects.all()
        return JsonResponse(
            {"reservationTypes": [serialize_reservation_type(row) for row in rows]}
        )

    if request.method == "POST":
        denied = require_roles(request, [ROLE_ADMIN])
        if denied:
            return denied

        payload = json_payload(request)
        label = (payload.get("label") or "").strip()
        if not label:
            return JsonResponse({"error": "Enter a name for the type."}, status=400)

        color = _clean_color(payload.get("color"))
        if color is None:
            return JsonResponse({"error": "Pick a colour."}, status=400)

        # The code is what lands in Reservation.platform, so it is derived once
        # at creation and then frozen — renaming the label must never move it.
        code = slugify(label)[:20]
        if not code:
            return JsonResponse({"error": "That name has no letters or digits in it."}, status=400)
        if ReservationType.objects.filter(code=code).exists():
            return JsonResponse({"error": f"A type called '{label}' already exists."}, status=400)

        last = ReservationType.objects.order_by("sort_order").last()
        created = ReservationType.objects.create(
            code=code,
            label=label,
            color=color,
            sort_order=(last.sort_order + 1) if last else 0,
            is_builtin=False,
        )
        return JsonResponse({"reservationType": serialize_reservation_type(created)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def reservation_type_detail(request, type_id):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied

    try:
        row = ReservationType.objects.get(pk=type_id)
    except (ReservationType.DoesNotExist, ValueError):
        return JsonResponse({"error": "Reservation type not found."}, status=404)

    if request.method == "PATCH":
        payload = json_payload(request)
        fields = []

        if "label" in payload:
            label = (payload.get("label") or "").strip()
            if not label:
                return JsonResponse({"error": "Enter a name for the type."}, status=400)
            row.label = label
            fields.append("label")

        if "color" in payload:
            color = _clean_color(payload.get("color"))
            if color is None:
                return JsonResponse({"error": "Pick a colour."}, status=400)
            row.color = color
            fields.append("color")

        if "sortOrder" in payload:
            try:
                row.sort_order = int(payload.get("sortOrder"))
            except (TypeError, ValueError):
                return JsonResponse({"error": "sortOrder must be a whole number."}, status=400)
            fields.append("sort_order")

        if "active" in payload:
            if row.is_builtin and not payload.get("active"):
                return JsonResponse(
                    {"error": f"'{row.label}' is built in and cannot be switched off."},
                    status=400,
                )
            row.active = bool(payload.get("active"))
            fields.append("active")

        if fields:
            row.save(update_fields=fields)
        return JsonResponse({"reservationType": serialize_reservation_type(row)})

    if request.method == "DELETE":
        if row.is_builtin:
            return JsonResponse(
                {
                    "error": (
                        f"'{row.label}' is built in — the app reasons about it by name, "
                        "so it can be renamed or recoloured but not removed."
                    )
                },
                status=400,
            )

        in_use = Reservation.objects.filter(platform=row.code).count()
        if in_use:
            return JsonResponse(
                {
                    "error": (
                        f"'{row.label}' is used by {in_use} "
                        f"reservation{'' if in_use == 1 else 's'} and cannot be deleted."
                    )
                },
                status=400,
            )

        row.delete()
        return JsonResponse({"deleted": True})

    return JsonResponse({"error": "Method not allowed."}, status=405)
