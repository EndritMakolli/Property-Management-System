import threading

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from . import sheets_sync
from .models import DoorCode, Property, Reservation


@receiver(post_save, sender=Property)
def create_door_code_for_property(sender, instance, created, raw=False, **kwargs):
    # `raw` is True when the row is being loaded from a fixture (e.g. a backup
    # import). The fixture carries its own DoorCode, so creating one here would
    # collide — skip side effects during raw loads.
    if raw:
        return
    if created:
        DoorCode.objects.get_or_create(property=instance)


def _run_in_background(target, *args):
    """Run a best-effort Sheets call off the request thread.

    The sheets_sync calls are synchronous HTTP to Google; running them inline
    would add ~1s to every reservation save. They already swallow their own
    errors, so a daemon thread is safe — the worst case is a missed mirror,
    which `sync_sheets` can repair.
    """
    threading.Thread(target=target, args=args, daemon=True).start()


@receiver(pre_save, sender=Reservation)
def _capture_previous_checkin(sender, instance, raw=False, **kwargs):
    # Remember the previously-saved check-in so post_save can tell when a
    # reservation moves to a different month tab. A UUID pk is assigned before
    # the first save, so existence must be checked against the DB, not the pk.
    instance._sheet_previous_checkin = None
    if raw:
        return
    previous = sender.objects.filter(pk=instance.pk).only("check_in").first()
    if previous:
        instance._sheet_previous_checkin = previous.check_in


@receiver(post_save, sender=Reservation)
def sync_reservation_to_sheet(sender, instance, raw=False, **kwargs):
    # Skip side effects during raw fixture/backup loads (mirrors the DoorCode
    # handler above); a full `sync_sheets` after an import rebuilds the mirror.
    if raw or not sheets_sync.is_enabled():
        return

    reservation_id = str(instance.id)
    new = instance.check_in
    previous = getattr(instance, "_sheet_previous_checkin", None)
    new_tab = (new.year, new.month)
    previous_tab = (previous.year, previous.month) if previous else None

    # If the reservation moved to another month, clear its old row first.
    if previous_tab and previous_tab != new_tab:
        _run_in_background(sheets_sync.remove_reservation_row, reservation_id, *previous_tab)

    if instance.is_archived:
        # Archived reservations are not mirrored — remove from the current tab.
        _run_in_background(sheets_sync.remove_reservation_row, reservation_id, *new_tab)
        return

    # Build the row here (request thread, with DB access) so the background
    # thread only does HTTP and never touches the ORM.
    row = sheets_sync.reservation_to_row(instance)
    _run_in_background(sheets_sync.upsert_reservation_row, reservation_id, row, *new_tab)


@receiver(post_delete, sender=Reservation)
def remove_reservation_from_sheet(sender, instance, **kwargs):
    if not sheets_sync.is_enabled():
        return
    check_in = instance.check_in
    if check_in:
        _run_in_background(
            sheets_sync.remove_reservation_row, str(instance.id), check_in.year, check_in.month
        )
