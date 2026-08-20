"""Staff CRUD + reorder for the unified pricing model: PricingGroup,
PricingRule and StayConstraint. Follows the exact conventions of
_booking_pms.py — require_roles first, json_payload(request) for the body,
JsonResponse, 201 on create, 204 on delete, 400 on ValidationError/ValueError,
405 on a wrong method."""

from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse

from ..models import PricingGroup, PricingRule, Property, StayConstraint
from ._booking_public import _parse_date
from ._pricing import calculate_price
from ._pricing_engine import base_rate_for
from ._pricing_validation import validate_pricing_rule
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._utils import json_payload


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _request_platform(request, payload=None):
    """The platform a pricing request belongs to, defaulting to AirStay.

    AirStay and Fleet keep separate rule sets, so every pricing endpoint has
    to know which one it is talking about. Matches how the property endpoints
    already read `?platform=`.
    """
    # Body first, then the query string: a POST carries `?platform=` from the
    # page it was made on, and may also name the platform explicitly.
    raw = (payload or {}).get("platform") or request.GET.get("platform")
    value = (raw or "").strip()
    return value if value in Property.Platform.values else Property.Platform.AIRSTAY


def _serialize_pricing_group(group):
    return {
        "id": str(group.id),
        "platform": group.platform,
        "name": group.name,
        "sortOrder": group.sort_order,
        "behaviour": group.behaviour,
        "ruleCount": group.rules.count(),
    }


def _serialize_pricing_rule(rule):
    return {
        "id": str(rule.id),
        "name": rule.name,
        "groupId": str(rule.group_id) if rule.group_id else None,
        "sortOrder": rule.sort_order,
        "application": rule.application,
        "isFinal": rule.is_final,
        "stacks": rule.stacks,
        # What a discount-exclusion rule fences off. Both null means all of it.
        "blocksGroupId": str(rule.blocks_group_id) if rule.blocks_group_id else None,
        "blocksRuleId": str(rule.blocks_rule_id) if rule.blocks_rule_id else None,
        "code": rule.code,
        "usageLimit": rule.usage_limit,
        "usageCount": rule.usage_count,
        "minSubtotalEur": str(rule.min_subtotal_eur) if rule.min_subtotal_eur is not None else None,
        "ruleType": rule.rule_type,
        "scope": rule.scope,
        "propertyId": str(rule.property_id) if rule.property_id else None,
        "bedroomGroup": rule.bedroom_group,
        "enabled": rule.enabled,
        "minNights": rule.min_nights,
        "daysBeforeCheckin": rule.days_before_checkin,
        "startDate": rule.start_date.isoformat() if rule.start_date else None,
        "endDate": rule.end_date.isoformat() if rule.end_date else None,
        "adjustmentType": rule.adjustment_type or "",
        "adjustmentValue": str(rule.adjustment_value) if rule.adjustment_value is not None else None,
        "createdAt": rule.created_at.isoformat(),
    }


