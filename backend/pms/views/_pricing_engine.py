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

    if rule.rule_type == T.DATE_ADJUST:
        # Its eligibility is its date window, which _covers_night tests night
        # by night, exactly as for a per-night seasonal rule.
        return True, ""

    if rule.rule_type == T.BLOCK_DISCOUNTS:
        # Its whole eligibility is its date window, which _covers_night tests
        # per night, exactly as for a per-night seasonal rule.
        return True, ""

    if rule.rule_type == T.BASE_PRICE:
        # Always eligible: a base price is the rate every other rule works
        # from, and it carries no dates to test. Relies on nothing but the
        # per-night pass reaching it first, which group order guarantees.
        return True, ""

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


# Behaviours that apply exactly one rule from the group. STACK is absent: it
# applies all of them.
SINGLE_WINNER = frozenset({"exclusive", "best", "specific"})

# How narrowly a rule is aimed. Used by SPECIFIC, where a rule written for one
# apartment must beat one written for every apartment of that size, which in
# turn beats one written for everything.
_SCOPE_RANK = {
    PricingRule.Scope.PROPERTY: 2,
    PricingRule.Scope.BEDROOM_GROUP: 1,
    PricingRule.Scope.ALL: 0,
}


_PCT_TYPES = (
    PricingRule.AdjustmentType.PCT_INCREASE,
    PricingRule.AdjustmentType.PCT_DECREASE,
)


def _signed_pct(rule):
    """The rule's percentage as a signed number: +10 raises, -10 lowers."""
    if rule.adjustment_type == PricingRule.AdjustmentType.PCT_INCREASE:
        return rule.adjustment_value
    if rule.adjustment_type == PricingRule.AdjustmentType.PCT_DECREASE:
        return -rule.adjustment_value
    return ZERO


def _stacks_additively(rule):
    """Whether this rule joins the additive stack rather than compounding.

    Only percentages: adding two fixed amounts and applying them one after the
    other give the same answer, so there is nothing to change for those.
    """
    return (
        rule.stacks
        and rule.adjustment_type in _PCT_TYPES
        and rule.adjustment_value is not None
    )


def _is_blocked(rule, blocks):
    """Whether a night's blocks fence this whole-stay rule out of it.

    `blocks` holds (group_id, rule_id) pairs recorded in pass 1, one per
    BLOCK_DISCOUNTS rule that named a target. A block naming nothing does not
    appear here at all — it locks the night outright.
    """
    for group_id, rule_id in blocks:
        if group_id is not None and rule_id is None and rule.group_id == group_id:
            return True
        if rule_id is not None and rule.pk == rule_id:
            return True
    return False


def _spread(amounts, indexes, before, after):
    """Scale the named nights so their amounts sum to exactly `after`.

    Proportional, with the last night absorbing the rounding remainder: nine
    nights each rounded independently would not add back up to the total the
    guest is quoted.
    """
    if not indexes or before <= ZERO:
        return
    running = ZERO
    for position, index in enumerate(indexes):
        if position == len(indexes) - 1:
            amounts[index] = _money(max(after - running, ZERO))
        else:
            share = _money(amounts[index] * after / before)
            amounts[index] = share
            running += share


def _single_winner(group, eligible, rate_of):
    """Return (winner, losers) for a group that applies only one rule.

    EXCLUSIVE picks by hand-maintained order. BEST picks by outcome — the rule
    that takes the most money off — so a tier ladder behaves correctly no
    matter how it is sorted. SPECIFIC picks by aim, so a per-apartment rate
    beats a per-bedroom-count one.

    `rate_of` is a callable because in pass 2 each candidate can have a
    different base: a block may fence some nights off from one rule and not
    another, so there is no single number to compare them against.

    Every branch breaks ties on the rule's position in `eligible`, which is
    already in sort_order. Without that, two equal candidates would resolve by
    whichever `min` happened to see first, and a price could change between
    identical requests.
    """
    def reduction(rule):
        base = rate_of(rule)
        return base - apply_adjustment(base, rule)

    if group.behaviour == group.Behaviour.BEST:
        ranked = min(enumerate(eligible), key=lambda pair: (-reduction(pair[1]), pair[0]))
    elif group.behaviour == group.Behaviour.SPECIFIC:
        ranked = min(enumerate(eligible), key=lambda pair: (-_SCOPE_RANK.get(pair[1].scope, 0), pair[0]))
    else:
        ranked = (0, eligible[0])
    winner = ranked[1]
    return winner, [rule for rule in eligible if rule is not winner]


