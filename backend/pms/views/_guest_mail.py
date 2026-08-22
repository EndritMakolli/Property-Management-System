"""Telling a guest their booking request was approved or declined.

Two policies here are deliberately the opposite of the code they resemble.

**Fail open, where 2FA fails closed.** `_two_factor.py` refuses to issue a login
code when mail is undeliverable, because a weakened second factor is worse than
a locked-out user. Here the reservation already exists and the staff member has
already decided; refusing or rolling that back because SMTP hiccupped would
destroy real work. A failed send reports itself and changes nothing else.

**Strict rendering, where the staff draft is lenient.** `_drafts.py` leaves an
unfillable placeholder *visible*, because a person reads every draft before
pasting it into WhatsApp. Nothing proofreads an email on its way out, so an
unresolved placeholder refuses the send. "Pershendetje (guest name)" arriving in
a guest's inbox is worse than not writing at all.

Sending is always explicit — staff read and edit the draft, then press Send.
Nothing is sent automatically on approval.
"""

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.http import JsonResponse

from ..models import BookingRequest, MessageTemplate
from ._drafts import PLACEHOLDER, format_stay_date, render_template
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles
from ._two_factor import email_is_deliverable
from ._utils import json_payload

logger = logging.getLogger(__name__)

OUTCOME_SCENARIOS = {
    MessageTemplate.Scenario.BOOKING_APPROVED,
    MessageTemplate.Scenario.BOOKING_REJECTED,
}


def _money(value):
    """245.00 -> 245, 208.25 stays. Prose, not accounting."""
    text = str(value)
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def booking_values(booking_request, language):
    """Everything a booking-outcome template can refer to."""
    return {
        "guest name": (booking_request.guest_name or "").strip(),
        "apartment": booking_request.property.name,
        "check-in": format_stay_date(booking_request.check_in, language),
        "check-out": format_stay_date(booking_request.check_out, language),
        "nights": str(booking_request.nights),
        "guests": str(booking_request.guests_count),
        "total price": _money(booking_request.total_price_eur),
        # Only present on a decline, and wrapped in [...] in the template so the
        # sentence disappears when staff did not type one.
        "reason": (booking_request.rejection_message or "").strip(),
    }


def _render(booking_request, scenario, language):
    try:
        template = MessageTemplate.objects.get(scenario=scenario)
    except MessageTemplate.DoesNotExist:
        return "", []
    body = template.body_sq if language == "sq" else template.body_en
    if not body.strip():
        return "", []
    return render_template(body, booking_values(booking_request, language))


def _subject(booking_request, language):
    if language == "sq":
        return f"Rezervimi juaj — {booking_request.property.name}"
    return f"Your booking — {booking_request.property.name}"


def send_guest_email(to_address, subject, body):
    """Hand one message to the MTA. Returns (sent, error) — never raises."""
    if not email_is_deliverable():
        logger.error("Refusing to send guest mail: no SMTP backend is configured.")
        return False, "Email is not configured on this server yet."
    try:
        sent = send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL or None,
            recipient_list=[to_address],
            fail_silently=False,
        )
        return bool(sent), "" if sent else "The mail server accepted no recipients."
    except Exception:  # noqa: BLE001 — never leak SMTP detail to a browser
        logger.exception("Failed to send guest mail to a booking request")
        return False, "The email could not be sent. The booking itself is unchanged."


def booking_request_notify(request, request_id):
    """GET — read the draft. POST — send what staff edited."""
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    try:
        booking_request = BookingRequest.objects.select_related("property").get(pk=request_id)
    except (BookingRequest.DoesNotExist, ValueError):
        return JsonResponse({"error": "Booking request not found."}, status=404)

    if request.method == "GET":
        scenario = request.GET.get("scenario") or MessageTemplate.Scenario.BOOKING_APPROVED
        language = "en" if request.GET.get("language") == "en" else "sq"
        if scenario not in OUTCOME_SCENARIOS:
            return JsonResponse({"error": "Unknown template."}, status=400)
        body, unresolved = _render(booking_request, scenario, language)
        return JsonResponse(
            {
                "body": body,
                "unresolved": unresolved,
                "subject": _subject(booking_request, language),
                "guestEmail": booking_request.guest_email or "",
                "empty": not body.strip(),
            }
        )

    if request.method == "POST":
        payload = json_payload(request)
        language = "en" if payload.get("language") == "en" else "sq"
        body = (payload.get("body") or "").strip()

        if not body:
            return JsonResponse({"error": "The message is empty."}, status=400)

        to_address = (booking_request.guest_email or "").strip()
        if not to_address:
            return JsonResponse(
                {"error": "This guest did not leave an email address, so there is nobody to write to."},
                status=400,
            )

        # The strict half. Anything still in (brackets) never made it out of the
        # template, and a guest must not be the one to discover that.
        leftover = PLACEHOLDER.findall(body)
        if leftover:
            names = ", ".join(sorted({name.strip() for name in leftover}))
            return JsonResponse(
                {"error": f"Fill in or remove these before sending: {names}."},
                status=400,
            )

        subject = (payload.get("subject") or "").strip() or _subject(booking_request, language)
        sent, error = send_guest_email(to_address, subject, body)
        if not sent:
            # Fail open: report it and leave the booking exactly as it is.
            return JsonResponse({"error": error}, status=502)

        return JsonResponse({"sent": True, "to": to_address})

    return JsonResponse({"error": "Method not allowed."}, status=405)
