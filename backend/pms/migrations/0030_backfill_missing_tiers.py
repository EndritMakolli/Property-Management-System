"""Repair databases where 0028 already ran under the pre-fix condition.

0028 skipped seeding a default long-stay tier whenever a scope-all, enabled
long_stay rule already existed at that min_nights — even if that rule's
adjustment_value was NULL. A rule with no amount can never discount anything
(the pricing engine reports it skipped_invalid, "no amount set"), so on any
database that already held such a placeholder row the corresponding default
tier silently vanished, and stays at that threshold priced with no discount
at all. This migration creates the missing tier wherever that happened.

Self-contained by design: it does not import from 0028_seed_pricing_groups
(whose module name isn't even a valid import target — see _0028_helpers.py's
docstring) and duplicates just the two small pieces it needs (the tier list
and the tidy() percent formatter) so this migration keeps working exactly as
written regardless of future edits to 0028.

Idempotent: on a database where the corrected condition already produced a
usable tier — fresh installs, or a database this migration already repaired —
every check below finds a usable rule and creates nothing. Safe to run twice.
"""

from decimal import Decimal

from django.db import migrations

# Same six tiers as 0028's DEFAULT_TIERS. The list index doubles as
# sort_order, biggest tier first, so the lowest sort_order is the tier that
# used to win in the old "highest applicable tier" fallback.
DEFAULT_TIERS = [
    (28, Decimal("50.00")),
    (21, Decimal("35.00")),
    (14, Decimal("25.00")),
    (10, Decimal("20.00")),
    (7, Decimal("15.00")),
    (5, Decimal("10.00")),
]


def tidy(value):
    """Render a Decimal for display: 50.00 -> '50', 12.50 -> '12.5'.

    NOT Decimal.normalize(), which turns 50.00 into 5E+1 and would name a
    rule "5E+1%".
    """
    text = f"{value:f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def backfill(apps, schema_editor):
    PricingGroup = apps.get_model("pms", "PricingGroup")
    PricingRule = apps.get_model("pms", "PricingRule")

    stay, _ = PricingGroup.objects.get_or_create(
        name="Stay Discounts", defaults={"sort_order": 1, "behaviour": "exclusive"}
    )

    for index, (min_nights, pct) in enumerate(DEFAULT_TIERS):
        # Same corrected condition as 0028: only a rule that can actually
        # discount (non-null adjustment_value) counts as "already seeded".
        #
        # Scope="all" only, same as 0028: a property- or bedroom-scoped
        # custom rule at this min_nights does not suppress the default, and
        # that's fine — the default now sits in the 900 band (below), so a
        # scoped custom rule at the ordinary sort_order range simply outranks
        # it rather than needing to replace it.
        usable = PricingRule.objects.filter(
            rule_type="long_stay",
            scope="all",
            enabled=True,
            min_nights=min_nights,
            adjustment_value__isnull=False,
        ).exists()
        if usable:
            continue
        PricingRule.objects.create(
            group=stay,
            name=f"{min_nights}+ nights − {tidy(pct)}%",
            rule_type="long_stay",
            scope="all",
            enabled=True,
            min_nights=min_nights,
            adjustment_type="pct_decrease",
            adjustment_value=pct,
            application="whole_stay",
            # 900+index, not index: see 0028_seed_pricing_groups.py's step 2
            # comment. A default tier must sit above the ordinary sort_order
            # range so any operator rule outranks it automatically.
            sort_order=900 + index,
        )


def noop(apps, schema_editor):
    """No-op. This migration only ever fills in rows that are missing;
    reversing it would mean deleting rules that real users may since have
    edited, which isn't a safe or meaningful rollback."""


class Migration(migrations.Migration):
    dependencies = [("pms", "0029_drop_promocode")]
    operations = [migrations.RunPython(backfill, noop)]
