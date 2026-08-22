"""Quote the discount as a percentage rather than an amount.

"− 15% zbritje" lands better than "− 157.5€ zbritje": a percentage is the thing
a guest is actually being offered, and it does not need mental arithmetic
against a subtotal three numbers earlier in the same sentence.

This rewrites the clause **by exact substring**, not by replacing whole bodies.
Operators edit these templates in the app — one of the four has already been
reworded by hand — so anything that does not contain the original clause is
left exactly as it is. Idempotent: running it twice changes nothing the second
time, because the pattern no longer matches.
"""

from django.db import migrations

# (old, new) — Albanian and English clauses as seeded in 0041.
SWAPS = [
    ("(discount)€ zbritje", "(discount %)% zbritje"),
    ("(discount)€ discount", "(discount %)% discount"),
]


def _apply(apps, swaps):
    MessageTemplate = apps.get_model("pms", "MessageTemplate")
    for template in MessageTemplate.objects.all():
        changed = []
        for field in ("body_sq", "body_en"):
            body = getattr(template, field)
            for old, new in swaps:
                if old in body:
                    body = body.replace(old, new)
            if body != getattr(template, field):
                setattr(template, field, body)
                changed.append(field)
        if changed:
            template.save(update_fields=changed)


def to_percentage(apps, schema_editor):
    _apply(apps, SWAPS)


def to_amount(apps, schema_editor):
    _apply(apps, [(new, old) for old, new in SWAPS])


class Migration(migrations.Migration):
    dependencies = [("pms", "0041_seed_message_templates")]
    operations = [migrations.RunPython(to_percentage, to_amount)]