def _lost_reason(group, winner, per_night=False):
    """Why a rule lost, phrased so it explains the group's behaviour too."""
    name = winner.name or _auto_name(winner)
    if group.behaviour == group.Behaviour.BEST:
        return f"'{name}' gives a lower price"
    if group.behaviour == group.Behaviour.SPECIFIC:
        return f"'{name}' is aimed more narrowly"
    return f"'{name}' won this night" if per_night else f"'{name}' won"


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


def _load_rules(platform=None):
    """Every enabled rule, optionally only those belonging to one platform.

    The platform filter is what keeps AirStay and Fleet apart: their rules
    live in separate groups, and pricing an apartment must never load the
    groups written for vehicles.
    """
    queryset = PricingRule.objects.filter(enabled=True, group__isnull=False)
    if platform is not None:
        queryset = queryset.filter(group__platform=platform)
    return list(
        queryset
        .select_related("group", "property")
        # group_id immediately after group__sort_order: PricingGroup.sort_order
        # has no unique constraint and the create endpoint defaults it to 0,
        # so two groups can share a value. Without group_id as a tiebreak here,
        # their rules interleave by the per-rule sort_order below, and
        # evaluate_stay's group-by-group_id bucketing (see below) would still
        # process them correctly, but keeping rows already contiguous by
        # group is what makes that bucketing a no-op in the common case.
        # pk is the last resort: two rules written in the same microsecond
        # would otherwise tie on created_at too and resolve by database whim.
        .order_by("group__sort_order", "group_id", "sort_order", "created_at", "pk")
    )


