from datetime import date
from decimal import Decimal
from urllib.request import Request, urlopen

from django.core.exceptions import ValidationError

from ..models import Reservation


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


def import_ical_reservations(prop, platform, events):
    imported = 0
    updated = 0
    skipped = 0
    errors = []

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

        reservation = Reservation.objects.filter(platform=platform, external_uid=uid).first()
        if reservation is None:
            reservation = Reservation.objects.filter(
                property=prop, platform=platform, check_in=check_in, check_out=check_out,
            ).first()
        if reservation is None:
            reservation = Reservation.objects.filter(
                property=prop, platform=platform,
                notes="Imported from Airbnb iCal.",
                check_in__lt=check_out, check_out__gt=check_in,
            ).first()

        created = reservation is None
        if created:
            reservation = Reservation(platform=platform, external_uid=uid)

        reservation.property = prop
        reservation.external_uid = uid
        reservation.check_in = check_in
        reservation.check_out = check_out
        if created:
            reservation.guest_name = "Airbnb"
            reservation.guest_phone = ""
            reservation.nightly_price_eur = Decimal("0.00")
            reservation.notes = "Imported from Airbnb iCal."
        elif not reservation.notes:
            reservation.notes = "Imported from Airbnb iCal."

        try:
            reservation.save()
        except ValidationError as error:
            skipped += 1
            errors.append(
                f"{check_in} to {check_out}: {error.messages[0] if error.messages else 'Import failed'}"
            )
            continue

        if created:
            imported += 1
        else:
            updated += 1

    return {"imported": imported, "updated": updated, "skipped": skipped, "errors": errors[:8]}


def clean_ical_text(value):
    return value.replace("\\,", ",").replace("\\;", ";").replace("\\n", " ").strip()


def escape_ical(value):
    return (
        value.replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(";", "\\;")
        .replace("\n", "\\n")
    )


def reservation_label_for_export(reservation):
    if reservation.platform == Reservation.Platform.AIRBNB:
        return "Airbnb"
    return reservation.guest_name or reservation.guest_phone or "Reserved"
