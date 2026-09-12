"""Staff leaves become a register of people, not a workflow for logins.

Leave used to hang off `auth.User` with a request-and-approve status. Two things
were wrong with that. The register is kept for cleaners and handymen who have no
login at all, so a foreign key to `auth.User` could not describe the people it
was for. And nobody was going to file a request through the PMS: the office
knows who was off and needed somewhere to write it down with a running total.

So `StaffMember` is a name and a yearly allowance, and `StaffLeave` points at it.
The status, decided_by, decided_at and decision_note columns go with the
workflow they belonged to.

**The safe migration path.** The old table is empty - the feature shipped days
ago and no leave has been recorded - and rebuilding an empty table loses
nothing. The first operation refuses rather than destroys if that is not true on
the server this runs against, in which case the rows have to be moved to named
staff by hand before going further.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models


def refuse_if_leave_was_recorded(apps, schema_editor):
    StaffLeave = apps.get_model("pms", "StaffLeave")
    count = StaffLeave.objects.count()
    if count:
        raise RuntimeError(
            f"Refusing to rebuild StaffLeave: it holds {count} row(s). They are "
            "recorded against login accounts, and the new register is keyed on "
            "named staff. Export them, apply this migration, then re-enter them "
            "against the right names."
        )


def nothing_to_undo(apps, schema_editor):
    """The check is a read; reversing it does nothing."""


class Migration(migrations.Migration):
    dependencies = [
        ("pms", "0063_drop_dead_models"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(refuse_if_leave_was_recorded, nothing_to_undo),
        migrations.DeleteModel(name="StaffLeave"),
        migrations.CreateModel(
            name="StaffMember",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=150)),
                ("role", models.CharField(blank=True, max_length=80)),
                ("annual_leave_days", models.PositiveIntegerField(default=21)),
                ("active", models.BooleanField(db_index=True, default=True)),
                ("notes", models.TextField(blank=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="StaffLeave",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "leave_type",
                    models.CharField(
                        choices=[
                            ("annual", "Annual leave"),
                            ("sick", "Sick leave"),
                            ("unpaid", "Unpaid leave"),
                            ("parental", "Parental leave"),
                            ("other", "Other"),
                        ],
                        max_length=20,
                    ),
                ),
                ("start_date", models.DateField()),
                ("end_date", models.DateField()),
                ("note", models.TextField(blank=True)),
                (
                    "recorded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="auth.user",
                    ),
                ),
                (
                    "staff_member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="leave_periods",
                        to="pms.staffmember",
                    ),
                ),
            ],
            options={"ordering": ["-start_date"]},
        ),
        migrations.AddIndex(
            model_name="staffleave",
            index=models.Index(fields=["staff_member", "start_date"], name="pms_staffle_staff_m_60f9fe_idx"),
        ),
        migrations.AddIndex(
            model_name="staffleave",
            index=models.Index(fields=["start_date", "end_date"], name="pms_staffle_start_d_51a760_idx"),
        ),
    ]
