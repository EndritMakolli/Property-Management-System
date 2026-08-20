"""Give base prices their own rule type, and restructure the seeded groups.

Operators were setting a nightly rate with dateless per-night seasonal rules
because no better type existed. That worked, but it made calculate_price
report has_seasonal on stays that had no season, and it left the name
"Seasonal Pricing" attached to a group that held no seasons.

After this migration the groups read as the order they run in:
Base Prices, Seasonal Pricing, Stay Discounts, Booking Discounts, Promotions.
"""

from django.db import migrations, models

from ._0032_helpers import restructure_groups


def restructure(apps, schema_editor):
    restructure_groups(apps)


def noop(apps, schema_editor):
    """No-op. Reversing would mean renaming groups back and guessing which
    rules an operator has since moved, which is not a safe rollback."""


class Migration(migrations.Migration):

    dependencies = [
        ('pms', '0031_renumber_seeded_tiers'),
    ]

    operations = [
        migrations.AlterField(
            model_name='pricingrule',
            name='rule_type',
            field=models.CharField(choices=[('base_price', 'Base Price'), ('long_stay', 'Long Stay Discount'), ('seasonal', 'Seasonal / Date-Range Pricing'), ('last_minute', 'Last-Minute Discount'), ('non_refundable', 'Non-Refundable Discount'), ('promo', 'Promo Code'), ('manual', 'Manual Discount')], max_length=20),
        ),
        migrations.RunPython(restructure, noop),
    ]
