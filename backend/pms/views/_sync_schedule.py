"""The scheduling half of calendar sync: what is due, and who may run it.

Kept apart from `_ical.py`, which decides what a feed *means*. This decides
only when to go and fetch one, and refuses to let two goes overlap.

Nothing here writes a reservation. That matters: the import is the dangerous
part and it already has its guards (`tests_sync_safety`); this is the part that
must never accidentally start it twice.
"""

from datetime import timedelta

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone

from ..models import ChannelSyncState, Property, SyncRun
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, is_management, require_roles

# A run that has not beaten in this long has died holding the lock. Generous:
# reclaiming a run that is merely slow is exactly the overlap being prevented.
STALE_RUN_AFTER = timedelta(minutes=30)

# How soon a feed that could not be reached is tried again. Doubling per
# failure, from a few minutes, so a channel having a bad five minutes recovers
# quickly and one that is properly down is not hammered.
FIRST_BACKOFF = timedelta(minutes=5)
MAX_BACKOFF = timedelta(hours=4)

CHANNELS = ("airbnb", "booking")


def _url_for(prop, channel):
    return prop.airbnb_ical_url if channel == "airbnb" else prop.booking_ical_url


def start_run(trigger=SyncRun.Trigger.SCHEDULED):
    """Take the lock, or return None because somebody else holds it.

    The check and the insert are one transaction, so two schedulers firing on
    the same minute cannot both decide the coast is clear.
    """
    now = timezone.now()
    with transaction.atomic():
        live = SyncRun.objects.select_for_update().filter(status=SyncRun.Status.RUNNING)
        for run in live:
            if run.heartbeat_at and now - run.heartbeat_at < STALE_RUN_AFTER:
                return None
            # Died with the lock held. Say so rather than silently reusing the
            # row: "stopped responding" is a thing the page should be able to
            # report, and a run that vanishes without trace looks like one that
            # never happened.
            run.status = SyncRun.Status.FAILED
            run.finished_at = now
            run.error_message = "The previous run stopped responding and was taken over."
            run.save(update_fields=["status", "finished_at", "error_message"])

        return SyncRun.objects.create(trigger=trigger)


def beat(run):
    """Say the run is still alive. Called between properties."""
    if run is None:
        return
    SyncRun.objects.filter(pk=run.pk).update(heartbeat_at=timezone.now())


def release_run(run, properties=0, errors=0, error=""):
    """Give the lock back, recording how it went."""
    if run is None:
        return
    SyncRun.objects.filter(pk=run.pk).update(
        status=SyncRun.Status.FAILED if error else SyncRun.Status.COMPLETED,
        finished_at=timezone.now(),
        properties_synced=properties,
        error_count=errors,
        error_message=(error or "")[:500],
    )


def due_channels(now=None):
    """Every (property, channel) whose feed should be fetched now.

    A channel with no recorded state has never been fetched and is due at once.
    """
    now = now or timezone.now()
    states = {
        (state.property_id, state.channel): state
        for state in ChannelSyncState.objects.filter(property__auto_sync_enabled=True)
    }

    due = []
    for prop in Property.objects.filter(active=True, auto_sync_enabled=True).order_by("name"):
        for channel in CHANNELS:
            if not _url_for(prop, channel):
                continue
            state = states.get((prop.id, channel))
            if state is None or state.next_attempt_at is None or state.next_attempt_at <= now:
                due.append((prop, channel))
    return due


def record_attempt(prop, channel, ok, error=""):
    """Write down what happened and when to come back.

    A success waits the apartment's own interval. A failure waits a doubling
    backoff instead - sooner than the interval, because a feed that was
    unreachable for a minute should not leave the calendar a day behind, and
    later than immediately, because a service that is down stays down.
    """
    now = timezone.now()
    state, _ = ChannelSyncState.objects.get_or_create(property=prop, channel=channel)

    state.last_attempt_at = now
    if ok:
        state.last_success_at = now
        state.consecutive_failures = 0
        state.last_error = ""
        interval = timedelta(hours=max(prop.sync_interval_hours or 24, 1))
        state.next_attempt_at = now + interval
    else:
        state.consecutive_failures += 1
        state.last_error = (error or "")[:500]
        # 5, 10, 20, 40 minutes … capped. Shifting rather than multiplying
        # keeps a long outage from overflowing into a timedelta nothing can
        # represent.
        step = min(state.consecutive_failures - 1, 12)
        backoff = min(FIRST_BACKOFF * (2**step), MAX_BACKOFF)
        state.next_attempt_at = now + backoff

    state.save()
    return state


def current_run():
    """The run in progress, if there is a live one."""
    now = timezone.now()
    run = SyncRun.objects.filter(status=SyncRun.Status.RUNNING).first()
    if run and run.heartbeat_at and now - run.heartbeat_at >= STALE_RUN_AFTER:
        return None
    return run


# ── The API surface ──────────────────────────────────────────────────────────
#
# Kept in this module rather than `_sync_log.py` because it reports on the
# schedule, not on what past runs found.


def _serialize_state(state):
    return {
        "propertyId": str(state.property_id),
        "propertyName": state.property.name,
        "channel": state.channel,
        "lastAttemptAt": state.last_attempt_at.isoformat() if state.last_attempt_at else "",
        "lastSuccessAt": state.last_success_at.isoformat() if state.last_success_at else "",
        "nextAttemptAt": state.next_attempt_at.isoformat() if state.next_attempt_at else "",
        "consecutiveFailures": state.consecutive_failures,
        "lastError": state.last_error,
    }


def _serialize_run(run):
    if run is None:
        return None
    return {
        "id": str(run.id),
        "status": run.status,
        "trigger": run.trigger,
        "startedAt": run.started_at.isoformat(),
        "finishedAt": run.finished_at.isoformat() if run.finished_at else "",
        "propertiesSynced": run.properties_synced,
        "errorCount": run.error_count,
        "errorMessage": run.error_message,
    }


def sync_status(request):
    """GET — is a sync running, when did one last finish, what is overdue."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    states = ChannelSyncState.objects.select_related("property")
    if is_management(request):
        states = states.filter(property__hidden_from_management=False)

    recent = SyncRun.objects.all()[:10]

    return JsonResponse({
        "running": _serialize_run(current_run()),
        "recentRuns": [_serialize_run(run) for run in recent],
        "channels": [_serialize_state(state) for state in states.order_by("property__name", "channel")],
        # Enough for the page to say "3 feeds due now" without re-deriving the
        # rule it would then be able to disagree with.
        "dueNow": len(due_channels()),
        "autoSyncProperties": Property.objects.filter(
            active=True, auto_sync_enabled=True
        ).count(),
    })


def sync_run_now(request):
    """POST — run every due feed now, unless a run is already going.

    The same lock the scheduled command takes, so pressing the button while a
    scheduled run is in flight does nothing rather than doubling it up.
    """
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    from django.core.management import call_command

    # Only a report, not a reservation: the command takes the lock itself, and
    # atomically. Taking it here and handing it straight back would leave a gap
    # for a scheduled run to slip into and would then refuse its own caller.
    if current_run() is not None:
        return JsonResponse(
            {"error": "A synchronisation is already running. Wait for it to finish."},
            status=409,
        )

    call_command("sync_calendars")
    return JsonResponse({"ok": True, "running": _serialize_run(current_run())})
