"""Evaluate a stay against the configured pricing groups.

Two passes, both walking groups in ascending sort_order:

  Pass 1  per-night rules set each night's rate. A night touched by an
          is_final rule is locked once its group finishes.
  Pass 2  whole-stay rules adjust the sum of the UNLOCKED nights only.
          Locked nights rejoin the total untouched.

Ordering vocabulary: sort_order ascending. The numerically smallest value is
evaluated first and, in an Exclusive group, is the one that wins. There is no
"priority" field — do not introduce one.
"""

from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils.timezone import localdate

from ..models import PricingRule

CENTS = Decimal("0.01")
ZERO = Decimal("0")

APPLIED = "applied"
NOT_ELIGIBLE = "not_eligible"
OVERRIDDEN = "overridden"
LOCKED_OUT = "locked_out"
SKIPPED_INVALID = "skipped_invalid"


def _money(value):
    return Decimal(value).quantize(CENTS, ROUND_HALF_UP)


def _nights(check_in, check_out):
    return [check_in + timedelta(days=i) for i in range((check_out - check_in).days)]


def _match_scope(rule, property_obj):
    if rule.scope == PricingRule.Scope.ALL:
        return True
    if rule.scope == PricingRule.Scope.PROPERTY:
        return rule.property_id == property_obj.pk
    if rule.scope == PricingRule.Scope.BEDROOM_GROUP:
        return rule.bedroom_group == property_obj.bedrooms
    return False


def _covers_night(rule, night):
    if rule.start_date and night < rule.start_date:
        return False
    if rule.end_date and night > rule.end_date:
        return False
    return True


def apply_adjustment(rate, rule):
    """Return the rate after this rule's adjustment, floored at zero."""
    value = rule.adjustment_value
    kind = rule.adjustment_type
    A = PricingRule.AdjustmentType

    if kind == A.FIXED_PRICE:
        result = value
    elif kind == A.PCT_INCREASE:
        result = rate * (1 + value / 100)
    elif kind == A.PCT_DECREASE:
        result = rate * (1 - value / 100)
    elif kind == A.FIXED_INCREASE:
        result = rate + value
    elif kind == A.FIXED_DECREASE:
        result = rate - value
    else:
        result = rate

    return _money(max(result, ZERO))


def _stay_eligibility(rule, ctx):
    """Return (eligible, reason). Reason explains a refusal in plain words.

    Called by BOTH passes. Pass 1 calls it with ctx["subtotal"] set to None,
    because the subtotal is what pass 1 is computing; the only check that
    needs it is a promo's minimum spend, which validation restricts to
    whole-stay rules for exactly that reason.
    """
    T = PricingRule.RuleType

    # A whole-stay rule with a date window requires containment — the whole
    # stay must sit inside it. This applies to EVERY whole-stay type, not just
    # seasonal: a long-stay tier or last-minute rule configured for a season
    # must respect that season.
    if rule.application == PricingRule.Application.WHOLE_STAY:
        if rule.start_date and ctx["check_in"] < rule.start_date:
            return False, "stay starts before the rule's dates"
        if rule.end_date and ctx["check_out"] > rule.end_date:
            return False, "stay ends after the rule's dates"

    if rule.rule_type == T.SEASONAL:
        # A seasonal rule's eligibility IS its date window, and per-night rules
        # test that night by night. Applied to the whole stay it needs
        # containment instead, which the fallback at the end of this function
        # provides.
        if rule.application == PricingRule.Application.PER_NIGHT:
            return True, ""

    if rule.rule_type == T.LONG_STAY:
        if rule.min_nights and ctx["nights"] < rule.min_nights:
            return False, f"stay is {ctx['nights']} nights, rule needs {rule.min_nights}"
        return True, ""

    if rule.rule_type == T.LAST_MINUTE:
        if rule.days_before_checkin is None:
            return False, "no booking window set"
        if ctx["days_ahead"] > rule.days_before_checkin:
            return False, (
                f"check-in is {ctx['days_ahead']} days away, "
                f"rule needs {rule.days_before_checkin} or fewer"
            )
        return True, ""

    if rule.rule_type == T.NON_REFUNDABLE:
        return (True, "") if ctx["is_non_refundable"] else (False, "not a non-refundable booking")

    if rule.rule_type == T.MANUAL:
        return (
            (True, "") if str(rule.pk) in ctx["manual_rule_ids"] else (False, "not selected by staff")
        )

    if rule.rule_type == T.PROMO:
        if ctx["promo_rule_id"] != rule.pk:
            return False, "code not entered"
        if rule.usage_limit is not None and rule.usage_count >= rule.usage_limit:
            return False, f"used {rule.usage_count} of {rule.usage_limit} times"
        if rule.min_nights and ctx["nights"] < rule.min_nights:
            return False, f"stay is {ctx['nights']} nights, code needs {rule.min_nights}"
        if (
            rule.min_subtotal_eur is not None
            and ctx["subtotal"] is not None
            and ctx["subtotal"] < rule.min_subtotal_eur
        ):
            return False, f"subtotal is {ctx['subtotal']}, code needs {rule.min_subtotal_eur}"
        # A promo's validity dates need no check here: promo rules are always
        # whole-stay, so the containment check at the top already applied them.
        return True, ""

    return True, ""


