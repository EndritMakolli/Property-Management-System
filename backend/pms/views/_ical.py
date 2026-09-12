import ipaddress
import socket
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from django.core.exceptions import ValidationError
from django.utils.timezone import localdate

from ..models import Reservation, SyncConflict

CHANNEL_LABELS = {
    Reservation.Platform.AIRBNB: "Airbnb",
    Reservation.Platform.BOOKING: "Booking.com",
}

# Cap the download so a hostile or broken feed cannot exhaust memory.
MAX_ICAL_BYTES = 5 * 1024 * 1024


def channel_label(platform):
    return CHANNEL_LABELS.get(platform, "Channel")


def _assert_public_url(url):
    """Refuse anything that isn't a public http(s) endpoint.

    The iCal URL is operator-supplied and fetched server-side, so without this
    it is a server-side request forgery primitive: a management-role user (or a
    stolen session) could point it at cloud metadata or an internal service and
    use success/failure timing as a port scanner.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ValidationError("Calendar links must start with http:// or https://.")
    if not parts.hostname:
        raise ValidationError("That calendar link has no host.")

    try:
        resolved = socket.getaddrinfo(parts.hostname, None)
    except socket.gaierror:
        raise ValidationError("Could not resolve the calendar link's host.")

    for info in resolved:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            raise ValidationError("Calendar links must point at a public address.")


def fetch_ical_events(url):
    _assert_public_url(url)
    req = Request(url, headers={"User-Agent": "PMS/1.0", "Accept": "text/calendar,*/*"})
    with urlopen(req, timeout=20) as response:
        raw = response.read(MAX_ICAL_BYTES + 1)
    if len(raw) > MAX_ICAL_BYTES:
        raise ValidationError("That calendar feed is too large to import.")
    content = raw.decode("utf-8", errors="replace")
    return parse_ical_events(content)


# How long a booking may stay missing from a feed before it is treated as
# cancelled. A channel that drops a booking for one fetch gets the benefit of
# the doubt; one that has not mentioned it for two days meant it.
MISSING_GRACE = timedelta(days=2)


class IcalEvents(list):
    """Parsed events, plus whether the feed actually finished.

    The completeness flag travels with the events because the decision it
    guards - whether to reconcile cancellations - is made far from the fetch.
    """

    complete = True


def feed_looks_complete(content):
    """Did this feed end where a calendar is supposed to end?

    A connection dropped mid-transfer yields valid events and no END:VCALENDAR.
    Without this check, three of forty bookings arriving looks exactly like
    thirty-seven cancellations.
    """
    text = (content or "").strip()
    if "BEGIN:VCALENDAR" not in text.upper():
        return False
    return text.upper().rstrip().endswith("END:VCALENDAR")


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

    parsed = IcalEvents(events)
    parsed.complete = feed_looks_complete(content)
    return parsed


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
    missing = 0
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
            # Only a row sync created may ever be reconciled away by sync.
            reservation.created_by_sync = True
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
        # It is in the feed, so whatever we thought before, it is not missing.
        reservation.missing_from_sync_since = None

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

    # Reconcile disappearances - carefully.
    #
    # A booking absent from this fetch has not necessarily been cancelled. The
    # feed may have been truncated mid-transfer, served stale, or simply have
    # omitted it. So absence is recorded as a *state* first: the booking is
    # flagged missing and left on the calendar, and only becomes a cancellation
    # once the feed has failed to mention it for MISSING_GRACE.
    #
    # Three guards before that even starts:
    #   had_valid_event  - an empty or unparseable feed decides nothing
    #   feed_complete    - a feed with no END:VCALENDAR was cut off; three of
    #                      forty arriving must not read as thirty-seven cancellations
    #   created_by_sync  - a booking a person typed in is not the feed's to cancel,
    #                      even after adoption gave it the channel's UID
    feed_complete = getattr(events, "complete", True)
    if had_valid_event and feed_complete:
        today = localdate()
        now = datetime.now(timezone.utc)
        vanished = (
            Reservation.objects.filter(
                property=prop, platform=platform, is_archived=False,
                pinned_property=False, created_by_sync=True, check_out__gte=today,
            )
            .exclude(external_uid__isnull=True)
            .exclude(external_uid__in=seen_uids)
        )
        for reservation in vanished:
            if reservation.missing_from_sync_since is None:
                reservation.missing_from_sync_since = now
                reservation.save(update_fields=["missing_from_sync_since"])
                missing += 1
            elif now - reservation.missing_from_sync_since >= MISSING_GRACE:
                reservation.is_archived = True
                reservation.archived_at = now
                reservation.save(update_fields=["is_archived", "archived_at"])
                cancelled += 1
            else:
                # Still inside the grace window; leave it on the calendar.
                missing += 1

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
        "missing": missing,
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
