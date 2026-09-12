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


class ContractTemplate(TimeStampedModel):
    """The rental agreement a guest signs, per business, in each language.

    Same shape as MessageTemplate and for the same reason: a fixed set of rows,
    seeded with a usable default and then edited in place. The wording belongs
    to the operator - what the code owns is that the placeholders resolve.

    Bodies use the syntax of `views/_drafts.py`: `(name)` is filled from the
    reservation, `[square brackets]` disappear when everything inside resolves
    to nothing. One syntax across templates and contracts, deliberately.
    """

    class Kind(models.TextChoices):
        APARTMENT = "apartment", "Apartment rental"
        VEHICLE = "vehicle", "Car rental"

    kind = models.CharField(max_length=20, choices=Kind.choices, unique=True)
    body_sq = models.TextField(blank=True)  # sq = Albanian
    body_en = models.TextField(blank=True)

    class Meta:
        ordering = ["kind"]

    def __str__(self):
        return self.get_kind_display()


class ReservationContract(TimeStampedModel):
    """One reservation's contract, as edited rather than as generated.

    A contract used to be rendered on demand and never kept, so every
    correction made on screen - a deposit agreed on the phone, a clause struck
    out, an ID number written in - was gone the moment the modal closed. That
    is fine for a document nobody touches and wrong for one that is negotiated.

    A row exists only once somebody has actually edited: a reservation with no
    row still renders from `ContractTemplate`, so nothing changed for the
    contracts nobody has needed to change. Deleting the row is how an edit is
    undone, which is why the modal's reset button is a DELETE.

    Per language, because the Albanian and English contracts are two documents
    with two sets of wording, and editing one must not overwrite the other.
    """

    reservation = models.ForeignKey(
        "Reservation", on_delete=models.CASCADE, related_name="contract_drafts"
    )
    language = models.CharField(max_length=2, default="en")
    # The terms only. Everything around them - the letterhead, both parties,
    # the stay summary, the signature block - is still laid out from structured
    # data, so a draft cannot go stale about who the company is.
    body = models.TextField(blank=True)

    # Written in at the desk. There is no ID *number* on Guest - only uploaded
    # documents, which never leave the role-checked download view - so this is
    # a number a person types, and it is stored here rather than on the guest
    # precisely so it stays attached to the paper it was written on.
    client_id_number = models.CharField(max_length=60, blank=True)
    licence_number = models.CharField(max_length=60, blank=True)
    deposit = models.CharField(max_length=40, blank=True)

    updated_by = models.ForeignKey(
        "auth.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["reservation", "language"], name="unique_reservation_contract_language"
            ),
        ]

    def __str__(self):
        return f"Contract draft [{self.language}] for {self.reservation_id}"
