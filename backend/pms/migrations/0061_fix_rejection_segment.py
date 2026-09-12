"""Repair the decline email, whose optional segment spanned three lines.

`render_template` resolves a line at a time, so `[` on one line and `]` on
another never match. `booking_rejected` shipped that way in both languages:

    Unfortunately we cannot confirm this booking.[
    <blank>
    (reason)]

With a reason typed in, the guest received the square brackets. Without one -
the common case, since staff usually decline without writing an explanation -
`(reason)` stayed unresolved, and `views/_guest_mail.py` refuses to send a
message with a placeholder left in it. So declining a booking sent the guest
nothing at all.

The fix is content, not code: the segment is moved onto one line. Bodies are
editable at /message-templates, so this only rewrites a body that still matches
the broken text exactly - an operator who has since reworded their own decline
message keeps it.
"""

from django.db import migrations

BROKEN_EN = "Unfortunately we cannot confirm this booking.[\n\n(reason)]"
FIXED_EN = "Unfortunately we cannot confirm this booking.\n[(reason)]"

BROKEN_SQ = "Fatkeqesisht nuk mund ta konfirmojme kete rezervim.[\n\n(reason)]"
FIXED_SQ = "Fatkeqesisht nuk mund ta konfirmojme kete rezervim.\n[(reason)]"


def repair(apps, schema_editor):
    MessageTemplate = apps.get_model("pms", "MessageTemplate")
    for row in MessageTemplate.objects.filter(scenario="booking_rejected"):
        changed = False
        if BROKEN_EN in row.body_en:
            row.body_en = row.body_en.replace(BROKEN_EN, FIXED_EN)
            changed = True
        if BROKEN_SQ in row.body_sq:
            row.body_sq = row.body_sq.replace(BROKEN_SQ, FIXED_SQ)
            changed = True
        if changed:
            row.save(update_fields=["body_en", "body_sq"])


def unrepair(apps, schema_editor):
    """Reversible, but going back re-breaks the email. Here so the migration
    can be rolled back with the rest of a release, not because anybody wants
    the old text."""
    MessageTemplate = apps.get_model("pms", "MessageTemplate")
    for row in MessageTemplate.objects.filter(scenario="booking_rejected"):
        row.body_en = row.body_en.replace(FIXED_EN, BROKEN_EN)
        row.body_sq = row.body_sq.replace(FIXED_SQ, BROKEN_SQ)
        row.save(update_fields=["body_en", "body_sq"])


class Migration(migrations.Migration):
    dependencies = [("pms", "0060_staff_leave")]

    operations = [migrations.RunPython(repair, unrepair)]
