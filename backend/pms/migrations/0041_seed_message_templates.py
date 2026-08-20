"""Seed the four guest-reply templates in both languages.

Extracted into _0041_templates.py so the wording can be read and tested
without importing a migration module by a name that is not a valid identifier.

get_or_create, so re-running never overwrites wording an operator has since
edited in the app.
"""

from django.db import migrations

from ._0041_templates import seed_templates


def seed(apps, schema_editor):
    seed_templates(apps)


def noop(apps, schema_editor):
    """No-op. Reversing would delete templates that may have been edited."""


class Migration(migrations.Migration):
    dependencies = [("pms", "0040_message_templates")]
    operations = [migrations.RunPython(seed, noop)]
