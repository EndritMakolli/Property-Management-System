"""Refill any missing reference data — types and templates.

Runs automatically after a backup import. Exposed as a command as well, for a
database that was already emptied before the import learned to heal itself.

Idempotent: it never overwrites a colour or a wording anyone has edited.
"""

from django.core.management.base import BaseCommand

from ...models import MessageTemplate, ReservationType
from ...reference_data import ensure_reference_data


class Command(BaseCommand):
    help = "Restore missing reservation types and message templates."

    def handle(self, *args, **options):
        before = (ReservationType.objects.count(), MessageTemplate.objects.count())
        ensure_reference_data()
        after = (ReservationType.objects.count(), MessageTemplate.objects.count())

        self.stdout.write(
            f"Reservation types: {before[0]} -> {after[0]}   "
            f"Message templates: {before[1]} -> {after[1]}"
        )
        if before == after:
            self.stdout.write(self.style.SUCCESS("Nothing was missing."))
        else:
            self.stdout.write(self.style.SUCCESS("Reference data restored."))
