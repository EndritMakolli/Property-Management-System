"""Let the seeded groups pick their own winner instead of relying on sorting.

Two of the seeded groups were Exclusive, where the FIRST eligible rule wins
and therefore the sort order is load-bearing. That made both of them fragile:

  * The long-stay tier ladder is only correct while somebody keeps it sorted
    biggest-first. Reorder it, or add a tier at the create endpoint's default
    sort_order of 0, and a 5-night 10% tier beats a 28-night 50% one.
  * Base prices are aimed by scope, not by rank. A rate written for one
    apartment should beat one written for every 2-bedroom apartment whatever
    order they happen to sit in.

Both now say what they mean — "best" and "specific" — which also frees their
sort_order to be nothing but display order.

Idempotent: it assigns names and behaviours rather than toggling them.
"""

from django.db import migrations, models


def set_behaviours(apps, schema_editor):
    PricingGroup = apps.get_model("pms", "PricingGroup")

    stay = PricingGroup.objects.filter(name="Stay Discounts").first()
    if stay is not None and not PricingGroup.objects.filter(
        name="Length of Stay Discounts"
    ).exists():
        stay.name = "Length of Stay Discounts"
        stay.save(update_fields=["name"])

    PricingGroup.objects.filter(name="Length of Stay Discounts").update(behaviour="best")
    PricingGroup.objects.filter(name="Base Prices").update(behaviour="specific")


def noop(apps, schema_editor):
    """No-op. Reversing would re-impose an ordering dependency that the rows
    have since been freed from, and rename a group an operator may have
    renamed again themselves."""


class Migration(migrations.Migration):

    dependencies = [
        ('pms', '0032_base_price_rule_type'),
    ]

    operations = [
        migrations.AlterField(
            model_name='pricinggroup',
            name='behaviour',
            field=models.CharField(choices=[('stack', 'Stack — every eligible rule applies, in order'), ('exclusive', 'Exclusive — the first eligible rule applies'), ('best', 'Best — the eligible rule that gives the lowest price applies'), ('specific', 'Most specific — the narrowest matching rule applies')], default='stack', max_length=10),
        ),
        migrations.RunPython(set_behaviours, noop),
    ]
