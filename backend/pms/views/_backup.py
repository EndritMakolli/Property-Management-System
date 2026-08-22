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
  • GET  /api/backup/media/export/  → a zip of every uploaded file (photos,
                                client documents, expense invoices, …) with the
                                same relative paths the database records point
                                at, so relationships survive a restore.
  • POST /api/backup/media/import/ → merges a media zip back into storage.
                                Non-destructive: existing files are overwritten
                                by path, nothing else is deleted.
  • GET  /api/backup/archive/export/ → one zip holding backup.json + media/ —
                                a complete portable copy of the platform.
  • POST /api/backup/archive/import/ → full restore: replaces all data (same
                                as the JSON import) and merges the media files.

Implementation notes:
  - Export/import use Django's own `dumpdata` / `loaddata` so the format stays
    compatible with the ORM and foreign keys round-trip by primary key.
  - The wipe deletes dependents before the models they reference (some FKs use
    PROTECT), then `loaddata` re-inserts everything (it disables FK checks while
    loading, so fixture order is not a concern).
  - Media zips store paths relative to MEDIA_ROOT — exactly what FileFields
    store — so a photo stays connected to its apartment and a document to its
    client without any id mapping.
"""

import io
import json
import os
import tempfile
import zipfile
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.contrib.auth.models import Group, User
from django.core.management import call_command
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from ._roles import ROLE_ADMIN, require_roles

# Zip-bomb guards for media/archive imports.
MAX_ARCHIVE_MEMBERS = 20000
MAX_ARCHIVE_UNCOMPRESSED = 4 * 1024 * 1024 * 1024  # 4 GB

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


def _parse_backup_records(raw):
    """Validate a backup payload. Returns (records, error_response)."""
    try:
        records = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    except (ValueError, UnicodeDecodeError):
        return None, JsonResponse({"error": "File is not valid JSON."}, status=400)
    if not isinstance(records, list) or not all(
        isinstance(r, dict) and "model" in r for r in records
    ):
        return None, JsonResponse(
            {"error": "This does not look like a PMS backup file."}, status=400
        )

    # Guard against lockout: the wipe below deletes every user, so a backup
    # without accounts (from an old app version) would leave nobody able to
    # log in.
    if not any(r.get("model") == "auth.user" for r in records):
        return None, JsonResponse(
            {
                "error": (
                    "This backup contains no user accounts — importing it would "
                    "delete every login. Export a fresh backup from the current "
                    "app version (new backups include accounts) and import that."
                )
            },
            status=400,
        )
    return records, None


def _run_data_import(records):
    """Wipe everything and load the validated records. Returns an error string or None."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as tmp:
            json.dump(records, tmp)
            tmp_path = tmp.name

        # Wipe (dependents first), then reload from the file. ignorenonexistent
        # tolerates version skew: fields/models the running code doesn't know
        # (backup from a newer or older app version) are skipped instead of
        # failing the whole import.
        for model in _delete_order(_backup_models()):
            model.objects.all().delete()
        call_command("loaddata", tmp_path, verbosity=0, ignorenonexistent=True)
        # Backups from before monthly pricing carry no monthly_price_eur; heal
        # them so per-period payment tracking works right away.
        from ..management.commands.backfill_monthly_prices import backfill

        backfill()
        # Likewise, backups from before the client directory carry no Guest
        # rows/links — rebuild them so the Clients page stays populated.
        from django.core.management import call_command as _call

        _call("link_guests", verbosity=0)
        # And backups from before a lookup table existed carry no rows for it,
        # so the wipe above emptied it. Reference data is vocabulary, not user
        # data — without it there are no reservation-type colours and every
        # reservation save is rejected as an unknown type.
        from ..reference_data import ensure_reference_data

        ensure_reference_data()
    except Exception as exc:  # noqa: BLE001 — surface any load failure to the client
        return f"Import failed: {exc}"
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
    return None


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
    records, error_response = _parse_backup_records(raw)
    if error_response:
        return error_response

    error = _run_data_import(records)
    if error:
        return JsonResponse({"error": error}, status=400)

    return JsonResponse(
        {
            "ok": True,
            "objectCount": len(records),
            "note": "Data replaced. You may need to log in again.",
        }
    )


# ---------------------------------------------------------------------------
# Media (uploaded files) + full archive
# ---------------------------------------------------------------------------

def _media_root():
    return Path(settings.MEDIA_ROOT)


def _iter_media_files():
    """Yield (absolute_path, relative_posix_path) for every stored upload."""
    root = _media_root()
    if not root.exists():
        return
    for path in sorted(root.rglob("*")):
        if path.is_file():
            yield path, path.relative_to(root).as_posix()


