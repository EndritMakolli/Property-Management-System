"""Save-time checks that keep the rule set free of contradictions the engine
would otherwise have to guess its way through."""

from django.core.exceptions import ValidationError

from ..models import PricingGroup, PricingRule


def validate_pricing_rule(rule):
    """Raise ValidationError if the rule cannot be evaluated unambiguously."""
    per_night = rule.application == PricingRule.Application.PER_NIGHT

    if rule.rule_type == PricingRule.RuleType.BLOCK_DISCOUNTS:
        if not per_night:
            raise ValidationError(
                "A rule that excludes discounts protects individual nights, so "
                "it must be per-night."
            )
        if rule.adjustment_type or rule.adjustment_value is not None:
            raise ValidationError(
                "A rule that excludes discounts changes no price, so it cannot "
                "carry an amount. Use a seasonal rate to change the price."
            )
        if rule.blocks_group_id and rule.blocks_rule_id:
            raise ValidationError(
                "Exclude either a whole group or one rule, not both."
            )
        # Checked here rather than left to the database: a well-formed id for
        # something that does not exist reached the INSERT and came back as a
        # ForeignKeyViolation, i.e. a 500 with a stack trace instead of a 400.
        if rule.blocks_group_id and not PricingGroup.objects.filter(
            pk=rule.blocks_group_id
        ).exists():
            raise ValidationError(
                "The group this excludes no longer exists. Choose another."
            )
        if rule.blocks_rule_id and not PricingRule.objects.filter(
            pk=rule.blocks_rule_id
        ).exists():
            raise ValidationError(
                "The rule this excludes no longer exists. Choose another."
            )
        # Locking the nights is the whole mechanism; there is nothing to
        # configure and nothing sensible about switching it off.
        rule.is_final = True
    elif rule.blocks_group_id or rule.blocks_rule_id:
        raise ValidationError(
            "Only a rule that excludes discounts can name what it excludes."
        )

    if rule.rule_type == PricingRule.RuleType.DATE_ADJUST:
        if not per_night:
            raise ValidationError(
                "An increase or decrease for specific dates changes each night's "
                "rate, so it must be per-night."
            )
        if rule.adjustment_type == PricingRule.AdjustmentType.FIXED_PRICE:
            raise ValidationError(
                "This rule moves the price up or down. To state an exact nightly "
                "price for these dates, use a seasonal rate instead."
            )
    elif rule.stacks:
        raise ValidationError(
            "Only an increase or decrease for specific dates can stack."
        )

    if rule.rule_type == PricingRule.RuleType.BASE_PRICE:
        # Checked before the generic rules below so the message names the
        # actual problem rather than the field that happens to trip first.
        if not per_night:
            raise ValidationError(
                "A base price sets the rate of each night, so it must be per-night."
            )
        if rule.adjustment_type != PricingRule.AdjustmentType.FIXED_PRICE:
            raise ValidationError(
                "A base price must be a fixed amount per night. A percentage has "
                "nothing to be a percentage of until a base price exists."
            )
        if rule.start_date or rule.end_date:
            raise ValidationError(
                "A base price applies on every date. For a rate that holds only "
                "between two dates, use a seasonal rule."
            )

    if rule.is_final and not per_night:
        raise ValidationError(
            "Only a per-night rule can set a final price. Whole-stay rules "
            "adjust the total and cannot lock individual nights."
        )

    if rule.adjustment_type == PricingRule.AdjustmentType.FIXED_PRICE and not per_night:
        raise ValidationError(
            "A fixed nightly price cannot be applied to the whole stay. "
            "Set this rule to per-night."
        )

    if rule.rule_type == PricingRule.RuleType.PROMO:
        if not (rule.code or "").strip():
            raise ValidationError("A promo rule needs a code.")
    else:
        if (rule.code or "").strip():
            raise ValidationError("Only a promo rule can have a code.")
        if rule.usage_limit is not None or rule.min_subtotal_eur is not None:
            raise ValidationError(
                "Usage limits and minimum spend belong to promo rules only."
            )

    if rule.min_subtotal_eur is not None and per_night:
        # The minimum is measured against the pass-1 subtotal, which does not
        # exist yet while per-night rules are being applied.
        raise ValidationError(
            "A minimum spend can only be set on a whole-stay rule."
        )

    if rule.start_date and rule.end_date and rule.end_date < rule.start_date:
        # Silently covers nothing, which reads as "my rule is being ignored"
        # rather than as the typo it is.
        raise ValidationError(
            "The end date must be on or after the start date. As written this "
            "rule covers no nights at all."
        )

    if rule.scope == PricingRule.Scope.PROPERTY and not rule.property_id:
        raise ValidationError("Choose a property for a property-scoped rule.")
    if rule.scope == PricingRule.Scope.BEDROOM_GROUP and rule.bedroom_group is None:
        raise ValidationError("Choose a bedroom count for a bedroom-group rule.")

    if (
        rule.enabled
        and rule.adjustment_value is None
        and rule.rule_type != PricingRule.RuleType.BLOCK_DISCOUNTS
    ):
        raise ValidationError("Set an amount or percentage for this rule.")

    _validate_group_consistency(rule)


def _validate_group_consistency(rule):
    """In any group that applies a single winner — Exclusive, Best or Most
    specific — 'the rule that wins' only has one meaning if every rule competes
    on the same footing: all per-night or all whole-stay. Comparing a nightly
    rate against a whole-stay total picks a winner out of two different units.
    Stack groups apply everything, so they may mix freely."""
    # PricingRule.group is NOT NULL at the DB level (0029 dropped its
    # null=True), but a rule under construction can still have group_id
    # unset. Accessing rule.group in that state raises
    # RelatedObjectDoesNotExist rather than returning None, and an unknown
    # (deleted/mistyped) group id makes `rule.group` raise PricingGroup.
    # DoesNotExist. Neither is a ValidationError/ValueError, so the view's
    # `except (ValidationError, ValueError)` misses both and the request
    # 500s. Check group_id directly and look the group up defensively.
    if not rule.group_id:
        raise ValidationError("Choose a group for this rule.")
    group = PricingGroup.objects.filter(pk=rule.group_id).first()
    if group is None:
        raise ValidationError("That pricing group no longer exists. Choose another.")
    if group.behaviour == group.Behaviour.STACK:
        return

    # Everything below applies to single-winner groups, where only one rule
    # ever runs. Stacking asks for several to combine, so the two cannot both
    # be true — and the engine resolves the winner BEFORE it builds the stack,
    # which would make the setting quietly do nothing.
    if rule.stacks:
        raise ValidationError(
            f"'{group.name}' applies only one rule, so nothing can stack in it. "
            "Move this rule to a group that applies every match."
        )

    others = group.rules.exclude(pk=rule.pk).values_list("application", flat=True)
    clashing = {a for a in others if a != rule.application}
    if clashing:
        raise ValidationError(
            f"The group '{group.name}' already holds "
            f"{'whole-stay' if rule.application == PricingRule.Application.PER_NIGHT else 'per-night'} "
            "rules. A group that applies only one rule must hold only one kind, "
            "so the winning rule is unambiguous. Move this rule to another group or "
            "make the group Stack."
        )
