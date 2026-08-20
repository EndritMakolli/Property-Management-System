"""Staff pricing preview — "what would this stay cost, and why?".

This endpoint adds NO pricing maths. It composes the two functions that
already own the subject: resolve_promo_rule turns a typed code into a rule,
calculate_price prices the stay. Its whole job is to hand the pricing page
the staff-mode breakdown, which already carries a per-rule verdict (applied /
not_eligible / overridden / locked_out) with a plain-English reason.

It never passes public=True. That flag strips exactly the diagnostics this
page exists to show, and the role check below is what makes keeping them
safe — see calculate_price's docstring.
"""

from django.core.exceptions import ValidationError
from django.http import JsonResponse

from ..models import Property
from ._booking_public import _parse_date
from ._pricing import calculate_price, resolve_promo_rule
from ._pricing_rules_api import _serialize_quote
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._utils import json_payload


def pricing_preview(request):
    """POST — price one stay against the live rules and explain every rule."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        check_in = _parse_date(payload.get("checkIn"), "checkIn")
        check_out = _parse_date(payload.get("checkOut"), "checkOut")
    except (ValidationError, ValueError) as e:
        return JsonResponse({"error": str(e)}, status=400)

    if check_out <= check_in:
        return JsonResponse({"error": "Check-out must be after check-in."}, status=400)

    # A malformed id must read as "no such property", not as a 500: the UUID
    # field validates before the query runs and raises out of .filter().
    try:
        prop = Property.objects.filter(pk=payload.get("propertyId")).first()
    except (ValidationError, ValueError):
        prop = None
    if prop is None:
        return JsonResponse({"error": "Property not found."}, status=404)

    # A bad code must not cost the user their quote: the price is still worth
    # showing, with the code's own failure reported alongside it.
    promo_rule, promo_error = resolve_promo_rule(
        payload.get("promoCode"), prop, check_in, check_out
    )

    try:
        breakdown = calculate_price(
            prop,
            check_in,
            check_out,
            is_non_refundable=bool(payload.get("isNonRefundable")),
            promo_rule=promo_rule,
        )
    except (ValidationError, ValueError) as e:
        return JsonResponse({"error": str(e)}, status=400)

    return JsonResponse({
        "preview": _serialize_quote(breakdown),
        "promoError": promo_error or "",
    })
