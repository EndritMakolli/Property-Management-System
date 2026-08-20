# backend/pms/migrations/_0032_helpers.py
"""Extracted so the restructure can be unit-tested against real rows.
Leading underscore keeps Django's migration loader from treating it as one."""

# The order the groups run in after this migration. A stay is priced by
# walking these top to bottom: a base rate is chosen, seasons adjust it,
# then the whole-stay discounts and promotions take their turns.
GROUP_ORDER = [
    ("Base Prices", "exclusive"),
    ("Seasonal Pricing", "stack"),
    ("Stay Discounts", "exclusive"),
    ("Booking Discounts", "stack"),
    ("Promotions", "stack"),
]

# Rules that have no business sitting in a group named "Seasonal Pricing".
# 0028 seeded the non-refundable discount into "Booking Discounts", and this
# migration reuses that group's name for seasons, so its contents move on.
NOT_SEASONAL = ("non_refundable", "last_minute")


def restructure_groups(apps):
    """Rename the seeded groups and give base prices their own type.

    Idempotent. Every step is expressed as "make the world look like this"
    rather than "apply this change", so a second run is a no-op and a
    database that is already half-way there converges the rest of the way.
    """
    PricingGroup = apps.get_model("pms", "PricingGroup")
    PricingRule = apps.get_model("pms", "PricingRule")

    # 1. The first group becomes Base Prices. Renaming rather than creating
    #    keeps the rules an operator already put there — which, in practice,
    #    is exactly the dateless per-night rates this migration is about.
    base = PricingGroup.objects.filter(name="Base Prices").first()
    if base is None:
        base = PricingGroup.objects.filter(name="Seasonal Pricing").order_by("sort_order").first()
        if base is not None:
            base.name = "Base Prices"
            base.save(update_fields=["name"])
    if base is None:
        base = PricingGroup.objects.create(name="Base Prices", sort_order=0, behaviour="exclusive")

    # 2. A dateless, per-night, fixed-price rule was only ever a base rate
    #    wearing the seasonal type because no better type existed. Convert it.
    #    Shape-based, like 0030/0031: anything with dates, or expressing a
    #    percentage, is a real seasonal rule and is left alone.
    PricingRule.objects.filter(
        group=base,
        rule_type="seasonal",
        application="per_night",
        adjustment_type="fixed_price",
        start_date__isnull=True,
        end_date__isnull=True,
    ).update(rule_type="base_price")

    # 3. Free the "Seasonal Pricing" name for real date-range rules by
    #    renaming the now-spare group, then rehome anything in it that is not
    #    seasonal. Only create a replacement "Booking Discounts" if there is
    #    something to put in it — an empty group is clutter, not structure.
    if not PricingGroup.objects.filter(name="Seasonal Pricing").exists():
        spare = PricingGroup.objects.filter(name="Booking Discounts").order_by("sort_order").first()
        if spare is None:
            spare = PricingGroup.objects.create(
                name="Seasonal Pricing", sort_order=1, behaviour="stack"
            )
        else:
            spare.name = "Seasonal Pricing"
            spare.behaviour = "stack"
            spare.save(update_fields=["name", "behaviour"])

        displaced = PricingRule.objects.filter(group=spare, rule_type__in=NOT_SEASONAL)
        if displaced.exists():
            discounts = PricingGroup.objects.create(
                name="Booking Discounts", sort_order=3, behaviour="stack"
            )
            displaced.update(group=discounts)

    # 3b. Anything left in Base Prices that is not a base price is a real
    #     seasonal rule, and it must not stay: step 4 makes Base Prices
    #     Exclusive, where the first matching rule would suppress the rest.
    #     Its home is the Seasonal Pricing group, which now exists.
    seasonal = PricingGroup.objects.filter(name="Seasonal Pricing").order_by("sort_order").first()
    if seasonal is not None:
        PricingRule.objects.filter(group=base).exclude(rule_type="base_price").update(group=seasonal)

    # 4. Put every group that exists into the canonical order. Groups an
    #    operator added themselves keep their own sort_order and simply sort
    #    among these by value, which is the behaviour they already had.
    for index, (name, behaviour) in enumerate(GROUP_ORDER):
        group = PricingGroup.objects.filter(name=name).order_by("sort_order").first()
        if group is None:
            continue
        group.sort_order = index
        group.behaviour = behaviour
        group.save(update_fields=["sort_order", "behaviour"])
