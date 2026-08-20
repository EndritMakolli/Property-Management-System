"""Fold every price adjustment into PricingGroup/PricingRule.

Irreversible by design: it merges three sources (PromoCode rows, the
non-refundable settings field, and the tier table that used to be hardcoded
in views/_pricing.py) into one model. Reversing would have to guess which
rules came from where.
"""

from decimal import Decimal

from django.db import migrations

from ._0028_helpers import convert_promos

GROUPS = [
    ("Seasonal Pricing", 0, "stack"),
    ("Stay Discounts", 1, "exclusive"),
    ("Booking Discounts", 2, "stack"),
    ("Promotions", 3, "stack"),
]

# Previously _DEFAULT_LONG_STAY_TIERS in views/_pricing.py — an invisible
# fallback that priced every property with no rules of its own. Seeding them
# as real rows keeps today's prices and makes the behaviour editable.
DEFAULT_TIERS = [
    (28, Decimal("50.00")),
    (21, Decimal("35.00")),
    (14, Decimal("25.00")),
    (10, Decimal("20.00")),
    (7, Decimal("15.00")),
    (5, Decimal("10.00")),
]

GROUP_FOR_TYPE = {
    "seasonal": "Seasonal Pricing",
    "long_stay": "Stay Discounts",
    "last_minute": "Booking Discounts",
}


def tidy(value):
    """Render a Decimal for display: 50.00 -> '50', 12.50 -> '12.5'.

    NOT Decimal.normalize(), which turns 50.00 into 5E+1 and would name a
    rule "5E+1%".
    """
    text = f"{value:f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def seed(apps, schema_editor):
    PricingGroup = apps.get_model("pms", "PricingGroup")
    PricingRule = apps.get_model("pms", "PricingRule")
    StayConstraint = apps.get_model("pms", "StayConstraint")
    BookingSiteSettings = apps.get_model("pms", "BookingSiteSettings")

    groups = {}
    for name, sort_order, behaviour in GROUPS:
        groups[name], _ = PricingGroup.objects.get_or_create(
            name=name, defaults={"sort_order": sort_order, "behaviour": behaviour}
        )

    # 1. Existing rules: assign a group, an application, and an order.
    #    discount_pct becomes a real percentage-decrease adjustment.
    for offset, rule in enumerate(PricingRule.objects.order_by("created_at")):
        if rule.rule_type == "minimum_nights":
            continue  # handled in step 5 below
        rule.group = groups[GROUP_FOR_TYPE.get(rule.rule_type, "Promotions")]
        rule.application = "per_night" if rule.rule_type == "seasonal" else "whole_stay"
        rule.sort_order = offset
        if rule.discount_pct is not None and rule.adjustment_type is None:
            rule.adjustment_type = "pct_decrease"
            rule.adjustment_value = rule.discount_pct
        rule.save()

    # 2. Default long-stay tiers, biggest first so the lowest sort_order is
    #    the tier that used to win.
    stay = groups["Stay Discounts"]
    for index, (min_nights, pct) in enumerate(DEFAULT_TIERS):
        exists = PricingRule.objects.filter(
            rule_type="long_stay", scope="all", enabled=True, min_nights=min_nights
        ).exists()
        if exists:
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
            sort_order=index,
        )

    # 3. The non-refundable discount, previously a settings field with no UI.
    settings = BookingSiteSettings.objects.first()
    pct = settings.non_refundable_discount_pct if settings else Decimal("10.00")
    PricingRule.objects.create(
        group=groups["Booking Discounts"],
        name="Non-refundable rate",
        rule_type="non_refundable",
        scope="all",
        enabled=True,
        adjustment_type="pct_decrease",
        adjustment_value=pct,
        application="whole_stay",
        sort_order=100,
    )

    # 4. Promo codes become promo rules; booking requests follow their code.
    convert_promos(apps)

    # 5. Minimum nights is not a price. Move it out of pricing entirely.
    for rule in PricingRule.objects.filter(rule_type="minimum_nights"):
        if rule.min_nights:
            StayConstraint.objects.create(
                kind="min_nights",
                value=rule.min_nights,
                scope=rule.scope,
                property_id=rule.property_id,
                bedroom_group=rule.bedroom_group,
                start_date=rule.start_date,
                end_date=rule.end_date,
                enabled=rule.enabled,
            )
        rule.delete()


def unseed(apps, schema_editor):
    """No-op: see the module docstring. Roll back with a database restore."""


class Migration(migrations.Migration):
    dependencies = [("pms", "0027_pricing_groups")]
    operations = [migrations.RunPython(seed, unseed)]
