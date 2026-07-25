import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db import migrations, models


def _add_months(anchor, n):
    year = anchor.year + (anchor.month - 1 + n) // 12
    month = (anchor.month - 1 + n) % 12 + 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _period_count(check_in, check_out):
    if not check_in or not check_out or check_out <= check_in:
        return 0
    n = 0
    while _add_months(check_in, n) < check_out:
        n += 1
    return n


def backfill_monthly_prices(apps, schema_editor):
    """Derive a flat monthly price for existing monthly stays from their total.

    Uses queryset.update() per row so save()/signals (Google Sheets sync) never
    fire and stored totals stay untouched.
    """
    Reservation = apps.get_model("pms", "Reservation")
    rows = Reservation.objects.filter(platform="monthly", monthly_price_eur__isnull=True)
    for reservation in rows.iterator():
        periods = _period_count(reservation.check_in, reservation.check_out)
        if periods <= 0:
            continue
        price = (reservation.total_price_eur / Decimal(periods)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        Reservation.objects.filter(pk=reservation.pk).update(monthly_price_eur=price)


class Migration(migrations.Migration):

    dependencies = [
        ('pms', '0017_property_hidden_from_management'),
    ]

    operations = [
        migrations.AddField(
            model_name='reservation',
            name='monthly_price_eur',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.RunPython(backfill_monthly_prices, migrations.RunPython.noop),
    ]
