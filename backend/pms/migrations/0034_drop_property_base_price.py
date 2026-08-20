"""Move each property's nightly rate into the Base Prices group, then drop it.

Property.base_price_eur was a second home for a number the pricing rules were
supposed to own: the engine seeded every night from it, so the pricing page
could not actually control the rate it displayed, and a property could be
priced without any rule saying so.

The rate now lives only in the Base Prices group. Each property's stored value
is carried across as a property-scoped base price first, so nothing loses its
price on the way — delete those rules and replace them with broader ones (one
per bedroom count, say) whenever it suits.

Reservations are untouched. They were never priced from this column: each one
stores its own nightly_price_eur, total_price_eur and price_breakdown_json,
which is what makes a booking a record of what was agreed rather than a live
quote.
"""

from decimal import Decimal

from django.db import migrations


def carry_rates_into_rules(apps, schema_editor):
    PricingGroup = apps.get_model("pms", "PricingGroup")
    PricingRule = apps.get_model("pms", "PricingRule")
    Property = apps.get_model("pms", "Property")

    base, _ = PricingGroup.objects.get_or_create(
        name="Base Prices", defaults={"sort_order": 0, "behaviour": "specific"}
    )

    for index, prop in enumerate(Property.objects.order_by("created_at", "pk")):
        rate = prop.base_price_eur or Decimal("0.00")
        if rate <= 0:
            continue  # nothing worth carrying across
        # Idempotent, and it never overwrites a rate already written by hand.
        if PricingRule.objects.filter(
            rule_type="base_price", scope="property", property_id=prop.pk
        ).exists():
            continue
        PricingRule.objects.create(
            group=base,
            name=f"{prop.name} base rate",
            rule_type="base_price",
            scope="property",
            property_id=prop.pk,
            enabled=True,
            application="per_night",
            adjustment_type="fixed_price",
            adjustment_value=rate,
            sort_order=index,
        )


def noop(apps, schema_editor):
    """No-op. The column this read is gone by the time anything could reverse
    it, and the rules created here may since have been edited."""


class Migration(migrations.Migration):

    dependencies = [
        ('pms', '0033_group_behaviours'),
    ]

    operations = [
        # Order matters: the rates must be read before the column holding them
        # is removed from the migration state.
        migrations.RunPython(carry_rates_into_rules, noop),
        migrations.RemoveField(
            model_name='property',
            name='base_price_eur',
        ),
    ]
