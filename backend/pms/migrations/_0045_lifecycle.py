"""Seeded bodies for the two booking outcomes.

Note on `[(reason)]`: it sits on a line of its own, opening and closing there.
`render_template` resolves a line at a time, so a segment split across lines
never matches - the brackets print literally and the placeholder inside is
reported unresolved. That is not hypothetical: these two bodies shipped with
`.[` on one line and `(reason)]` two lines later, and because `_guest_mail`
refuses to send a message with an unresolved placeholder, declining a booking
without typing a reason sent the guest nothing at all. Migration
0061_fix_rejection_segment repaired the rows already in the database;
`tests_message_audit` stops it coming back.
"""

# backend/pms/migrations/_0045_lifecycle.py
"""The two booking-outcome templates, in both languages.

Extracted so the wording can be read and tested without importing a migration
module by a name that is not a valid identifier (as _0041_templates does).

Albanian keeps the operator's own orthography (no ë/ç), matching the four
availability templates already in the app.

Unlike those, these are *sent*, not copied into WhatsApp by hand. Every
placeholder must therefore resolve before the send is allowed — see
views/_guest_mail.py. `[square brackets]` still drop when empty, which is how
the rejection reason disappears when staff did not type one.
"""

APPROVED_SQ = """Pershendetje (guest name),

Rezervimi juaj eshte konfirmuar.

Banesa: (apartment)
Check-in: (check-in)
Check-out: (check-out)
Netet: (nights)
Cmimi total: (total price)€

Pagesa behet ne vend, ne momentin e mberritjes.

Nese keni ndonje pyetje ose ju ndryshojne planet, ju lutem na kontaktoni lirisht.

Me respekt,"""

APPROVED_EN = """Hello (guest name),

Your booking is confirmed.

Apartment: (apartment)
Check-in: (check-in)
Check-out: (check-out)
Nights: (nights)
Total: (total price)€

Payment is taken at the property when you arrive.

If you have any questions, or your plans change, please get in touch.

Kind regards,"""

REJECTED_SQ = """Pershendetje (guest name),

Faleminderit per kerkesen tuaj per datat (check-in) deri me (check-out).

Fatkeqesisht nuk mund ta konfirmojme kete rezervim.
[(reason)]

Nese keni mundesi te na tregoni data te tjera, me kenaqesi kontrollojme perseri per ju.

Me respekt,"""

REJECTED_EN = """Hello (guest name),

Thank you for your request for (check-in) to (check-out).

Unfortunately we cannot confirm this booking.
[(reason)]

If you can tell us some other dates, we would be glad to check again for you.

Kind regards,"""

TEMPLATES = [
    ("booking_approved", APPROVED_SQ, APPROVED_EN),
    ("booking_rejected", REJECTED_SQ, REJECTED_EN),
]


def seed_lifecycle_templates(apps):
    """Create the two rows. Idempotent, and never overwrites an edit."""
    MessageTemplate = apps.get_model("pms", "MessageTemplate")
    for scenario, body_sq, body_en in TEMPLATES:
        MessageTemplate.objects.get_or_create(
            scenario=scenario,
            defaults={"body_sq": body_sq, "body_en": body_en},
        )
