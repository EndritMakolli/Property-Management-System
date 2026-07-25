"""Link existing reservations to Guest records (the client directory).

Matches by phone digits first, then case-insensitive name; creates a Guest
when nothing matches. Uses queryset.update() so reservation save()/signals
(Google Sheets sync) never fire. Idempotent — already-linked reservations are
skipped.
"""

from django.core.management.base import BaseCommand
from django.db.models import Count, Q

from pms.models import Guest, Reservation
from pms.views._guests import find_guest, split_name


class Command(BaseCommand):
    help = "Attach Guest records to reservations that have none (match or create by name/phone)."

    def handle(self, *args, **options):
        linked = 0
        created = 0
        skipped = 0

        rows = (
            Reservation.objects.filter(guest__isnull=True)
            .exclude(platform="maintenance")
            .order_by("check_in")
        )
        for reservation in rows.iterator():
            name = (reservation.guest_name or "").strip()
            if not name:
                skipped += 1
                continue
            guest = find_guest(name, reservation.guest_phone)
            if guest is None:
                first, last = split_name(name)
                guest = Guest.objects.create(
                    first_name=first or name,
                    last_name=last,
                    phone=(reservation.guest_phone or "").strip() or None,
                    email=(reservation.guest_email or "").strip() or None,
                )
                created += 1
            Reservation.objects.filter(pk=reservation.pk).update(guest=guest.pk)
            linked += 1

        stay_filter = Q(reservations__is_archived=False) & ~Q(reservations__platform="maintenance")
        returning = (
            Guest.objects.annotate(stay_count=Count("reservations", filter=stay_filter))
            .filter(stay_count__gte=2, is_returning=False)
            .update(is_returning=True)
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Linked {linked} reservation(s) ({created} new client(s) created, "
                f"{skipped} without a guest name skipped); "
                f"marked {returning} client(s) as returning."
            )
        )
