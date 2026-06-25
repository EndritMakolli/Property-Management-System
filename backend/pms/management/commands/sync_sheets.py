from django.core.management.base import BaseCommand, CommandError

from pms import sheets_sync


class Command(BaseCommand):
    help = (
        "Rewrite the Google Sheet with every active (non-archived) reservation. "
        "Use this for the first backfill after sharing the sheet, or to repair "
        "the mirror if it ever drifts."
    )

    def handle(self, *args, **options):
        if not sheets_sync.is_enabled():
            raise CommandError(
                "Google Sheets sync is disabled. Set GOOGLE_SHEETS_ID and a "
                "credential (GOOGLE_SHEETS_CREDENTIALS_FILE or _JSON) in your .env, "
                "and share the spreadsheet with the service account email."
            )
        count = sheets_sync.sync_all()
        self.stdout.write(
            self.style.SUCCESS(f"Synced {count} reservation(s) to Google Sheets.")
        )
