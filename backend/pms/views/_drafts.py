"""Turning a message template into a guest reply.

Pure functions — no HTTP, no models — because everything hard here is textual:

  * a discount clause that must vanish rather than print "− 0€ zbritje",
  * a bullet that repeats once per free bedroom type,
  * a placeholder that could not be filled and must stay visible, since staff
    always read the draft before sending and a visible gap is safer than a
    silent deletion.

Placeholders are parenthesised natural language — `(nightly price)` — matched
case-insensitively and tolerant of internal whitespace, so staff write them the
way they would say them rather than learning a syntax.
"""

import re

# `(nightly price)` — no nesting, no newlines inside.
PLACEHOLDER = re.compile(r"\(([^()\n]+)\)")

# `[ − (discount)€ zbritje]` — dropped whole when its placeholders are empty.
OPTIONAL_SEGMENT = re.compile(r"\[([^\[\]\n]*)\]")

# A line carrying any of these describes ONE apartment type, so it repeats
# once per free type. Everything else is stay-wide and printed once.
PER_APARTMENT_KEYS = frozenset({
    "bedrooms",
    "capacity",
    "beds",
    "bathrooms",
    "apartment type",
    "nightly price",
    "subtotal",
    "discount",
    "discount %",
    "total price",
})

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def detect_scenario(free_types, split_covers, next_free):
    """Which of the four situations the search landed in.

    The page supplies the facts it already computed on screen — which bedroom
    types are free, whether a split-stay plan covers the dates, the first later
    window that fits — and this decides. Keeping the decision here means the
    draft cannot contradict the results above it, and keeping the availability
    walk there means there is only one implementation of it.

    Priority is deliberate: an apartment free for the whole stay beats moving
    the guest between apartments, and moving them between apartments beats
    asking them to move their dates. Missing context falls through to
    no_availability rather than inventing an answer for a guest.
    """
    if free_types:
        return "available"
    if split_covers:
        return "split_stay"
    if next_free:
        return "alternative_dates"
    return "no_availability"


def format_stay_date(value, language):
    """A stay date in the reader's convention: 20.09.2026 / 20 Sep 2026."""
    if not value:
        return ""
    if language == "en":
        return f"{value.day} {MONTHS_EN[value.month - 1]} {value.year}"
    return f"{value.day:02d}.{value.month:02d}.{value.year}"


def _normalise(name):
    """`( Nightly   Price )` and `(nightly price)` are the same placeholder."""
    return " ".join(name.strip().lower().split())


def _lookup(values, name):
    """The value for a placeholder, or '' when absent or blank.

    Zero is treated as absent on purpose: "− 0€ zbritje" is exactly the
    sentence an optional segment exists to remove.
    """
    raw = values.get(_normalise(name))
    if raw is None:
        return ""
    text = str(raw).strip()
    if text in ("", "0", "0.0", "0.00"):
        return ""
    return text


def _resolve_segments(text, values):
    """Drop every `[...]` whose placeholders resolve to nothing.

    A segment holding no placeholder at all is left alone — the brackets are
    the staff's own punctuation, not our syntax.
    """
    def replace(match):
        inner = match.group(1)
        names = PLACEHOLDER.findall(inner)
        if not names:
            return match.group(0)
        if all(_lookup(values, name) for name in names):
            return inner
        return ""

    return OPTIONAL_SEGMENT.sub(replace, text)


def _resolve_placeholders(text, values, unresolved):
    def replace(match):
        name = match.group(1)
        value = _lookup(values, name)
        if value:
            return value
        key = _normalise(name)
        if key not in unresolved:
            unresolved.append(key)
        # Left visible rather than blanked: staff can see what is missing.
        return match.group(0)

    return PLACEHOLDER.sub(replace, text)


def _is_per_apartment(line):
    return any(
        _normalise(name) in PER_APARTMENT_KEYS for name in PLACEHOLDER.findall(line)
    )


def render_template(body, values, per_type=None):
    """Render one template body.

    `values` are stay-wide (dates, nights, guest name). `per_type` is one dict
    per free bedroom type; any line mentioning a per-apartment placeholder is
    emitted once per entry, with that entry's values layered over the stay-wide
    ones.

    Returns `(text, unresolved)` where `unresolved` names each placeholder that
    could not be filled, once, in the order first met.
    """
    unresolved = []
    out = []

    for line in body.split("\n"):
        if per_type and _is_per_apartment(line):
            for entry in per_type:
                merged = {**values, **{_normalise(k): v for k, v in entry.items()}}
                rendered = _resolve_segments(line, merged)
                out.append(_resolve_placeholders(rendered, merged, unresolved))
            continue
        rendered = _resolve_segments(line, values)
        out.append(_resolve_placeholders(rendered, values, unresolved))

    return "\n".join(out), unresolved
