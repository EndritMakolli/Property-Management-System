"""Drop five models that nothing can reach.

All five have no view, no endpoint and no frontend. Their only references
outside the model definitions were in `admin.py`, and the Django admin is
disabled (`DJANGO_ADMIN_ENABLED`), so nothing could read or write them by any
route at all.

  Expense          superseded by FinanceExpense, which is what ExpensePayment
                   actually points at. Two near-identically named models where
                   only one works is how a write eventually lands in the wrong
                   table.
  GuestStay        duplicates guest/reservation/nights/amount that Reservation
                   already holds. 818 reservations, 0 stays. If anything ever
                   started writing it there would be two answers to "how many
                   nights has this client stayed" - a bug the clients page has
                   already had once.
  Inquiry          never wired to anything.
  FinancialReport  never wired to anything.
  ClaudeTask       an automation queue nothing enqueues to or drains.

**The safe migration path.** Every table is empty today, and dropping an empty
table loses nothing. But "empty when I looked" is not "empty when this runs on
your server", so the first operation refuses rather than destroys: if any of
them has grown a row, the migration stops and says which, and nothing is
dropped.
"""

from django.db import migrations

DEAD = ["Expense", "GuestStay", "Inquiry", "FinancialReport", "ClaudeTask"]


def refuse_if_any_hold_data(apps, schema_editor):
    occupied = []
    for name in DEAD:
        model = apps.get_model("pms", name)
        count = model.objects.count()
        if count:
            occupied.append(f"{name} ({count} rows)")
    if occupied:
        raise RuntimeError(
            "Refusing to drop tables that hold data: "
            + ", ".join(occupied)
            + ". These models were removed as unreachable; if they have rows, "
            "something is writing to them and this migration is wrong. Decide "
            "what the data is before going further."
        )


def nothing_to_undo(apps, schema_editor):
    """The check is a read. Reversing it does nothing; reversing the deletes
    below recreates the (empty) tables, which is what a rollback wants."""


class Migration(migrations.Migration):
    dependencies = [("pms", "0062_maintenance_resolved")]

    operations = [
        migrations.RunPython(refuse_if_any_hold_data, nothing_to_undo),
        migrations.DeleteModel(name="Expense"),
        migrations.DeleteModel(name="GuestStay"),
        migrations.DeleteModel(name="Inquiry"),
        migrations.DeleteModel(name="FinancialReport"),
        migrations.DeleteModel(name="ClaudeTask"),
    ]
