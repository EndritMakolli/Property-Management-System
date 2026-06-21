"""
Backup / restore endpoints (admin only).

  • GET  /api/backup/export/  → a single data-only JSON file of every business
                                record (the `pms` app) plus user accounts and
                                role groups, so the whole dataset can be moved
                                to another device.
  • POST /api/backup/import/ → REPLACES all data on this device with an exported
                               file: every record is wiped and the file loaded
                               in its place. Uploaded photos / attachment files
                               are not part of the backup — only the records.

Implementation notes:
  - Export/import use Django's own `dumpdata` / `loaddata` so the format stays
    compatible with the ORM and foreign keys round-trip by primary key.
  - The wipe deletes dependents before the models they reference (some FKs use
    PROTECT), then `loaddata` re-inserts everything (it disables FK checks while
    loading, so fixture order is not a concern).
"""

import io
import json
import os
import tempfile

from django.apps import apps
from django.contrib.auth.models import Group, User
from django.core.management import call_command
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from ._roles import ROLE_ADMIN, require_roles

# Apps / models included in a backup, on top of the whole `pms` app.
EXTRA_DUMP_LABELS = ["auth.User", "auth.Group"]


def _backup_models():
    """Every model a backup covers: the pms app plus auth users & groups."""
    return list(apps.get_app_config("pms").get_models()) + [User, Group]


def _delete_order(models):
    """Order models so each is deleted before any model it references.

    Honours PROTECT foreign keys (which would otherwise block a parent delete)
    by removing dependents first. Cyclic nullable relations are appended last —
    they are SET_NULL, so their delete order does not matter.
    """
    model_set = set(models)
    refs = {}
    for model in models:
        deps = set()
        for field in model._meta.get_fields():
            if (field.many_to_one or field.one_to_one) and getattr(field, "concrete", False):
                related = field.related_model
                if related in model_set and related is not model:
                    deps.add(related)
        refs[model] = deps

    ordered = []
    placed = set()
    while len(placed) < len(models):
        progress = False
        for model in models:
            if model in placed:
                continue
            dependents = [m for m in models if model in refs[m] and m is not model]
            if all(dep in placed for dep in dependents):
                ordered.append(model)
                placed.add(model)
                progress = True
        if not progress:  # cycle — append the rest as-is (all SET_NULL)
            for model in models:
                if model not in placed:
                    ordered.append(model)
                    placed.add(model)
            break
    return ordered


def backup_export(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    buffer = io.StringIO()
    call_command(
        "dumpdata",
        "pms",
        *EXTRA_DUMP_LABELS,
        format="json",
        indent=2,
        stdout=buffer,
    )

    filename = f"pms-backup-{timezone.localdate().isoformat()}.json"
    response = HttpResponse(buffer.getvalue(), content_type="application/json")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def backup_import(request):
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    upload = request.FILES.get("file")
    raw = upload.read() if upload else request.body
    if not raw:
        return JsonResponse({"error": "No backup file provided."}, status=400)

    # Validate before touching the database so a bad file never destroys data.
    try:
        records = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"error": "File is not valid JSON."}, status=400)
    if not isinstance(records, list) or not all(
        isinstance(r, dict) and "model" in r for r in records
    ):
        return JsonResponse(
            {"error": "This does not look like a PMS backup file."}, status=400
        )

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as tmp:
            json.dump(records, tmp)
            tmp_path = tmp.name

        # Wipe (dependents first), then reload from the file.
        for model in _delete_order(_backup_models()):
            model.objects.all().delete()
        call_command("loaddata", tmp_path, verbosity=0)
    except Exception as exc:  # noqa: BLE001 — surface any load failure to the client
        return JsonResponse({"error": f"Import failed: {exc}"}, status=400)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return JsonResponse(
        {
            "ok": True,
            "objectCount": len(records),
            "note": "Data replaced. You may need to log in again.",
        }
    )
