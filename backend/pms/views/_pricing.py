"""The single entry point for money. Everything about *which* rules apply and
*how* they interact lives in _pricing_engine; this module owns the public
signature, the minimum-stay check, and the breakdown's on-the-wire shape."""

from decimal import ROUND_HALF_UP, Decimal

from ..models import PricingRule, StayConstraint
from ._pricing_engine import CENTS, base_rate_for, evaluate_stay

ZERO = Decimal("0")


def _money(value):
    return Decimal(value).quantize(CENTS, ROUND_HALF_UP)


def _min_nights_required(property_obj, check_in, check_out):
    """Return the applicable minimum-nights requirement (0 = no minimum).
    Most-specific scope wins, exactly as the old PricingRule version did."""
    scope_rank = {"property": 2, "bedroom_group": 1, "all": 0}
    best = 0
    best_rank = -1

    constraints = StayConstraint.objects.filter(
        kind=StayConstraint.Kind.MIN_NIGHTS,
        enabled=True,
        # A minimum written for apartments must not gate a vehicle hire.
        platform=property_obj.platform,
    ).select_related("property")

    for c in constraints:
        if c.scope == "property" and c.property_id != property_obj.pk:
            continue
        if c.scope == "bedroom_group" and c.bedroom_group != property_obj.bedrooms:
            continue
        if c.start_date and check_in < c.start_date:
            continue
        if c.end_date and check_out > c.end_date:
            continue
        rank = scope_rank.get(c.scope, 0)
        if c.value and (rank > best_rank or c.value > best):
            best = c.value
            best_rank = rank

    return best


def _latest_bookable_date(property_obj):
    """The last date this property may be booked to, or None for no limit.

    Most specific scope wins, so a per-property date overrides a general one.
    Among constraints of equal specificity the EARLIEST wins: two limits both
    claiming to close the calendar should close it at the tighter of the two,
    never the looser.
    """
    scope_rank = {"property": 2, "bedroom_group": 1, "all": 0}
    best = None
    best_rank = -1

    constraints = StayConstraint.objects.filter(
        kind=StayConstraint.Kind.MAX_ADVANCE,
        enabled=True,
        end_date__isnull=False,
        platform=property_obj.platform,
    ).select_related("property")

    for c in constraints:
        if c.scope == "property" and c.property_id != property_obj.pk:
            continue
        if c.scope == "bedroom_group" and c.bedroom_group != property_obj.bedrooms:
            continue
        rank = scope_rank.get(c.scope, 0)
        if rank > best_rank or (rank == best_rank and (best is None or c.end_date < best)):
            best = c.end_date
            best_rank = rank

    return best


def resolve_promo_rule(code, property_obj, check_in, check_out):
    """Look up a promo rule and check everything knowable before pricing.

    Returns (rule, error). The stay-dependent checks the engine owns — the
    minimum subtotal — are NOT done here; the engine reports those itself.
    """
    code = (code or "").strip().upper()
    if not code:
        return None, ""

    rule = (
        PricingRule.objects.filter(
            rule_type=PricingRule.RuleType.PROMO, enabled=True, code=code
        )
        .select_related("group", "property")
        .first()
    )
    if rule is None:
        return None, "That promo code is not valid."
    if rule.usage_limit is not None and rule.usage_count >= rule.usage_limit:
        return None, "That promo code has reached its usage limit."
    if rule.scope == PricingRule.Scope.PROPERTY and rule.property_id != property_obj.pk:
        return None, "That promo code does not apply to this apartment."
    if rule.scope == PricingRule.Scope.BEDROOM_GROUP and rule.bedroom_group != property_obj.bedrooms:
        return None, "That promo code does not apply to this apartment."
    if rule.start_date and check_in < rule.start_date:
        return None, "That promo code is not valid for these dates."
    if rule.end_date and check_out > rule.end_date:
        return None, "That promo code is not valid for these dates."
    if rule.min_nights and (check_out - check_in).days < rule.min_nights:
        return None, f"That promo code needs a stay of at least {rule.min_nights} nights."

    return rule, ""


