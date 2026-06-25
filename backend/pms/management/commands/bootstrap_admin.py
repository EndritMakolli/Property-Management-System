import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        "Create the initial admin superuser from ADMIN_USERNAME / ADMIN_PASSWORD "
        "env vars. Idempotent and safe to run on every deploy: it skips if the "
        "env vars are unset or the user already exists. Lets you bootstrap an "
        "admin on hosts (like Render free tier) where you have no shell access."
    )

    def handle(self, *args, **options):
        User = get_user_model()
        username = (os.environ.get("ADMIN_USERNAME") or "").strip()
        password = os.environ.get("ADMIN_PASSWORD") or ""
        email = (os.environ.get("ADMIN_EMAIL") or "").strip()

        if not username or not password:
            self.stdout.write("ADMIN_USERNAME / ADMIN_PASSWORD not set — skipping admin bootstrap.")
            return

        if User.objects.filter(username=username).exists():
            self.stdout.write(f"Admin user '{username}' already exists — nothing to do.")
            return

        # create_superuser sets is_staff + is_superuser; user_role() maps any
        # superuser to the app's "admin" role, so the SPA recognizes it too.
        User.objects.create_superuser(username=username, email=email, password=password)
        self.stdout.write(self.style.SUCCESS(f"Created admin superuser '{username}'."))
