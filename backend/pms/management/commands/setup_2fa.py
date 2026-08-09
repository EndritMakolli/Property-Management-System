"""Enable or disable email two-factor verification for a staff account.

Useful for the first account (before you can log in to change it in the UI) and
for recovery if someone loses access to their verification inbox.

    python manage.py setup_2fa --user admin --email you@example.com
    python manage.py setup_2fa --user admin --disable
    python manage.py setup_2fa --list
"""

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email

from pms.models import UserSecurity


class Command(BaseCommand):
    help = "Configure email two-step verification for a user."

    def add_arguments(self, parser):
        parser.add_argument("--user", help="Username to configure.")
        parser.add_argument("--email", help="Address that receives login codes.")
        parser.add_argument(
            "--disable", action="store_true", help="Turn two-step verification off."
        )
        parser.add_argument(
            "--list", action="store_true", help="Show the 2FA state of every account."
        )

    def handle(self, *args, **options):
        if options["list"]:
            for user in User.objects.select_related("security").order_by("username"):
                security = getattr(user, "security", None)
                state = "ON " if security and security.is_active else "off"
                target = security.two_factor_email if security else ""
                self.stdout.write(f"  [{state}] {user.username:<20} {target}")
            return

        username = options.get("user")
        if not username:
            raise CommandError("Pass --user <username> (or --list).")

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise CommandError(f"No user named '{username}'.")

        security = UserSecurity.for_user(user)

        if options["disable"]:
            security.two_factor_enabled = False
            security.save(update_fields=["two_factor_enabled", "updated_at"])
            self.stdout.write(self.style.WARNING(f"Two-step verification disabled for {username}."))
            return

        email = (options.get("email") or "").strip()
        if not email:
            raise CommandError("Pass --email <address> to enable, or --disable to turn it off.")
        try:
            validate_email(email)
        except ValidationError:
            raise CommandError(f"'{email}' is not a valid email address.")

        security.two_factor_email = email
        security.two_factor_enabled = True
        security.save()
        # Plain ASCII only: Windows consoles default to cp1252 and would raise
        # UnicodeEncodeError on characters like an arrow.
        self.stdout.write(
            self.style.SUCCESS(f"Two-step verification enabled for {username} -> {email}")
        )
        self.stdout.write(
            "Make sure EMAIL_HOST / EMAIL_HOST_USER / EMAIL_HOST_PASSWORD are set in "
            "backend/.env, otherwise codes are only printed to the server console."
        )