def _report(rule, status, reason="", amount=ZERO):
    return {
        "id": str(rule.pk),
        "name": rule.name or _auto_name(rule),
        "type": rule.rule_type,
        "group": rule.group.name if rule.group_id else "",
        "application": rule.application,
        "status": status,
        "reason": reason,
        "amount": _money(amount),
    }


def _tidy(value):
    """Render a Decimal for display: 50.00 -> '50', 12.50 -> '12.5'.

    NOT Decimal.normalize(), which renders 50.00 as 5E+1.
    """
    text = f"{value:f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def _auto_name(rule):
    """Legacy rows have no name. Build a readable one; never store it."""
    label = rule.get_rule_type_display()
    value = rule.adjustment_value
    if value is None:
        return label
    if rule.adjustment_type == PricingRule.AdjustmentType.FIXED_PRICE:
        return f"{label} — {_tidy(value)}€ per night"
    if rule.adjustment_type in (
        PricingRule.AdjustmentType.PCT_DECREASE,
        PricingRule.AdjustmentType.PCT_INCREASE,
    ):
        sign = "−" if rule.adjustment_type == PricingRule.AdjustmentType.PCT_DECREASE else "+"
        return f"{label} {sign}{_tidy(value)}%"
    sign = "−" if rule.adjustment_type == PricingRule.AdjustmentType.FIXED_DECREASE else "+"
    return f"{label} {sign}{_tidy(value)}€"


def _load_rules():
    return list(
        PricingRule.objects.filter(enabled=True, group__isnull=False)
        .select_related("group", "property")
        # pk is the last resort: two rules written in the same microsecond
        # would otherwise tie on created_at too and resolve by database whim.
        .order_by("group__sort_order", "sort_order", "created_at", "pk")
    )


