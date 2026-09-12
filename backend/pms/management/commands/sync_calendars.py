"""Fetch every calendar feed that is due.

Run it as often as you like - every ten minutes is reasonable. It syncs only
the channels whose own interval has elapsed, and it refuses to start if another
run is still going, so a schedule that fires faster than the work takes cannot
pile two imports onto the same apartment.

    */10 * * * *  cd /srv/pms && ./manage.py sync_calendars

On Windows the same thing is a Task Scheduler action. The web process can also
start a run through POST /api/sync/run/, which takes the same lock.
"""

from urllib.error import URLError

from django.core.management.base import BaseCommand

from pms.models import SyncLog
from pms.views._ical import fetch_ical_events, import_ical_reservations
from pms.views._sync_schedule import beat, due_channels, record_attempt, release_run, start_run


class Command(BaseCommand):
    help = (
        "Run iCal imports for every channel that is due. Takes a database lock, "
        "so two runs can never overlap; retries a failed feed on a backoff "
        "rather than waiting out its whole interval."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Sync every auto-sync property now, ignoring whether it is due.",
        )

    def handle(self, *args, **options):
        run = start_run()
        if run is None:
            # Not an error. A scheduler firing faster than the work takes is
            # the normal case, and the whole point of the lock.
            self.stdout.write("Another sync is already running - nothing to do.")
            return

        synced = 0
        errors = 0
        try:
            targets = due_channels()
            if options["force"]:
                from pms.models import Property
                from pms.views._sync_schedule import CHANNELS, _url_for

                targets = [
                    (prop, channel)
                    for prop in Property.objects.filter(active=True, auto_sync_enabled=True)
                    for channel in CHANNELS
                    if _url_for(prop, channel)
                ]

            for prop, channel in targets:
                beat(run)
                url = prop.airbnb_ical_url if channel == "airbnb" else prop.booking_ical_url
                try:
                    events = fetch_ical_events(url)
                    result = import_ical_reservations(prop, channel, events)
                    SyncLog.objects.create(
                        property=prop,
                        channel=channel,
                        status="completed",
                        imported_count=result["imported"],
                        updated_count=result["updated"],
                        skipped_count=result["skipped"],
                        conflict_count=result.get("conflicts", 0),
                        missing_count=result.get("missing", 0),
                        error_message="; ".join(result["errors"]) if result["errors"] else "",
                    )
                    record_attempt(prop, channel, ok=True)
                    synced += 1
                    self.stdout.write(
                        f"{prop.name} [{channel}]: "
                        f"{result['imported']} imported, {result['updated']} updated, "
                        f"{result['skipped']} skipped, {result.get('conflicts', 0)} conflicts, "
                        f"{result.get('missing', 0)} missing, "
                        f"{result.get('cancelled', 0)} cancelled"
                    )
                except (URLError, TimeoutError):
                    message = "Could not reach the calendar link."
                    SyncLog.objects.create(
                        property=prop, channel=channel, status="failed", error_message=message
                    )
                    record_attempt(prop, channel, ok=False, error=message)
                    errors += 1
                    self.stderr.write(f"{prop.name} [{channel}]: {message}")
                except Exception as error:  # noqa: BLE001 — one bad feed must not kill the run
                    SyncLog.objects.create(
                        property=prop,
                        channel=channel,
                        status="failed",
                        error_message=str(error)[:300],
                    )
                    record_attempt(prop, channel, ok=False, error=str(error))
                    errors += 1
                    self.stderr.write(f"{prop.name} [{channel}]: {error}")

            # Piggyback housekeeping: expired login challenges would otherwise
            # accumulate forever.
            from pms.models import LoginChallenge

            LoginChallenge.purge_stale()
        except Exception as error:  # noqa: BLE001
            # The lock is given back whatever happens. A run that dies holding
            # it stops auto-sync until somebody notices, which is months.
            release_run(run, properties=synced, errors=errors, error=str(error))
            raise
        else:
            release_run(run, properties=synced, errors=errors)

        self.stdout.write(
            self.style.SUCCESS(f"Calendar sync done - {synced} synced, {errors} failed.")
        )
