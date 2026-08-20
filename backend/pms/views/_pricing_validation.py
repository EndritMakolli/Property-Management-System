"""Save-time checks that keep the rule set free of contradictions the engine
would otherwise have to guess its way through."""

from django.core.exceptions import ValidationError

from ..models import PricingRule


def validate_pricing_rule(rule):
    """Raise ValidationError if the rule cannot be evaluated unambiguously."""
    per_night = rule.application == PricingRule.Application.PER_NIGHT

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

    if rule.scope == PricingRule.Scope.PROPERTY and not rule.property_id:
        raise ValidationError("Choose a property for a property-scoped rule.")
    if rule.scope == PricingRule.Scope.BEDROOM_GROUP and rule.bedroom_group is None:
        raise ValidationError("Choose a bedroom count for a bedroom-group rule.")

    if rule.enabled and rule.adjustment_value is None:
        raise ValidationError("Set an amount or percentage for this rule.")

    _validate_group_consistency(rule)


def _validate_group_consistency(rule):
    """In an Exclusive group, 'the first eligible rule wins' only has one
    meaning if every rule competes on the same footing — all per-night or all
    whole-stay. Stack groups may mix freely."""
    group = rule.group
    if group is None or group.behaviour != group.Behaviour.EXCLUSIVE:
        return

    others = group.rules.exclude(pk=rule.pk).values_list("application", flat=True)
    clashing = {a for a in others if a != rule.application}
    if clashing:
        raise ValidationError(
            f"The Exclusive group '{group.name}' already holds "
            f"{'whole-stay' if rule.application == PricingRule.Application.PER_NIGHT else 'per-night'} "
            "rules. An Exclusive group must hold only one kind, so the first "
            "eligible rule is unambiguous. Move this rule to another group or "
            "make the group Stack."
        )
