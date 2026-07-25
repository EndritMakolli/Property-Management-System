"""Derive the flat monthly price for monthly reservations that lack one.

Needed after importing a backup made before monthly pricing existed. Uses
queryset.update() so reservation save()/signals (Google Sheets sync) never
fire and stored totals stay untouched. Idempotent — rows that already have a
monthly price are skipped.
"""

from decimal import Decimal, ROUND_HALF_UP

from django.core.management.base import BaseCommand

from pms.model_defs.monthly import monthly_period_count
from pms.models import Reservation


def backfill():
    """Returns (updated, skipped) counts. Shared with the backup import."""
    updated = 0
    skipped = 0
    rows = Reservation.objects.filter(platform="monthly", monthly_price_eur__isnull=True)
    for reservation in rows.iterator():
        periods = monthly_period_count(reservation.check_in, reservation.check_out)
        if periods <= 0:
            skipped += 1
            continue
        price = (reservation.total_price_eur / Decimal(periods)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        Reservation.objects.filter(pk=reservation.pk).update(monthly_price_eur=price)
        updated += 1
    return updated, skipped


class Command(BaseCommand):
    help = "Set monthly_price_eur (total ÷ periods) on monthly reservations missing it."

    def handle(self, *args, **options):
        updated, skipped = backfill()
        self.stdout.write(
            self.style.SUCCESS(
                f"Backfilled {updated} monthly reservation(s); {skipped} skipped "
                "(no billing periods)."
            )
        )
