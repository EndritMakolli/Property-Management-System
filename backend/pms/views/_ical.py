from datetime import date, datetime, timezone
from decimal import Decimal
from urllib.request import Request, urlopen

from django.core.exceptions import ValidationError
from django.utils.timezone import localdate

from ..models import Reservation, SyncConflict

CHANNEL_LABELS = {
    Reservation.Platform.AIRBNB: "Airbnb",
    Reservation.Platform.BOOKING: "Booking.com",
}


def channel_label(platform):
    return CHANNEL_LABELS.get(platform, "Channel")


def fetch_ical_events(url):
    req = Request(url, headers={"User-Agent": "PMS/1.0", "Accept": "text/calendar,*/*"})
    with urlopen(req, timeout=20) as response:
        content = response.read().decode("utf-8", errors="replace")
    return parse_ical_events(content)


def parse_ical_events(content):
    unfolded_lines = []
    for raw_line in content.splitlines():
        if raw_line.startswith((" ", "\t")) and unfolded_lines:
            unfolded_lines[-1] += raw_line[1:]
        else:
            unfolded_lines.append(raw_line)

    events = []
    current = None
    for line in unfolded_lines:
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current is not None:
                events.append(current)
            current = None
            continue
        if current is None or ":" not in line:
            continue
        key, value = line.split(":", 1)
        field = key.split(";", 1)[0].upper()
        current[field] = value.strip()

    return events


def ical_date(value):
    value = value.strip()
    if "T" in value:
        value = value.split("T", 1)[0]
    return date.fromisoformat(f"{value[0:4]}-{value[4:6]}-{value[6:8]}")


def _find_overlap(prop, check_in, check_out, exclude_pk=None):
    """A live guest reservation in `prop` that overlaps [check_in, check_out)."""
    qs = Reservation.objects.filter(
        property=prop,
        is_archived=False,
        check_in__lt=check_out,
        check_out__gt=check_in,
    ).exclude(platform=Reservation.Platform.MAINTENANCE)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.first()


def _record_conflict(prop, platform, uid, check_in, check_out, existing, summary):
    SyncConflict.objects.update_or_create(
        property=prop,
        channel=platform,
        external_uid=uid,
        defaults={
            "check_in": check_in,
            "check_out": check_out,
            "existing_reservation": existing,
            "summary": (summary or "")[:255],
            "resolved": False,
        },
    )


def _resolve_conflict(prop, platform, uid):
    SyncConflict.objects.filter(
        property=prop, channel=platform, external_uid=uid, resolved=False
    ).update(resolved=True)


def import_ical_reservations(prop, platform, events):
    imported = 0
    updated = 0
    skipped = 0
    conflicts = 0
    cancelled = 0
    errors = []
    seen_uids = set()
    had_valid_event = False

    label = channel_label(platform)
    note = f"Imported from {label} iCal."

    for event in events:
        uid = event.get("UID")
        starts_at = event.get("DTSTART")
        ends_at = event.get("DTEND")
        if not uid or not starts_at or not ends_at:
            skipped += 1
            continue

        try:
            check_in = ical_date(starts_at)
            check_out = ical_date(ends_at)
        except (ValueError, IndexError):
            skipped += 1
            errors.append(f"Skipped event with invalid dates: {uid}")
            continue

        if check_out <= check_in:
            skipped += 1
            continue

        seen_uids.add(uid)
        had_valid_event = True
        summary = clean_ical_text(event.get("SUMMARY", ""))

        # Match an existing booking: first by the channel's stable UID (not
        # property-scoped, so a manually relocated booking is still recognised),
        # then by an exact same-channel, not-yet-linked date range.
        reservation = Reservation.objects.filter(
            platform=platform, external_uid=uid, is_archived=False
        ).first()
        if reservation is None:
            reservation = Reservation.objects.filter(
                property=prop, platform=platform, external_uid__isnull=True,
                check_in=check_in, check_out=check_out, is_archived=False,
            ).first()

        created = reservation is None

        # A booking the user moved by hand stays in its new apartment; otherwise
        # it follows the feed it came from.
        target_property = (
            reservation.property if (reservation and reservation.pinned_property) else prop
        )

        overlap = _find_overlap(
            target_property, check_in, check_out,
            exclude_pk=None if created else reservation.pk,
        )
        if overlap is not None:
            # The slot is taken (often by a reservation the user added manually).
            # Record it so it can be linked or dismissed under Needs Attention.
            _record_conflict(prop, platform, uid, check_in, check_out, overlap, summary)
            conflicts += 1
            continue

        if created:
            reservation = Reservation(platform=platform, external_uid=uid)
            reservation.property = prop
            reservation.guest_name = label
            reservation.guest_phone = ""
            reservation.nightly_price_eur = Decimal("0.00")
            reservation.notes = note
        else:
            reservation.external_uid = uid
            if not reservation.pinned_property:
                reservation.property = prop
            if not reservation.notes:
                reservation.notes = note

        reservation.check_in = check_in
        reservation.check_out = check_out

        try:
            reservation.save()
        except ValidationError as error:
            skipped += 1
            errors.append(
                f"{check_in} to {check_out}: {error.messages[0] if error.messages else 'Import failed'}"
            )
            continue

        _resolve_conflict(prop, platform, uid)
        if created:
            imported += 1
        else:
            updated += 1

    # Reconcile cancellations: a booking that disappeared from the feed was
    # cancelled on the channel — archive it so it stops blocking the calendar.
    # Pinned (manually relocated) bookings are left alone, and the had_valid_event
    # guard prevents a transient empty/failed feed from mass-archiving.
    if had_valid_event:
        today = localdate()
        now = datetime.now(timezone.utc)
        vanished = (
            Reservation.objects.filter(
                property=prop, platform=platform, is_archived=False,
                pinned_property=False, check_out__gte=today,
            )
            .exclude(external_uid__isnull=True)
            .exclude(external_uid__in=seen_uids)
        )
        for reservation in vanished:
            reservation.is_archived = True
            reservation.archived_at = now
            reservation.save(update_fields=["is_archived", "archived_at"])
            cancelled += 1

        # Clear conflicts whose channel event is no longer in the feed.
        SyncConflict.objects.filter(
            property=prop, channel=platform, resolved=False
        ).exclude(external_uid__in=seen_uids).update(resolved=True)

    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "conflicts": conflicts,
        "cancelled": cancelled,
        "errors": errors[:8],
    }


def clean_ical_text(value):
    return value.replace("\\,", ",").replace("\\;", ";").replace("\\n", " ").strip()


def escape_ical(value):
    return (
        value.replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(";", "\\;")
        .replace("\n", "\\n")
    )


def reservation_label_for_export(reservation, public=False):
    if reservation.platform == Reservation.Platform.AIRBNB:
        return "Airbnb"
    if reservation.platform == Reservation.Platform.BOOKING:
        return "Booking.com"
    if public:
        # The token URL is pasted into external channels and can be forwarded;
        # never expose guest names or phone numbers on the public feed.
        return "Reserved"
    return reservation.guest_name or reservation.guest_phone or "Reserved"
