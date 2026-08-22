"""Guest-reply templates and the drafts rendered from them.

Split of responsibility, per the design: the availability page owns the
availability walk (it already computes free types, split-stay plans and the
next free window on screen), and this owns everything the page must not
decide — which scenario wins, all money, date formatting and rendering.

That keeps one availability implementation and one pricing implementation, and
means a draft cannot contradict the results shown above it, because both come
from the same numbers.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.http import JsonResponse

from ..models import MessageTemplate, Property
from ._booking_public import _parse_date
from ._drafts import detect_scenario, format_stay_date, render_template
from ._pricing import calculate_price
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._utils import json_payload

LANGUAGES = ("sq", "en")


def _serialize_template(template):
    return {
        "scenario": template.scenario,
        "label": template.get_scenario_display(),
        "bodySq": template.body_sq,
        "bodyEn": template.body_en,
    }


def message_template_list(request):
    """GET — the four templates. They are fixed rows; there is no create."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    templates = MessageTemplate.objects.all()
    return JsonResponse({"messageTemplates": [_serialize_template(t) for t in templates]})


def message_template_detail(request, scenario):
    """PATCH — reword one template. No create, no delete."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    template = MessageTemplate.objects.filter(scenario=scenario).first()
    if template is None:
        return JsonResponse({"error": "Template not found."}, status=404)

    payload = json_payload(request)
    if "bodySq" in payload:
        template.body_sq = payload.get("bodySq") or ""
    if "bodyEn" in payload:
        template.body_en = payload.get("bodyEn") or ""
    template.save(update_fields=["body_sq", "body_en", "updated_at"])
    return JsonResponse({"messageTemplate": _serialize_template(template)})


def _representative(bedrooms):
    """One apartment standing for its bedroom type.

    All apartments of a size share a base price, so any of them prices the
    type. Picking one keeps the reply about the type rather than naming a
    specific flat the guest has not been offered.
    """
    return (
        Property.objects.filter(
            active=True, listing_active=True, bedrooms=bedrooms,
            platform=Property.Platform.AIRSTAY,
        )
        .order_by("name")
        .first()
    )


def _join_list(values, language):
    """"1 dhe 2" / "1, 2 and 3" — a list as a reader would say it.

    Shared by the bedroom types and the changeover dates: both are lists read
    aloud in a sentence, and a bare comma list ("22.08.2026, 24.08.2026")
    reads like data rather than prose.
    """
    values = [v for v in values if v]
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    conjunction = "and" if language == "en" else "dhe"
    return f"{', '.join(values[:-1])} {conjunction} {values[-1]}"


def _bedrooms_list(free_types, language):
    """Every free bedroom type, in one phrase.

    The intro sentence names all of them at once. It cannot use `(bedrooms)`:
    that is a per-apartment placeholder, so it would repeat the whole sentence
    once per type instead of listing them inside one.
    """
    return _join_list([str(b) for b in sorted(set(free_types))], language)


ZERO_PCT = Decimal("0")


def _money(value):
    """Trim a Decimal string for prose: 245.00 -> 245, 208.25 stays."""
    text = str(value)
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _priced_types(free_types, check_in, check_out):
    """One dict of placeholder values per free bedroom type, priced for real."""
    rows = []
    for bedrooms in free_types:
        prop = _representative(bedrooms)
        if prop is None:
            continue
        breakdown = calculate_price(prop, check_in, check_out)
        if breakdown["errors"]:
            continue
        subtotal = Decimal(breakdown["subtotal"])
        discount = subtotal - Decimal(breakdown["total"])
        # Only a real reduction is a discount. A whole-stay increase drives this
        # negative, and "− -10% zbritje" is not a sentence a guest should read.
        discount_pct = (
            (discount / subtotal * 100).quantize(Decimal("0.1"))
            if subtotal > 0 and discount > 0
            else ZERO_PCT
        )
        rows.append({
            "bedrooms": str(prop.bedrooms),
            "capacity": str(prop.max_guests),
            "beds": str(prop.beds),
            "bathrooms": _money(prop.bathrooms),
            "apartment type": f"{prop.bedrooms}-bedroom",
            "nightly price": _money(breakdown["base_nightly"]),
            "subtotal": _money(breakdown["subtotal"]),
            "discount": _money(discount),
            "discount %": _money(discount_pct),
            "total price": _money(breakdown["total"]),
        })
    return rows


def message_draft(request):
    """POST — render one draft from the page's availability context."""
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

    language = payload.get("language") if payload.get("language") in LANGUAGES else "sq"

    free_types = [int(b) for b in (payload.get("freeTypes") or []) if str(b).isdigit()]
    split_types = [int(b) for b in (payload.get("splitTypes") or []) if str(b).isdigit()]
    split_covers = bool(payload.get("splitCovers"))
    next_free = (payload.get("nextFree") or "").strip()

    detected = detect_scenario(free_types, split_covers, next_free)
    override = payload.get("scenario")
    scenario = override if override in MessageTemplate.Scenario.values else detected

    template = MessageTemplate.objects.filter(scenario=scenario).first()
    if template is None:
        return JsonResponse({"error": "Template not found."}, status=404)

    body = template.body_sq if language == "sq" else template.body_en
    if not body.strip():
        # Nothing to render. The panel says so rather than sending a blank.
        return JsonResponse({
            "scenario": scenario, "detected": detected, "language": language,
            "body": "", "unresolved": [], "empty": True,
        })

    # When the guest moves. A split plan may have more than one changeover, so
    # this accepts a list and names them all rather than only the first.
    raw_changes = payload.get("changeDate") or []
    if isinstance(raw_changes, str):
        raw_changes = [raw_changes] if raw_changes.strip() else []
    change_dates = []
    for raw in raw_changes:
        try:
            change_dates.append(format_stay_date(_parse_date(raw, "changeDate"), language))
        except (ValidationError, ValueError):
            continue

    nights = (check_out - check_in).days
    values = {
        "check-in": format_stay_date(check_in, language),
        "check-out": format_stay_date(check_out, language),
        "nights": str(nights),
        "guests": str(payload.get("guests") or ""),
        "guest name": (payload.get("guestName") or "").strip(),
        "bedrooms list": _bedrooms_list(free_types, language),
        "change date": _join_list(change_dates, language),
        "next free date": (
            format_stay_date(_parse_date(next_free, "nextFree"), language)
            if next_free
            else ""
        ),
        "unavailable until": (
            format_stay_date(_parse_date(next_free, "nextFree"), language)
            if next_free
            else ""
        ),
    }

    # What the bullet quotes. When something is free for the whole stay it is
    # those types. A split stay has none — the guest moves — so it is quoted
    # from the plan at its CHEAPEST type: they are charged the smaller
    # apartment's rate throughout and any nights in a larger one are a free
    # upgrade, which needs no explaining to a guest.
    if free_types:
        quoted = free_types
    elif split_types:
        quoted = [min(split_types)]
    else:
        quoted = []

    rendered, unresolved = render_template(
        body, values, per_type=_priced_types(quoted, check_in, check_out)
    )
    return JsonResponse({
        "scenario": scenario, "detected": detected, "language": language,
        "body": rendered, "unresolved": unresolved, "empty": False,
    })