def base_rate_for(property_obj, rules=None):
    """The nightly rate this property starts from, or zero if none is set.

    Property.base_price_eur used to hold this. Two places owning one number
    meant the pricing page could not actually control the rate it displayed,
    so the column is gone and the Base Prices group is the only source.

    Resolves the same way the Base Prices group does — most specific wins —
    so a listing can show a rate without pricing a whole stay. Zero is a real
    answer here, meaning "unpriced"; calculate_price turns it into an error
    rather than letting a stay quote for nothing.
    """
    candidates = [
        rule
        for rule in (_load_rules(property_obj.platform) if rules is None else rules)
        if rule.rule_type == PricingRule.RuleType.BASE_PRICE
        and rule.adjustment_value is not None
        and _match_scope(rule, property_obj)
    ]
    if not candidates:
        return ZERO
    winner = min(
        enumerate(candidates),
        key=lambda pair: (-_SCOPE_RANK.get(pair[1].scope, 0), pair[0]),
    )[1]
    return _money(winner.adjustment_value)


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

    all_rules = _load_rules(property_obj.platform) if rules is None else list(rules)
    scoped = [r for r in all_rules if _match_scope(r, property_obj)]
    out_of_scope = [r for r in all_rules if r not in scoped]

    reports = {}
    for rule in out_of_scope:
        reports[rule.pk] = _report(rule, NOT_ELIGIBLE, "does not apply to this apartment")
    for rule in scoped:
        if rule.adjustment_value is None:
            reports[rule.pk] = _report(rule, SKIPPED_INVALID, "no amount set")

    # Keyed by group_id, not adjacency: PricingGroup.sort_order has no unique
    # constraint (the create endpoint defaults it to 0), so two groups can tie
    # and their rules can interleave in `scoped`. Bucketing by "did the group
    # change from the previous rule" would then split one group into several
    # fragments, each treated as its own independent Exclusive/Stack group —
    # letting an Exclusive group apply more than one rule (one winner per
    # fragment) and locking is_final nights per fragment instead of per group.
    groups_by_id = {}
    group_order = []
    for rule in scoped:
        if rule.group_id not in groups_by_id:
            groups_by_id[rule.group_id] = (rule.group, [])
            group_order.append(rule.group_id)
        groups_by_id[rule.group_id][1].append(rule)
    groups = [groups_by_id[gid] for gid in group_order]

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
    # Every night starts at nothing. A night still sitting at zero with no
    # rule attached when pass 1 ends is unpriced, not free — calculate_price
    # reports that as an error rather than quoting it.
    rows = [
        {
            "date": night,
            "rate": ZERO,
            "locked": False,
            "priced": False,
            "blocks": [],
            "rule_ids": [],
        }
        for night in nights
    ]
    has_seasonal = False

    for group, group_rules in groups:
        candidates = [
            r
            for r in group_rules
            if r.application == PricingRule.Application.PER_NIGHT
            # A block carries no amount by design, so it is admitted without
            # one; everything else still needs a value to do anything.
            and (
                r.adjustment_value is not None
                or r.rule_type == PricingRule.RuleType.BLOCK_DISCOUNTS
            )
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

            if group.behaviour in SINGLE_WINNER:
                winner, losers = _single_winner(group, eligible, lambda _r: row["rate"])
                for rule in losers:
                    reports.setdefault(
                        rule.pk, _report(rule, OVERRIDDEN, _lost_reason(group, winner, per_night=True))
                    )
                eligible = [winner]

            # Stacking percentages are held back and applied together, once,
            # so they add instead of compounding. Everything else applies in
            # order exactly as before.
            stacking = [r for r in eligible if _stacks_additively(r)]
            sequential = [r for r in eligible if r not in stacking]

            before = row["rate"]
            for rule in sequential:
                if rule.rule_type == PricingRule.RuleType.BLOCK_DISCOUNTS:
                    # Protects the night without touching its price, and does
                    # not count as pricing it — see row["priced"] below.
                    if rule.blocks_group_id or rule.blocks_rule_id:
                        # Named target: fence off only that, leaving the night
                        # reachable by every other whole-stay rule.
                        row["blocks"].append((rule.blocks_group_id, rule.blocks_rule_id))
                    else:
                        newly_locked.add(index)
                    row["rule_ids"].append(str(rule.pk))
                    reports[rule.pk] = _report(rule, APPLIED)
                    continue
                row["rate"] = apply_adjustment(row["rate"], rule)
                row["rule_ids"].append(str(rule.pk))
                row["priced"] = True
                if rule.rule_type in (
                    PricingRule.RuleType.SEASONAL,
                    PricingRule.RuleType.DATE_ADJUST,
                ):
                    has_seasonal = True
                if rule.is_final:
                    newly_locked.add(index)
                previous = reports.get(rule.pk)
                amount = (previous["amount"] if previous and previous["status"] == APPLIED else ZERO)
                reports[rule.pk] = _report(rule, APPLIED, amount=amount + (row["rate"] - before))
                before = row["rate"]

            if stacking:
                total_pct = sum(_signed_pct(r) for r in stacking)
                start = row["rate"]
                row["rate"] = _money(max(start * (1 + total_pct / 100), ZERO))
                row["priced"] = True
                moved = row["rate"] - start

                # Split what moved between the rules in proportion to their
                # own percentages, with the last absorbing the rounding so the
                # reported shares add back up to the change in the rate.
                credited = ZERO
                for position, rule in enumerate(stacking):
                    if position == len(stacking) - 1 or not total_pct:
                        share = moved - credited
                    else:
                        share = _money(moved * _signed_pct(rule) / total_pct)
                        credited += share
                    row["rule_ids"].append(str(rule.pk))
                    if rule.rule_type in (
                        PricingRule.RuleType.SEASONAL,
                        PricingRule.RuleType.DATE_ADJUST,
                    ):
                        has_seasonal = True
                    if rule.is_final:
                        newly_locked.add(index)
                    previous = reports.get(rule.pk)
                    running = (
                        previous["amount"]
                        if previous and previous["status"] == APPLIED
                        else ZERO
                    )
                    reports[rule.pk] = _report(rule, APPLIED, amount=running + share)

        for index in newly_locked:
            rows[index]["locked"] = True

    subtotal = _money(sum(row["rate"] for row in rows))
    protected = _money(sum(row["rate"] for row in rows if row["locked"]))
    discountable = _money(subtotal - protected)

    # ── Pass 2: whole-stay adjustments ───────────────────────────────────
    # Carried per night rather than as one running total: a block may fence a
    # night off from one rule while leaving it open to the next, so "what is
    # still discountable" is a different number for different rules.
    ctx["subtotal"] = subtotal  # now known, so promo minimum-spend can be checked
    amounts = [row["rate"] for row in rows]
    amount_by_type = {}
    pct_by_type = {}
    largest_by_type = {}

    def reachable(rule):
        """Night indexes this whole-stay rule is still allowed to discount."""
        return [
            index
            for index, row in enumerate(rows)
            if not row["locked"] and not _is_blocked(rule, row["blocks"])
        ]

    def base_of(indexes):
        return _money(sum(amounts[index] for index in indexes))

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

        if group.behaviour in SINGLE_WINNER and eligible:
            winner, losers = _single_winner(
                group, eligible, lambda r: base_of(reachable(r))
            )
            for rule in losers:
                reports[rule.pk] = _report(rule, OVERRIDDEN, _lost_reason(group, winner))
            eligible = [winner]

        for rule in eligible:
            reach = reachable(rule)
            before = base_of(reach)
            if before <= ZERO:
                reports[rule.pk] = _report(
                    rule,
                    APPLIED,
                    "no nights left to discount — they are price-locked or excluded",
                    ZERO,
                )
                continue
            after = apply_adjustment(before, rule)
            _spread(amounts, reach, before, after)
            taken = before - after
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

    total = _money(sum(amounts))
    protected = _money(sum(amounts[i] for i, row in enumerate(rows) if row["locked"]))
    discountable = _money(total - protected)

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
