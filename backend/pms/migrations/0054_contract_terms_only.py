"""Replace the first contract drafts with terms-only ones.

The document now lays out the logo, the two parties and the stay summary the
way an invoice does, so the template no longer types them as text.

Only rows still holding the *original* seed are replaced. Wording the operator
has already changed is theirs and is left exactly as it is.
"""

from django.db import migrations

from ._0050_contracts import CONTRACTS as ORIGINAL
from ._0054_contract_layout import CONTRACTS as TERMS_ONLY


def use_terms_only(apps, schema_editor):
    ContractTemplate = apps.get_model("pms", "ContractTemplate")
    original = {kind: (sq, en) for kind, sq, en in ORIGINAL}

    for kind, body_sq, body_en in TERMS_ONLY:
        try:
            template = ContractTemplate.objects.get(kind=kind)
        except ContractTemplate.DoesNotExist:
            ContractTemplate.objects.create(kind=kind, body_sq=body_sq, body_en=body_en)
            continue

        was_sq, was_en = original.get(kind, ("", ""))
        # Untouched? Replace it. Edited? Leave it alone - each language
        # separately, since someone may have rewritten one and not the other.
        if template.body_sq.strip() == was_sq.strip():
            template.body_sq = body_sq
        if template.body_en.strip() == was_en.strip():
            template.body_en = body_en
        template.save()


def back_to_full_text(apps, schema_editor):
    ContractTemplate = apps.get_model("pms", "ContractTemplate")
    terms = {kind: (sq, en) for kind, sq, en in TERMS_ONLY}
    for kind, body_sq, body_en in ORIGINAL:
        try:
            template = ContractTemplate.objects.get(kind=kind)
        except ContractTemplate.DoesNotExist:
            continue
        was_sq, was_en = terms.get(kind, ("", ""))
        if template.body_sq.strip() == was_sq.strip():
            template.body_sq = body_sq
        if template.body_en.strip() == was_en.strip():
            template.body_en = body_en
        template.save()


class Migration(migrations.Migration):

    dependencies = [
        ("pms", "0053_notification_read"),
    ]

    operations = [
        migrations.RunPython(use_terms_only, back_to_full_text),
    ]
