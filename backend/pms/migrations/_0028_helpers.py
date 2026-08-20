# backend/pms/migrations/_0028_helpers.py
"""Extracted so the conversion can be unit-tested against real rows.
Leading underscore keeps Django's migration loader from treating it as one."""


def convert_promos(apps):
    PricingGroup = apps.get_model("pms", "PricingGroup")
    PricingRule = apps.get_model("pms", "PricingRule")
    PromoCode = apps.get_model("pms", "PromoCode")
    BookingRequest = apps.get_model("pms", "BookingRequest")

    promotions, _ = PricingGroup.objects.get_or_create(
        name="Promotions", defaults={"sort_order": 3, "behaviour": "stack"}
    )
    for index, promo in enumerate(PromoCode.objects.order_by("created_at")):
        rule = PricingRule.objects.create(
            group=promotions,
            name=f"Promo {promo.code}",
            rule_type="promo",
            scope=promo.scope,
            property_id=promo.property_id,
            bedroom_group=promo.bedroom_group,
            enabled=promo.active,
            code=(promo.code or "").strip().upper() or None,
            usage_limit=promo.usage_limit,
            usage_count=promo.usage_count,
            adjustment_type=(
                "pct_decrease" if promo.discount_type == "percentage" else "fixed_decrease"
            ),
            adjustment_value=promo.discount_value,
            application="whole_stay",
            sort_order=index,
        )
        BookingRequest.objects.filter(promo_code_id=promo.pk).update(promo_rule_id=rule.pk)