def calculate_price(
    property_obj,
    check_in,
    check_out,
    is_non_refundable=False,
    promo_rule=None,
    manual_rule_ids=(),
    *,
    public=False,
):
    """Full price breakdown for a stay. Callers must check breakdown["errors"]
    before accepting a booking.

    public=True strips staff diagnostics that must never reach an
    unauthenticated caller: a rule that did not apply (its name, reason,
    type, group, application and status) and the per-night lock/rule-id
    detail. Without this, an anonymous property listing or search leaks the
    entire pricing configuration — including the literal code of promo rules
    that were not entered (named "Promo <CODE>" since the 0028 migration),
    and manual staff-discount rules scoped to other properties. Every
    unauthenticated call site in _booking_public.py must pass public=True;
    staff-only call sites (behind require_roles) keep the full output."""
    nights = (check_out - check_in).days
    result = evaluate_stay(
        property_obj,
        check_in,
        check_out,
        is_non_refundable=is_non_refundable,
        promo_rule=promo_rule,
        manual_rule_ids=manual_rule_ids,
    )

    errors = []
    min_nights = _min_nights_required(property_obj, check_in, check_out)
    if min_nights and nights < min_nights:
        errors.append(f"Minimum stay is {min_nights} nights.")

    latest_bookable = _latest_bookable_date(property_obj)
    if latest_bookable and check_out > latest_bookable:
        errors.append(
            f"Bookings are open until {latest_bookable.isoformat()}."
        )

    # A night no rule ever touched has no price. Since Property.base_price_eur
    # was removed there is nothing to fall back on, and quoting such a stay
    # would hand the guest a free night, so refuse it instead.
    if any(not row["priced"] for row in result["nightly"]):
        # Same refusal, told to the right audience: a guest learns the stay
        # cannot be booked, staff learn where to fix it. Naming the admin
        # screen to an anonymous caller describes internal structure.
        errors.append(
            "These dates are not available for this apartment."
            if public
            else "No base price covers these dates. Add one under Base Prices on the pricing page."
        )

    amounts = result["amount_by_type"]
    pcts = result["pct_by_type"]
    T = PricingRule.RuleType

    def amount(rule_type):
        return str(_money(amounts.get(rule_type, ZERO)))

    def pct(rule_type):
        return str(pcts[rule_type]) if rule_type in pcts else "0"

    effective_nightly = _money(result["subtotal"] / nights) if nights else ZERO
    average_nightly = _money(result["total"] / nights) if nights else ZERO

    if public:
        nightly_breakdown = [
            {"date": row["date"].isoformat(), "rate": str(row["rate"])}
            for row in result["nightly"]
        ]
        rules = [
            {"id": report["id"], "name": report["name"], "amount": str(report["amount"])}
            for report in result["reports"]
            if report["status"] == "applied"
        ]
    else:
        nightly_breakdown = [
            {
                "date": row["date"].isoformat(),
                "rate": str(row["rate"]),
                "locked": row["locked"],
                "ruleIds": row["rule_ids"],
            }
            for row in result["nightly"]
        ]
        rules = [
            {**report, "amount": str(report["amount"])} for report in result["reports"]
        ]

    return {
        # Derived from the Base Prices group now that the property has no
        # price of its own. Still the rate before anything adjusts it.
        "base_nightly": str(base_rate_for(property_obj)),
        "effective_nightly": str(effective_nightly),
        "has_seasonal": result["has_seasonal"],
        "subtotal": str(result["subtotal"]),
        "long_stay_pct": pct(T.LONG_STAY),
        "long_stay_amount": amount(T.LONG_STAY),
        "last_minute_pct": pct(T.LAST_MINUTE),
        "last_minute_amount": amount(T.LAST_MINUTE),
        "non_refundable_pct": pct(T.NON_REFUNDABLE),
        "non_refundable_amount": amount(T.NON_REFUNDABLE),
        "promo_amount": amount(T.PROMO),
        "total": str(result["total"]),
        # Deprecated: this was never the first night's price after the engine
        # became per-night. Read average_nightly_rate instead.
        "first_night_price": str(average_nightly),
        "average_nightly_rate": str(average_nightly),
        "protected_total": str(result["protected"]),
        "nights": nights,
        "min_nights_required": min_nights,
        "latest_bookable_date": latest_bookable.isoformat() if latest_bookable else None,
        "errors": errors,
        "nightly_breakdown": nightly_breakdown,
        "rules": rules,
    }
