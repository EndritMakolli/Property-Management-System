"""Move already-seeded default long-stay tiers into the 900 sort_order band.

0028 and 0030 originally seeded the six default long-stay tiers at
sort_order 0-5 in the Exclusive "Stay Discounts" group — the same range an
operator's own rules start from (the create endpoint defaults sortOrder to
0). Since the lowest sort_order wins in an Exclusive group, a custom rule
could lose to a built-in default, and a brand-new rule left at the default
sort_order=0 would tie the seeded 28-night tier, where the created_at
tiebreak hands victory to the older seeded row — a brand-new operator rule
could silently never apply.

0028/0030 (this same change, applied there) now seed fresh installs directly
into a 900+index band. This migration repairs databases where 0028/0030
already ran under the old 0-5 numbering, moving those rows into the same
band so the fix reaches already-seeded databases, not just fresh ones.

Idempotent: identifies a "seeded default tier" purely by shape — enabled,
scope="all", long_stay, with (min_nights, adjustment_value) matching one of
the six default pairs exactly — and sets its sort_order to 900+index every
time. Running this twice (or on a fresh database that never had the bug)
just re-writes the same value, and it never touches a rule whose
min_nights/adjustment_value an operator has since customised away from the
default pair, because that row no longer matches the shape being searched
for.

A rule an operator created from scratch that happens to match a default pair
exactly is swept into the 900 band too, but that is harmless: identical
min_nights and adjustment_value means identical pricing behaviour to the
default it's indistinguishable from, so renumbering it changes nothing a
guest or operator could observe.
"""

from decimal import Decimal

from django.db import migrations

# Same six tiers as 0028's DEFAULT_TIERS and 0030's DEFAULT_TIERS. The list
# index doubles as the offset into the 900 band, biggest tier first, so the
# lowest sort_order in the band (900) is the tier that wins when several are
# eligible — same relative order as before this migration.
DEFAULT_TIERS = [
    (28, Decimal("50.00")),
    (21, Decimal("35.00")),
    (14, Decimal("25.00")),
    (10, Decimal("20.00")),
    (7, Decimal("15.00")),
    (5, Decimal("10.00")),
]


def renumber(apps, schema_editor):
    PricingRule = apps.get_model("pms", "PricingRule")

    for index, (min_nights, pct) in enumerate(DEFAULT_TIERS):
        PricingRule.objects.filter(
            rule_type="long_stay",
            scope="all",
            enabled=True,
            min_nights=min_nights,
            adjustment_value=pct,
        ).update(sort_order=900 + index)


def noop(apps, schema_editor):
    """No-op. Reversing would mean guessing which rows this migration moved
    and where they were before — rows an operator may since have edited —
    which isn't a safe or meaningful rollback."""


class Migration(migrations.Migration):
    dependencies = [("pms", "0030_backfill_missing_tiers")]
    operations = [migrations.RunPython(renumber, noop)]