def _write_media_to_zip(archive, prefix=""):
    count = 0
    for absolute, relative in _iter_media_files():
        archive.write(absolute, f"{prefix}{relative}")
        count += 1
    return count


def _safe_media_target(name, strip_prefix=""):
    """Map a zip member to a path inside MEDIA_ROOT, or None to skip it.

    Rejects absolute paths, drive letters and `..` traversal so a crafted zip
    cannot write outside the media directory.
    """
    member = name.replace("\\", "/")
    if strip_prefix:
        if not member.startswith(strip_prefix):
            return None
        member = member[len(strip_prefix):]
    if not member or member.endswith("/"):
        return None
    parts = member.split("/")
    if any(part in ("", "..") for part in parts):
        return None
    if os.path.isabs(member) or (len(member) > 1 and member[1] == ":"):
        return None
    return _media_root() / Path(*parts)


def _check_archive_limits(archive):
    """Reject oversized/zip-bomb archives. Raises ValueError; call before any write."""
    members = archive.infolist()
    if len(members) > MAX_ARCHIVE_MEMBERS:
        raise ValueError("The archive contains too many files.")
    if sum(m.file_size for m in members) > MAX_ARCHIVE_UNCOMPRESSED:
        raise ValueError("The archive is too large to restore.")


def _extract_media_zip(archive, strip_prefix=""):
    """Extract media members into MEDIA_ROOT. Returns (restored, skipped)."""
    _check_archive_limits(archive)
    members = archive.infolist()

    restored = 0
    skipped = 0
    for member in members:
        if member.is_dir():
            continue
        target = _safe_media_target(member.filename, strip_prefix)
        if target is None:
            skipped += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(member) as source, open(target, "wb") as destination:
            while True:
                chunk = source.read(1024 * 512)
                if not chunk:
                    break
                destination.write(chunk)
        restored += 1
    return restored, skipped


def backup_media_export(request):
    """GET — zip of every uploaded file, paths relative to MEDIA_ROOT."""
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        count = _write_media_to_zip(archive)
    if count == 0:
        return JsonResponse({"error": "There are no uploaded files to export yet."}, status=400)

    filename = f"pms-media-{timezone.localdate().isoformat()}.zip"
    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def backup_media_import(request):
    """POST — merge a media zip into storage (overwrites by path, deletes nothing)."""
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    upload = request.FILES.get("file")
    if not upload:
        return JsonResponse({"error": "No media zip provided."}, status=400)

    try:
        with zipfile.ZipFile(upload) as archive:
            # Accept both a plain media zip and a full archive's media/ folder.
            names = archive.namelist()
            prefix = "media/" if names and all(
                n.startswith("media/") or n == "backup.json" for n in names
            ) else ""
            restored, skipped = _extract_media_zip(archive, strip_prefix=prefix)
    except zipfile.BadZipFile:
        return JsonResponse({"error": "This is not a valid zip file."}, status=400)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    return JsonResponse({
        "ok": True,
        "restoredFiles": restored,
        "skippedFiles": skipped,
        "note": "Files were restored into media storage; records keep pointing at them.",
    })


def backup_archive_export(request):
    """GET — one zip with backup.json (all records) + media/ (all files)."""
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    data_buffer = io.StringIO()
    call_command("dumpdata", "pms", *EXTRA_DUMP_LABELS, format="json", indent=2, stdout=data_buffer)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("backup.json", data_buffer.getvalue())
        _write_media_to_zip(archive, prefix="media/")

    filename = f"pms-archive-{timezone.localdate().isoformat()}.zip"
    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def backup_archive_import(request):
    """POST — full restore: replace all records, then merge the media files."""
    denied = require_roles(request, [ROLE_ADMIN])
    if denied:
        return denied
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    upload = request.FILES.get("file")
    if not upload:
        return JsonResponse({"error": "No archive file provided."}, status=400)

    try:
        with zipfile.ZipFile(upload) as archive:
            try:
                raw = archive.read("backup.json")
            except KeyError:
                return JsonResponse(
                    {"error": "The archive has no backup.json — is this a full archive export?"},
                    status=400,
                )

            records, error_response = _parse_backup_records(raw)
            if error_response:
                return error_response

            # Validate the media half BEFORE the wipe — otherwise a bad zip
            # would leave the database replaced but no files restored.
            _check_archive_limits(archive)

            error = _run_data_import(records)
            if error:
                return JsonResponse({"error": error}, status=400)

            restored, skipped = _extract_media_zip(archive, strip_prefix="media/")
    except zipfile.BadZipFile:
        return JsonResponse({"error": "This is not a valid zip file."}, status=400)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)

    return JsonResponse({
        "ok": True,
        "objectCount": len(records),
        "restoredFiles": restored,
        "skippedFiles": skipped,
        "note": "Data and files replaced. You may need to log in again.",
    })
