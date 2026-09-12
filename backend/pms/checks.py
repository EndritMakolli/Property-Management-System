"""Configuration mistakes that only exist at run time.

Three settings were carrying development values on a hosted app and nothing
said so. None is visible by reading the code - only by reading the running
config - so they belong here, where `manage.py check --deploy` fails the
deployment instead of a guest discovering it.

Registered as **deploy** checks, so they run for `manage.py check --deploy` and
not for every `runserver` or `test`. That is not tidiness: the test runner
forces DEBUG=False, so an ordinary check would fire on the development config
during every test run and abort the suite.

Quiet while DEBUG is on. These describe production mistakes, and a warning that
fires on every developer's machine is a warning nobody reads.
"""

from urllib.parse import urlparse

from django.conf import settings
from django.core.checks import Error, Warning, register

# Mailbox providers that cap a personal account at a few hundred messages a day
# and will eventually refuse outright. Fine for a test, wrong as the sender of
# every booking confirmation.
CONSUMER_MAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "icloud.com",
    "aol.com",
}

LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


@register("pms", deploy=True)
def check_production_config(app_configs, **kwargs):
    issues = []

    if getattr(settings, "DEBUG", False):
        issues.append(
            Error(
                "DEBUG is on. A stack trace - settings, environment and query "
                "values included - is served to whoever triggers an error.",
                hint="Set DEBUG=False in the server's .env.",
                id="pms.E001",
            )
        )
        # Everything below describes a production mistake. On a developer's
        # machine they are all expected, so stop here.
        return issues

    portal = (getattr(settings, "GUEST_PORTAL_URL", "") or "").strip()
    host = urlparse(portal).hostname if portal else None
    if not portal or host in LOCAL_HOSTS:
        issues.append(
            Error(
                f"GUEST_PORTAL_URL is {portal or 'unset'}, so emailed sign-in "
                "links point nowhere a guest can reach and nobody can sign in "
                "to the guest portal.",
                hint="Set it to the public site, not the API and not localhost.",
                id="pms.E002",
            )
        )

    sender = (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip().lower()
    domain = sender.rpartition("@")[2]
    if domain in CONSUMER_MAIL_DOMAINS:
        issues.append(
            Warning(
                f"DEFAULT_FROM_EMAIL is a {domain} mailbox. Consumer accounts "
                "are capped at a few hundred messages a day and are eventually "
                "refused, so booking confirmations stop without warning.",
                hint="Use a domain sender through a transactional provider.",
                id="pms.W001",
            )
        )

    if getattr(settings, "ONLINE_PAYMENTS_ENABLED", False):
        issues.append(
            Warning(
                "ONLINE_PAYMENTS_ENABLED is on, but the payment step is a stub: "
                "booking_create_direct writes a confirmed reservation recording "
                "money nothing took, and a later cancellation refunds it.",
                hint="Leave it off until a real payment provider is wired in.",
                id="pms.W002",
            )
        )

    return issues
