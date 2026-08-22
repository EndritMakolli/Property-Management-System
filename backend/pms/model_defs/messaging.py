from django.db import models

from .base import TimeStampedModel


class MessageTemplate(TimeStampedModel):
    """A guest reply, per situation, in each language staff write in.

    A fixed set of rows, created by data migrations and edited in place — the
    scenarios are the situations that can arise, not a list a user grows.
    Four come from the availability search; two more are booking outcomes. `unique=True` on scenario makes the lookup from a
    detected scenario to its template unambiguous.

    Bodies hold parenthesised placeholders — `(nightly price)` — resolved by
    views/_drafts.py. A body may be blank: the panel then says there is no
    template yet for that language rather than sending an empty message.
    """

    class Scenario(models.TextChoices):
        AVAILABLE = "available", "Apartments available"
        SPLIT_STAY = "split_stay", "Split stay possible"
        ALTERNATIVE_DATES = "alternative_dates", "Free on nearby dates"
        NO_AVAILABILITY = "no_availability", "Fully booked"
        # Outcomes, not enquiries: these are emailed to the guest rather than
        # copied into WhatsApp, so views/_guest_mail.py refuses to send one with
        # an unresolved placeholder still in it.
        BOOKING_APPROVED = "booking_approved", "Booking approved"
        BOOKING_REJECTED = "booking_rejected", "Booking declined"

    scenario = models.CharField(max_length=32, choices=Scenario.choices, unique=True)
    body_sq = models.TextField(blank=True)  # sq = Albanian
    body_en = models.TextField(blank=True)

    class Meta:
        ordering = ["scenario"]

    def __str__(self):
        return self.get_scenario_display()
