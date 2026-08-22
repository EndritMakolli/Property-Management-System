# backend/pms/migrations/_0043_types.py
"""The six reservation types the app already used, with their colours.

Extracted so the seed can be read and tested without importing a migration
module by a name that is not a valid identifier (same trick as _0041_templates).

The colours are the ones the **calendar** already drew, because that is the
densest, most-looked-at surface and the one whose appearance should not shift
under the operator. The other six places that coloured these types disagreed
with the calendar and with each other; they now all follow this table.

get_or_create, so re-running never overwrites a colour an operator has since
changed in the Admin Panel.
"""

# (code, label, colour, sort order). Guest-facing channels first, in the order
# an operator thinks about them; maintenance last, since it is not a guest.
TYPES = [
    ("private", "Private", "#202020", 0),
    ("airbnb", "Airbnb", "#e51b3f", 1),
    ("booking", "Booking.com", "#6ec8ff", 2),
    ("monthly", "Monthly", "#f5c518", 3),
    ("direct", "Direct Booking", "#0d9488", 4),
    ("maintenance", "Maintenance", "#16a34a", 5),
]


def seed_types(apps):
    """Create the built-in rows. Idempotent, and never overwrites an edit."""
    ReservationType = apps.get_model("pms", "ReservationType")
    for code, label, color, sort_order in TYPES:
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
