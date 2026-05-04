import uuid

from django.db import migrations, models


def populate_calendar_export_tokens(apps, schema_editor):
    Property = apps.get_model("pms", "Property")
    for prop in Property.objects.filter(calendar_export_token__isnull=True):
        prop.calendar_export_token = uuid.uuid4()
        prop.save(update_fields=["calendar_export_token"])


class Migration(migrations.Migration):

    dependencies = [
        ("pms", "0007_delete_message"),
    ]

    operations = [
        migrations.AddField(
            model_name="property",
            name="calendar_export_token",
            field=models.UUIDField(blank=True, editable=False, null=True),
        ),
        migrations.RunPython(populate_calendar_export_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="property",
            name="calendar_export_token",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
