from datetime import timedelta
from urllib.error import URLError

from django.core.management.base import BaseCommand
from django.utils import timezone

from pms.models import Property, SyncLog
from pms.views._ical import fetch_ical_events, import_ical_reservations


class Command(BaseCommand):
    help = (
        "Run iCal calendar imports for properties that have auto-sync enabled and "
        "are due based on their per-property interval. Intended to be run on a "
        "schedule (e.g. an hourly cron); it only syncs channels that are due."
    )

    def handle(self, *args, **options):
        now = timezone.now()
        ran = 0
        skipped = 0

        for prop in Property.objects.filter(active=True, auto_sync_enabled=True):
            interval = timedelta(hours=max(prop.sync_interval_hours or 24, 1))
            channels = (
                ("airbnb", prop.airbnb_ical_url),
                ("booking", prop.booking_ical_url),
            )
            for channel, url in channels:
                if not url:
                    continue

                last = (
                    SyncLog.objects.filter(property=prop, channel=channel, status="completed")
                    .order_by("-synced_at")
                    .first()
                )
                if last and (now - last.synced_at) < interval:
                    skipped += 1
                    continue

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
                        error_message="; ".join(result["errors"]) if result["errors"] else "",
                    )
                    ran += 1
                    self.stdout.write(
                        f"{prop.name} [{channel}]: "
                        f"{result['imported']} imported, {result['updated']} updated, "
                        f"{result['skipped']} skipped, {result.get('conflicts', 0)} conflicts, "
                        f"{result.get('cancelled', 0)} cancelled"
                    )
                except (URLError, TimeoutError):
                    SyncLog.objects.create(
                        property=prop,
                        channel=channel,
                        status="failed",
                        error_message="Could not reach the calendar link.",
                    )
                    self.stderr.write(f"{prop.name} [{channel}]: could not reach the calendar link.")
                except Exception as error:  # noqa: BLE001 — keep one bad feed from killing the run
                    SyncLog.objects.create(
                        property=prop,
                        channel=channel,
                        status="failed",
                        error_message=str(error)[:300],
                    )
                    self.stderr.write(f"{prop.name} [{channel}]: {error}")

        self.stdout.write(
            self.style.SUCCESS(f"Calendar auto-sync done — {ran} run, {skipped} not due.")
        )
