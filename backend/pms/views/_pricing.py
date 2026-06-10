from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from ..models import BookingSiteSettings, PricingRule


CENTS = Decimal("0.01")

# Built-in long-stay discount tiers (nights → pct).
# These are the defaults; staff can override via PricingRule.
_DEFAULT_LONG_STAY_TIERS = [
    (28, Decimal("50")),
    (21, Decimal("35")),
    (14, Decimal("25")),
    (10, Decimal("20")),
    (7,  Decimal("15")),
    (5,  Decimal("10")),
]


def _match_scope(rule, property_obj):
    """Return True if the pricing/promo rule applies to the given property."""
    if rule.scope == "all":
        return True
    if rule.scope == "property":
        return rule.property_id == property_obj.pk
    if rule.scope == "bedroom_group":
        return rule.bedroom_group == property_obj.bedrooms
    return False


def _seasonal_nightly(property_obj, check_in, check_out):
    """
    Find the most-specific seasonal PricingRule covering the stay.
    Returns (effective_nightly, adjustment_label) where adjustment_label may be empty.
    Prefers property-scoped rules over bedroom-group, then all.
    """
    base = property_obj.base_price_eur

    candidate = None
    candidate_scope_rank = -1
    scope_rank = {"property": 2, "bedroom_group": 1, "all": 0}

    seasonal_rules = PricingRule.objects.filter(
        rule_type=PricingRule.RuleType.SEASONAL,
        enabled=True,
        start_date__lte=check_in,
        end_date__gte=check_out - __import__("datetime").timedelta(days=1),
    ).select_related("property")

    for rule in seasonal_rules:
        if not _match_scope(rule, property_obj):
            continue
        rank = scope_rank.get(rule.scope, 0)
        if rank > candidate_scope_rank:
            candidate = rule
            candidate_scope_rank = rank

    if not candidate or candidate.adjustment_value is None:
        return base, ""

    v = candidate.adjustment_value
    adj = candidate.adjustment_type

    if adj == PricingRule.AdjustmentType.FIXED_PRICE:
        return v.quantize(CENTS, ROUND_HALF_UP), "seasonal"
    if adj == PricingRule.AdjustmentType.PCT_INCREASE:
        return (base * (1 + v / 100)).quantize(CENTS, ROUND_HALF_UP), "seasonal"
    if adj == PricingRule.AdjustmentType.PCT_DECREASE:
        return (base * (1 - v / 100)).quantize(CENTS, ROUND_HALF_UP), "seasonal"
    if adj == PricingRule.AdjustmentType.FIXED_INCREASE:
        return (base + v).quantize(CENTS, ROUND_HALF_UP), "seasonal"
    if adj == PricingRule.AdjustmentType.FIXED_DECREASE:
        return max(base - v, Decimal("0")).quantize(CENTS, ROUND_HALF_UP), "seasonal"

    return base, ""


def _long_stay_discount_pct(property_obj, nights):
    """Return the highest applicable long-stay discount percentage."""
    # Check for custom long-stay rules (most-specific scope wins).
    db_rules = PricingRule.objects.filter(
        rule_type=PricingRule.RuleType.LONG_STAY,
        enabled=True,
        min_nights__lte=nights,
    ).select_related("property").order_by("-min_nights")

    best_pct = Decimal("0")
    best_scope_rank = -1
    scope_rank = {"property": 2, "bedroom_group": 1, "all": 0}

    for rule in db_rules:
        if not _match_scope(rule, property_obj):
            continue
        rank = scope_rank.get(rule.scope, 0)
        if rule.discount_pct and (rank > best_scope_rank or rule.discount_pct > best_pct):
            best_pct = rule.discount_pct
            best_scope_rank = rank

    if best_pct > 0:
        return best_pct

    # Fall back to built-in default tiers.
    for min_n, pct in _DEFAULT_LONG_STAY_TIERS:
        if nights >= min_n:
            return pct

    return Decimal("0")


def _last_minute_discount_pct(property_obj, check_in):
    """Return the best last-minute discount percentage for the given check-in."""
    days_ahead = (check_in - date.today()).days
    if days_ahead < 0:
        days_ahead = 0

    db_rules = PricingRule.objects.filter(
        rule_type=PricingRule.RuleType.LAST_MINUTE,
        enabled=True,
        days_before_checkin__gte=days_ahead,
    ).select_related("property").order_by("-discount_pct")

    best_pct = Decimal("0")
    for rule in db_rules:
        if not _match_scope(rule, property_obj):
            continue
        if rule.discount_pct and rule.discount_pct > best_pct:
            best_pct = rule.discount_pct

    return best_pct


