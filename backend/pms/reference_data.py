"""Reference data the app needs in order to work at all.

Not user data — vocabulary. Which reservation types exist and what colour they
draw in; which message templates exist and what they say. It is created by data
migrations on a fresh install, and it is what a restore has to put back.

**Why this exists.** `backup_import` deletes every row of every pms model and
then loads the backup file. A backup exported before a lookup table existed
carries no rows for it, so the wipe empties it and nothing refills it. That is
not hypothetical: it left a live database with 797 reservations referencing
`airbnb`, `booking` and `private`, and an entirely empty `ReservationType`
table — no colours anywhere, and every reservation save rejected as an unknown
type.

Everything here is `get_or_create`, so a *newer* backup — which does carry the
operator's own colours and wording — is left exactly as it was restored. Only
what is genuinely missing gets filled in.

The seed values are imported from the migration data modules rather than copied,
so there is one list of built-in types and one set of template bodies.
"""

from .migrations._0041_templates import TEMPLATES as AVAILABILITY_TEMPLATES
from .migrations._0043_types import TYPES as BUILTIN_TYPES
from .migrations._0045_lifecycle import TEMPLATES as OUTCOME_TEMPLATES

# What an unknown-but-used type gets until someone picks a real colour.
FALLBACK_COLOR = "#6b7280"


def _ensure_reservation_types(ReservationType, Reservation):
    for code, label, color, sort_order in BUILTIN_TYPES:
        ReservationType.objects.get_or_create(
            code=code,
            defaults={
                "label": label,
                "color": color,
                "sort_order": sort_order,
                "is_builtin": True,
                "active": True,
            },
        )

    # A type the operator added themselves is in the data but not in the list
    # above. Restoring a backup from before they created it would leave those
    # reservations referencing a type that no longer exists — and therefore
    # uneditable, because saving one revalidates the platform. A plain grey row
    # is a much better outcome than a record nobody can touch.
    known = set(ReservationType.objects.values_list("code", flat=True))
    used = {
        code
        for code in Reservation.objects.values_list("platform", flat=True).distinct()
        if code and code not in known
    }
    if not used:
        return

    next_order = (
        ReservationType.objects.order_by("-sort_order")
        .values_list("sort_order", flat=True)
        .first()
        or 0
    )
    for offset, code in enumerate(sorted(used), start=1):
        ReservationType.objects.get_or_create(
            code=code,
            defaults={
                "label": code.replace("-", " ").replace("_", " ").title(),
                "color": FALLBACK_COLOR,
                "sort_order": next_order + offset,
                # Not built in: the app does not reason about it by name, so the
                # operator stays free to rename, recolour or delete it.
                "is_builtin": False,
                "active": True,
            },
        )


def _ensure_message_templates(MessageTemplate):
    for scenario, body_sq, body_en in (*AVAILABILITY_TEMPLATES, *OUTCOME_TEMPLATES):
        MessageTemplate.objects.get_or_create(
            scenario=scenario,
            defaults={"body_sq": body_sq, "body_en": body_en},
        )


def ensure_reference_data():
    """Fill in any reference row that is missing. Never overwrites an edit."""
    # Imported here rather than at module scope: this module is imported by
    # migration helpers' siblings, and models must not be touched at import time.
    from .models import MessageTemplate, Reservation, ReservationType

    _ensure_reservation_types(ReservationType, Reservation)
    _ensure_message_templates(MessageTemplate)