def _serialize_stay_constraint(constraint):
    return {
        "id": str(constraint.id),
        "platform": constraint.platform,
        "kind": constraint.kind,
        "value": constraint.value,
        "scope": constraint.scope,
        "propertyId": str(constraint.property_id) if constraint.property_id else None,
        "bedroomGroup": constraint.bedroom_group,
        "startDate": constraint.start_date.isoformat() if constraint.start_date else None,
        "endDate": constraint.end_date.isoformat() if constraint.end_date else None,
        "enabled": constraint.enabled,
        "createdAt": constraint.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Pricing Groups
# ---------------------------------------------------------------------------

def pricing_group_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        groups = PricingGroup.objects.filter(platform=_request_platform(request))
        return JsonResponse({"pricingGroups": [_serialize_pricing_group(g) for g in groups]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            name = (payload.get("name") or "").strip()
            if not name:
                return JsonResponse({"error": {"name": "Name is required."}}, status=400)
            group = PricingGroup(
                platform=_request_platform(request, payload),
                name=name,
                sort_order=int(payload.get("sortOrder") or 0),
                behaviour=payload.get("behaviour") or PricingGroup.Behaviour.STACK,
            )
            group.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"pricingGroup": _serialize_pricing_group(group)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def pricing_group_detail(request, group_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        group = PricingGroup.objects.get(pk=group_id)
    except PricingGroup.DoesNotExist:
        return JsonResponse({"error": "Pricing group not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)

            if "behaviour" in payload and payload["behaviour"] == PricingGroup.Behaviour.EXCLUSIVE:
                applications = set(group.rules.values_list("application", flat=True))
                if len(applications) > 1:
                    return JsonResponse(
                        {"error": (
                            f"'{group.name}' holds both per-night and whole-stay rules. An "
                            "Exclusive group must hold only one kind, so the first eligible "
                            "rule is unambiguous. Split them before switching."
                        )},
                        status=400,
                    )

            if "name" in payload:
                group.name = (payload.get("name") or "").strip()
            if "sortOrder" in payload:
                group.sort_order = int(payload.get("sortOrder") or 0)
            if "behaviour" in payload:
                group.behaviour = payload["behaviour"]
            group.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"pricingGroup": _serialize_pricing_group(group)})

    if request.method == "DELETE":
        count = group.rules.count()
        if count:
            return JsonResponse(
                {"error": f"This group still holds {count} rule(s). Move or delete them first."},
                status=400,
            )
        group.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


# ---------------------------------------------------------------------------

def pricing_rule_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        rules = PricingRule.objects.select_related("property", "group").order_by("rule_type", "scope")
        return JsonResponse({"pricingRules": [_serialize_pricing_rule(r) for r in rules]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            rule = _apply_pricing_rule_payload(PricingRule(), payload)
            validate_pricing_rule(rule)
            rule.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"pricingRule": _serialize_pricing_rule(rule)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def pricing_rule_detail(request, rule_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        rule = PricingRule.objects.get(pk=rule_id)
    except PricingRule.DoesNotExist:
        return JsonResponse({"error": "Pricing rule not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            rule = _apply_pricing_rule_payload(rule, payload)
            validate_pricing_rule(rule)
            rule.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"pricingRule": _serialize_pricing_rule(rule)})

    if request.method == "DELETE":
        rule.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def pricing_rule_reorder(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    payload = json_payload(request)
    group_id = payload.get("groupId")
    order = payload.get("order") or []
    with transaction.atomic():
        for position, rule_id in enumerate(order):
            qs = PricingRule.objects.filter(pk=rule_id)
            if group_id:
                qs = qs.filter(group_id=group_id)
            qs.update(sort_order=position)

    rules = PricingRule.objects.filter(group_id=group_id) if group_id else PricingRule.objects.all()
    rules = rules.order_by("sort_order", "created_at")
    return JsonResponse({"pricingRules": [_serialize_pricing_rule(r) for r in rules]})


def _int_or_none(value):
    """int() coercion that preserves a legitimate 0.

    `int(v) if v else None` treats 0 the same as "not provided", which is
    wrong wherever 0 is a meaningful value: daysBeforeCheckin=0 (a same-day
    last-minute rule — the UI offers min={0}) was silently discarded, and
    usageLimit=0 became None, which means UNLIMITED — inverting "this code
    is exhausted" into "this code never runs out".
    """
    return int(value) if value not in (None, "") else None


def _decimal_or_none(value):
    """Decimal() coercion that preserves a legitimate 0. See _int_or_none."""
    return Decimal(str(value)) if value not in (None, "") else None


def _apply_pricing_rule_payload(rule, payload):
    if "name" in payload:
        rule.name = (payload.get("name") or "").strip()
    if "code" in payload:
        # Codes are matched case-insensitively by being stored uppercase, the
        # same contract _apply_promo_payload had. Blank becomes NULL so the
        # conditional unique constraint ignores non-promo rules.
        rule.code = (payload.get("code") or "").strip().upper() or None
    if "groupId" in payload:
        rule.group_id = payload["groupId"]
    if "sortOrder" in payload:
        rule.sort_order = int(payload.get("sortOrder") or 0)
    if "application" in payload:
        rule.application = payload["application"]
    elif rule._state.adding and "ruleType" in payload:
        # Per-type default, per the spec: seasonal prices nights, everything
        # else adjusts the stay. Only on create — a PATCH must never silently
        # re-derive a value the operator set by hand.
        #
        # Note: `rule.pk` is truthy even on a brand-new unsaved instance,
        # because PricingRule.id is a UUIDField(default=uuid.uuid4) — Django
        # fills that default in at __init__, not at save(). `_state.adding`
        # is the actual "has this row been saved yet" signal.
        rule.application = (
            PricingRule.Application.PER_NIGHT
            if payload["ruleType"] == PricingRule.RuleType.SEASONAL
            else PricingRule.Application.WHOLE_STAY
        )
    if "isFinal" in payload:
        rule.is_final = bool(payload["isFinal"])
    if "stacks" in payload:
        rule.stacks = bool(payload["stacks"])
    if "blocksGroupId" in payload:
        rule.blocks_group_id = payload.get("blocksGroupId") or None
    if "blocksRuleId" in payload:
        rule.blocks_rule_id = payload.get("blocksRuleId") or None
    if "usageLimit" in payload:
        rule.usage_limit = _int_or_none(payload.get("usageLimit"))
    if "minSubtotalEur" in payload:
        rule.min_subtotal_eur = _decimal_or_none(payload.get("minSubtotalEur"))
    if "ruleType" in payload:
        rule.rule_type = payload["ruleType"]
    if "scope" in payload:
        rule.scope = payload["scope"]
    if "propertyId" in payload:
        pid = payload.get("propertyId")
        rule.property_id = pid if pid else None
    if "bedroomGroup" in payload:
        rule.bedroom_group = _int_or_none(payload.get("bedroomGroup"))
    if "enabled" in payload:
        rule.enabled = bool(payload["enabled"])
    if "minNights" in payload:
        rule.min_nights = _int_or_none(payload.get("minNights"))
    if "daysBeforeCheckin" in payload:
        rule.days_before_checkin = _int_or_none(payload.get("daysBeforeCheckin"))
    if "startDate" in payload:
        sd = payload.get("startDate")
        rule.start_date = date.fromisoformat(sd) if sd else None
    if "endDate" in payload:
        ed = payload.get("endDate")
        rule.end_date = date.fromisoformat(ed) if ed else None
    if "adjustmentType" in payload:
        rule.adjustment_type = payload.get("adjustmentType") or None
    if "adjustmentValue" in payload:
        rule.adjustment_value = _decimal_or_none(payload.get("adjustmentValue"))
    return rule


# ---------------------------------------------------------------------------
# Stay Constraints
# ---------------------------------------------------------------------------

def stay_constraint_list(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method == "GET":
        constraints = StayConstraint.objects.select_related("property").filter(
            platform=_request_platform(request)
        )
        return JsonResponse({"stayConstraints": [_serialize_stay_constraint(c) for c in constraints]})

    if request.method == "POST":
        try:
            payload = json_payload(request)
            constraint = _apply_stay_constraint_payload(
                StayConstraint(platform=_request_platform(request, payload)), payload
            )
            constraint.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"stayConstraint": _serialize_stay_constraint(constraint)}, status=201)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def stay_constraint_detail(request, constraint_id):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        constraint = StayConstraint.objects.get(pk=constraint_id)
    except StayConstraint.DoesNotExist:
        return JsonResponse({"error": "Stay constraint not found."}, status=404)

    if request.method == "PATCH":
        try:
            payload = json_payload(request)
            constraint = _apply_stay_constraint_payload(constraint, payload)
            constraint.save()
        except (ValidationError, ValueError) as e:
            return JsonResponse({"error": str(e)}, status=400)
        return JsonResponse({"stayConstraint": _serialize_stay_constraint(constraint)})

    if request.method == "DELETE":
        constraint.delete()
        return JsonResponse({}, status=204)

    return JsonResponse({"error": "Method not allowed."}, status=405)


def _apply_stay_constraint_payload(constraint, payload):
    if "kind" in payload:
        constraint.kind = payload["kind"]
    if "value" in payload:
        raw = payload.get("value")
        if raw in (None, ""):
            constraint.value = None
        else:
            value = int(raw)
            if value <= 0:
                raise ValidationError("Value must be a positive whole number.")
            constraint.value = value
    if "scope" in payload:
        constraint.scope = payload["scope"]
    if "propertyId" in payload:
        pid = payload.get("propertyId")
        constraint.property_id = pid if pid else None
    if "bedroomGroup" in payload:
        constraint.bedroom_group = _int_or_none(payload.get("bedroomGroup"))
    if "startDate" in payload:
        sd = payload.get("startDate")
        constraint.start_date = date.fromisoformat(sd) if sd else None
    if "endDate" in payload:
        ed = payload.get("endDate")
        constraint.end_date = date.fromisoformat(ed) if ed else None
    if "enabled" in payload:
        constraint.enabled = bool(payload["enabled"])

    # Each kind carries its limit in a different field, so each has to be
    # checked for the one it actually uses.
    if constraint.kind == StayConstraint.Kind.MAX_ADVANCE:
        if not constraint.end_date:
            raise ValidationError("Choose the last date guests may book.")
        constraint.value = None
    elif not constraint.value:
        raise ValidationError("Set a number of nights for this limit.")

    if constraint.scope == StayConstraint.Scope.PROPERTY and not constraint.property_id:
        raise ValidationError("Choose a property for a property-scoped constraint.")
    if constraint.scope == StayConstraint.Scope.BEDROOM_GROUP and constraint.bedroom_group is None:
        raise ValidationError("Choose a bedroom count for a bedroom-group constraint.")

    return constraint


# ---------------------------------------------------------------------------
# Staff Quotes — rule-adjusted prices for search, one per property
# ---------------------------------------------------------------------------

def _serialize_quote(breakdown):
    """Map calculate_price's snake_case breakdown to camelCase for this staff
    endpoint. An explicit mapping, not a generic transformer: the public
    breakdown blob's snake_case keys are frozen by stored data and must never
    be touched, so the two shapes are kept deliberately independent here."""
    return {
        "baseNightly": breakdown["base_nightly"],
        "effectiveNightly": breakdown["effective_nightly"],
        "hasSeasonal": breakdown["has_seasonal"],
        "subtotal": breakdown["subtotal"],
        "longStayPct": breakdown["long_stay_pct"],
        "longStayAmount": breakdown["long_stay_amount"],
        "lastMinutePct": breakdown["last_minute_pct"],
        "lastMinuteAmount": breakdown["last_minute_amount"],
        "nonRefundablePct": breakdown["non_refundable_pct"],
        "nonRefundableAmount": breakdown["non_refundable_amount"],
        "promoAmount": breakdown["promo_amount"],
        "total": breakdown["total"],
        "firstNightPrice": breakdown["first_night_price"],
        "averageNightlyRate": breakdown["average_nightly_rate"],
        "protectedTotal": breakdown["protected_total"],
        "nights": breakdown["nights"],
        "minNightsRequired": breakdown["min_nights_required"],
        "latestBookableDate": breakdown["latest_bookable_date"],
        "errors": breakdown["errors"],
        "nightlyBreakdown": breakdown["nightly_breakdown"],
        "rules": breakdown["rules"],
    }


def property_quotes(request):
    """POST — a rule-adjusted price quote per property, for staff search.
    Unlike /booking/calculate/, this prices many properties in one call and
    never lets one property's failure take the others down: a quote that
    raises is reported as an error alongside a base-price fallback total
    rather than omitted from the response."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        check_in = _parse_date(payload.get("checkIn"), "checkIn")
        check_out = _parse_date(payload.get("checkOut"), "checkOut")
        property_ids = payload.get("propertyIds") or None
    except (ValidationError, ValueError) as e:
        return JsonResponse({"error": str(e)}, status=400)

    properties = Property.objects.filter(
        active=True, listing_active=True, platform=Property.Platform.AIRSTAY
    )
    if property_ids:
        properties = properties.filter(pk__in=property_ids)

    nights = (check_out - check_in).days

    quotes = {}
    for prop in properties:
        try:
            breakdown = calculate_price(prop, check_in, check_out)
            quotes[str(prop.id)] = _serialize_quote(breakdown)
        except Exception as exc:
            quotes[str(prop.id)] = {
                "error": str(exc),
                "total": str(base_rate_for(prop) * nights),
            }

    return JsonResponse({"quotes": quotes})