def _min_nights_required(property_obj, check_in, check_out):
    """Return the applicable minimum nights requirement (0 = no minimum)."""
    rules = PricingRule.objects.filter(
        rule_type=PricingRule.RuleType.MINIMUM_NIGHTS,
        enabled=True,
    ).select_related("property")

    best = 0
    best_scope_rank = -1
    scope_rank = {"property": 2, "bedroom_group": 1, "all": 0}

    for rule in rules:
        if not _match_scope(rule, property_obj):
            continue
        # Optional date-range filter
        if rule.start_date and check_in < rule.start_date:
            continue
        if rule.end_date and check_out > rule.end_date:
            continue
        rank = scope_rank.get(rule.scope, 0)
        if rule.min_nights and (rank > best_scope_rank or rule.min_nights > best):
            best = rule.min_nights
            best_scope_rank = rank

    return best


def _promo_discount(promo_code_obj, subtotal_after_discounts):
    """Return discount amount from a PromoCode object."""
    if promo_code_obj is None:
        return Decimal("0")
    if promo_code_obj.discount_type == "percentage":
        return (subtotal_after_discounts * promo_code_obj.discount_value / 100).quantize(CENTS, ROUND_HALF_UP)
    return min(promo_code_obj.discount_value, subtotal_after_discounts).quantize(CENTS, ROUND_HALF_UP)


def calculate_price(property_obj, check_in, check_out, is_non_refundable=False, promo_code_obj=None):
    """
    Calculate the full price breakdown for a stay.

    Returns a dict with all line items. Callers should check breakdown["errors"]
    before accepting the booking.
    """
    nights = (check_out - check_in).days
    errors = []

    # 1. Base nightly rate
    base_nightly = property_obj.base_price_eur

    # 2. Seasonal adjustment
    effective_nightly, seasonal_label = _seasonal_nightly(property_obj, check_in, check_out)

    # 3. Subtotal before discounts
    subtotal = (effective_nightly * nights).quantize(CENTS, ROUND_HALF_UP)

    # 4a. Long-stay discount
    long_stay_pct = _long_stay_discount_pct(property_obj, nights)
    long_stay_amount = (subtotal * long_stay_pct / 100).quantize(CENTS, ROUND_HALF_UP)

    # 4b. Last-minute discount (stacks on remaining after long-stay)
    after_long_stay = subtotal - long_stay_amount
    last_minute_pct = _last_minute_discount_pct(property_obj, check_in)
    last_minute_amount = (after_long_stay * last_minute_pct / 100).quantize(CENTS, ROUND_HALF_UP)

    # 4c. Non-refundable discount
    settings = BookingSiteSettings.get()
    non_refundable_pct = settings.non_refundable_discount_pct if is_non_refundable else Decimal("0")
    after_discounts = after_long_stay - last_minute_amount
    non_refundable_amount = (after_discounts * non_refundable_pct / 100).quantize(CENTS, ROUND_HALF_UP)

    # 4d. Promo code (stacks last)
    after_non_refundable = after_discounts - non_refundable_amount
    promo_amount = _promo_discount(promo_code_obj, after_non_refundable)

    total = (after_non_refundable - promo_amount).quantize(CENTS, ROUND_HALF_UP)
    total = max(total, Decimal("0"))

    # First-night price (based on effective nightly after same proportional discounts)
    first_night_price = effective_nightly
    if long_stay_pct:
        first_night_price = (first_night_price * (1 - long_stay_pct / 100)).quantize(CENTS, ROUND_HALF_UP)
    if last_minute_pct:
        first_night_price = (first_night_price * (1 - last_minute_pct / 100)).quantize(CENTS, ROUND_HALF_UP)
    if non_refundable_pct:
        first_night_price = (first_night_price * (1 - non_refundable_pct / 100)).quantize(CENTS, ROUND_HALF_UP)
    if promo_amount and nights > 0:
        first_night_price = max(first_night_price - promo_amount / nights, Decimal("0")).quantize(CENTS, ROUND_HALF_UP)

    # 5. Validate min-nights
    min_nights = _min_nights_required(property_obj, check_in, check_out)
    if min_nights and nights < min_nights:
        errors.append(f"Minimum stay is {min_nights} nights.")

    return {
        "base_nightly": str(base_nightly),
        "effective_nightly": str(effective_nightly),
        "has_seasonal": bool(seasonal_label),
        "subtotal": str(subtotal),
        "long_stay_pct": str(long_stay_pct),
        "long_stay_amount": str(long_stay_amount),
        "last_minute_pct": str(last_minute_pct),
        "last_minute_amount": str(last_minute_amount),
        "non_refundable_pct": str(non_refundable_pct),
        "non_refundable_amount": str(non_refundable_amount),
        "promo_amount": str(promo_amount),
        "total": str(total),
        "first_night_price": str(first_night_price),
        "nights": nights,
        "min_nights_required": min_nights,
        "errors": errors,
    }