def evaluate_stay(
    property_obj,
    check_in,
    check_out,
    *,
    is_non_refundable=False,
    promo_rule=None,
    manual_rule_ids=(),
    today=None,
    rules=None,
):
    nights = _nights(check_in, check_out)
    night_count = len(nights)
    today = today or localdate()

    all_rules = _load_rules() if rules is None else list(rules)
    scoped = [r for r in all_rules if _match_scope(r, property_obj)]
    out_of_scope = [r for r in all_rules if r not in scoped]

    reports = {}
    for rule in out_of_scope:
        reports[rule.pk] = _report(rule, NOT_ELIGIBLE, "does not apply to this apartment")
    for rule in scoped:
        if rule.adjustment_value is None:
            reports[rule.pk] = _report(rule, SKIPPED_INVALID, "no amount set")

    groups = []
    for rule in scoped:
        if not groups or groups[-1][0].pk != rule.group_id:
            groups.append((rule.group, []))
        groups[-1][1].append(rule)

    # Built before pass 1 so per-night rules are eligibility-checked too: a
    # per-night manual or promo rule must not apply just because its dates
    # match. subtotal is unknown until pass 1 finishes, so it starts as None.
    ctx = {
        "nights": night_count,
        "days_ahead": max((check_in - today).days, 0),
        "is_non_refundable": is_non_refundable,
        "manual_rule_ids": {str(i) for i in manual_rule_ids},
        "promo_rule_id": promo_rule.pk if promo_rule else None,
        "subtotal": None,
        "check_in": check_in,
        "check_out": check_out,
    }

    # ── Pass 1: nightly rates ────────────────────────────────────────────
    base = property_obj.base_price_eur
    rows = [
        {"date": night, "rate": _money(base), "locked": False, "rule_ids": []}
        for night in nights
    ]
    has_seasonal = False

    for group, group_rules in groups:
        candidates = [
            r
            for r in group_rules
            if r.application == PricingRule.Application.PER_NIGHT
            and r.adjustment_value is not None
        ]
        per_night = []
        for rule in candidates:
            ok, reason = _stay_eligibility(rule, ctx)
            if ok:
                per_night.append(rule)
            else:
                reports[rule.pk] = _report(rule, NOT_ELIGIBLE, reason)
        if not per_night:
            continue

        newly_locked = set()
        for index, row in enumerate(rows):
            if row["locked"]:
                for rule in per_night:
                    if _covers_night(rule, row["date"]):
                        reports.setdefault(
                            rule.pk, _report(rule, LOCKED_OUT, "night already price-locked")
                        )
                continue

            eligible = [r for r in per_night if _covers_night(r, row["date"])]
            if not eligible:
                continue

            if group.behaviour == group.Behaviour.EXCLUSIVE:
                for rule in eligible[1:]:
                    reports.setdefault(
                        rule.pk,
                        _report(rule, OVERRIDDEN, f"'{eligible[0].name or _auto_name(eligible[0])}' won this night"),
                    )
                eligible = eligible[:1]

            before = row["rate"]
            for rule in eligible:
                row["rate"] = apply_adjustment(row["rate"], rule)
                row["rule_ids"].append(str(rule.pk))
                if rule.rule_type == PricingRule.RuleType.SEASONAL:
                    has_seasonal = True
                if rule.is_final:
                    newly_locked.add(index)
                previous = reports.get(rule.pk)
                amount = (previous["amount"] if previous and previous["status"] == APPLIED else ZERO)
                reports[rule.pk] = _report(rule, APPLIED, amount=amount + (row["rate"] - before))
                before = row["rate"]

        for index in newly_locked:
            rows[index]["locked"] = True

    subtotal = _money(sum(row["rate"] for row in rows))
    protected = _money(sum(row["rate"] for row in rows if row["locked"]))
    discountable = _money(subtotal - protected)

    # ── Pass 2: whole-stay adjustments ───────────────────────────────────
    ctx["subtotal"] = subtotal  # now known, so promo minimum-spend can be checked
    amount_by_type = {}
    pct_by_type = {}
    largest_by_type = {}

    for group, group_rules in groups:
        whole = [
            r
            for r in group_rules
            if r.application == PricingRule.Application.WHOLE_STAY
            and r.adjustment_value is not None
        ]
        if not whole:
            continue

        eligible = []
        for rule in whole:
            ok, reason = _stay_eligibility(rule, ctx)
            if ok:
                eligible.append(rule)
            else:
                reports[rule.pk] = _report(rule, NOT_ELIGIBLE, reason)

        if group.behaviour == group.Behaviour.EXCLUSIVE and eligible:
            for rule in eligible[1:]:
                reports[rule.pk] = _report(
                    rule, OVERRIDDEN, f"'{eligible[0].name or _auto_name(eligible[0])}' won"
                )
            eligible = eligible[:1]

        for rule in eligible:
            if discountable <= ZERO:
                reports[rule.pk] = _report(rule, APPLIED, "all nights price-locked", ZERO)
                continue
            before = discountable
            discountable = apply_adjustment(discountable, rule)
            taken = before - discountable
            reports[rule.pk] = _report(rule, APPLIED, amount=taken)
            amount_by_type[rule.rule_type] = amount_by_type.get(rule.rule_type, ZERO) + taken

            # The legacy breakdown carries one percentage per discount type.
            # When several rules of a type stack, report the percentage of the
            # one that moved the most money.
            if abs(taken) >= abs(largest_by_type.get(rule.rule_type, ZERO)):
                largest_by_type[rule.rule_type] = abs(taken)
                is_pct = rule.adjustment_type in (
                    PricingRule.AdjustmentType.PCT_DECREASE,
                    PricingRule.AdjustmentType.PCT_INCREASE,
                )
                pct_by_type[rule.rule_type] = _money(
                    rule.adjustment_value if is_pct else (taken / before * 100 if before else ZERO)
                )

    total = _money(max(discountable, ZERO) + protected)

    return {
        "nightly": rows,
        "subtotal": subtotal,
        "protected": protected,
        "discountable": _money(max(discountable, ZERO)),
        "total": total,
        "has_seasonal": has_seasonal,
        "amount_by_type": amount_by_type,
        "pct_by_type": pct_by_type,
        "reports": [reports[r.pk] for r in all_rules if r.pk in reports],
    }
