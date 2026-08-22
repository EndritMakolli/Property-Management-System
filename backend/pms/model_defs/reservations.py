import uuid
from builtins import property as builtin_property
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower
from django.db.models import Q

from .base import TimeStampedModel
from .guests import Guest
from .monthly import monthly_period_count
from .properties import Property


class ReservationType(models.Model):
    """What a reservation's `platform` value means, and what colour it draws in.

    Keyed by `code` — the exact string stored on `Reservation.platform`. The
    column stays a plain string rather than becoming a foreign key: it sits
    inside two unique constraints, drives channel-sync de-duplication, and gates
    behaviour (monthly billing periods, the Booking.com commission, maintenance
    blocks skipping overlap checks). A lookup table keyed by the same string
    gives an editable vocabulary without that migration risk.

    `is_builtin` marks the codes the application reasons about by name. They can
    be recoloured and relabelled freely, but deleting one would break billing
    rather than merely a swatch, so it is refused.

    This is also the single source of truth for colour. Before it existed the
    same five types were coloured independently in seven places that disagreed.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.SlugField(max_length=20, unique=True)
    label = models.CharField(max_length=60)
    color = models.CharField(max_length=7, default="#6b7280")
    sort_order = models.PositiveIntegerField(default=0)
    is_builtin = models.BooleanField(default=False)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "label"]

    def __str__(self):
        return self.label


class Reservation(TimeStampedModel):
    class Platform(models.TextChoices):
        PRIVATE = "private", "Private"
        AIRBNB = "airbnb", "Airbnb"
        BOOKING = "booking", "Booking.com"
        MONTHLY = "monthly", "Monthly"
        MAINTENANCE = "maintenance", "Maintenance"
        DIRECT = "direct", "Direct Booking"

    class OnlinePaymentStatus(models.TextChoices):
        NONE = "none", "No Online Payment"
        FIRST_NIGHT = "first_night", "First Night Paid"
        FULL = "full", "Fully Paid Online"

    property = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="reservations")
    guest = models.ForeignKey(
        Guest, on_delete=models.SET_NULL, null=True, blank=True, related_name="reservations"
    )
    guest_name = models.CharField(max_length=255, blank=True)
    guest_phone = models.CharField(max_length=30, blank=True)
    check_in = models.DateField()
    check_out = models.DateField()
    nights = models.PositiveIntegerField(editable=False, default=0)
    guests_count = models.PositiveIntegerField(default=1)
    # No `choices`: types are user-editable (see ReservationType). The enum
    # above stays for the built-in codes the code reasons about by name, and
    # clean() below is what actually rejects an unknown value.
    platform = models.CharField(max_length=20)
    platform_reservation_id = models.CharField(max_length=255, blank=True, null=True)
    external_uid = models.CharField(max_length=255, blank=True, null=True)
    # When an imported (channel) reservation is moved to a different apartment by
    # hand, pin it so a re-sync keeps it here instead of dragging it back to (and
    # re-blocking) the original apartment.
    pinned_property = models.BooleanField(default=False)
    total_price_eur = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    nightly_price_eur = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    # Flat rent per billing period for "monthly" stays (periods run from the
    # check-in day; €600/month stays €600 whether the month has 28 or 31 days).
    # NULL for non-monthly stays and for legacy monthly rows until backfilled.
    monthly_price_eur = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    payment_due = models.DateField(blank=True, null=True)
    paid = models.BooleanField(default=False)
    # For "monthly" stays the rent is collected month by month; this holds the
    # settled months as "YYYY-MM" strings. `paid` stays the overall flag.
    paid_months = models.JSONField(default=list, blank=True)
    platform_commission_eur = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    net_revenue_eur = models.DecimalField(
        max_digits=10, decimal_places=2, editable=False, default=Decimal("0.00")
    )
    notes = models.TextField(blank=True, null=True)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(blank=True, null=True)
    # Direct booking fields (null for PMS-entered and synced reservations)
    guest_email = models.EmailField(blank=True)
    booking_token = models.UUIDField(unique=True, null=True, blank=True)
    online_payment_status = models.CharField(
        max_length=20,
        choices=OnlinePaymentStatus.choices,
        default=OnlinePaymentStatus.NONE,
    )
    online_payment_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    is_non_refundable = models.BooleanField(default=False)
    price_breakdown_json = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["check_in"]
        constraints = [
            models.CheckConstraint(
                condition=Q(check_out__gt=models.F("check_in")),
                name="reservation_check_out_after_check_in",
            ),
            models.UniqueConstraint(
                fields=["platform", "platform_reservation_id"],
                condition=Q(platform_reservation_id__isnull=False),
                name="unique_platform_reservation",
            ),
            models.UniqueConstraint(
                fields=["platform", "external_uid"],
                condition=Q(external_uid__isnull=False),
                name="unique_platform_external_uid",
            ),
        ]
        indexes = [
            models.Index(fields=["property", "check_in", "check_out"]),
            models.Index(Lower("guest_email"), name="reservation_email_lower"),
            models.Index(fields=["platform", "platform_reservation_id"]),
            models.Index(fields=["paid", "payment_due"]),
            models.Index(fields=["guest_name"]),
            models.Index(fields=["guest_phone"]),
        ]

    def __str__(self):
        guest = self.guest_name or self.guest_phone or "Unknown guest"
        return f"{guest} @ {self.property} ({self.check_in} to {self.check_out})"

    def clean(self):
        errors = {}
        # Dropping `choices` removed the only thing rejecting a typo, so the
        # check moves here — against the types that actually exist.
        if self.platform and not ReservationType.objects.filter(code=self.platform).exists():
            errors["platform"] = f"Unknown reservation type '{self.platform}'."
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            errors["check_out"] = "Check-out must be after check-in."

        if self.guests_count and self.property_id and self.guests_count > self.property.max_guests:
            errors["guests_count"] = (
                f"Guest count ({self.guests_count}) exceeds property max "
                f"({self.property.max_guests})."
            )

        if self.platform != self.Platform.MAINTENANCE and not (self.guest_name or self.guest_phone):
            errors["guest_name"] = "Enter either a guest name or phone number."

        if self.check_in and self.check_out and self.property_id:
            overlapping = Reservation.objects.filter(
                property=self.property,
                check_in__lt=self.check_out,
                check_out__gt=self.check_in,
                is_archived=False,
            ).exclude(pk=self.pk).exclude(platform=self.Platform.MAINTENANCE)
            if overlapping.exists() and self.platform != self.Platform.MAINTENANCE:
                conflict = overlapping.first()
                errors["check_in"] = f"Reservation overlaps with {conflict}."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.check_in and self.check_out:
            self.nights = (self.check_out - self.check_in).days
        cents = Decimal("0.01")
        if self.platform == self.Platform.MONTHLY and self.monthly_price_eur is not None:
            # Flat rent per anniversary period; a started period is owed in full.
            # Nightly stays derived so sheets/reports keep a sensible per-night figure.
            periods = monthly_period_count(self.check_in, self.check_out)
            self.total_price_eur = (self.monthly_price_eur * periods).quantize(
                cents, rounding=ROUND_HALF_UP
            )
            self.nightly_price_eur = (
                (self.total_price_eur / self.nights).quantize(cents, rounding=ROUND_HALF_UP)
                if self.nights
                else Decimal("0.00")
            )
        else:
            self.total_price_eur = (self.nightly_price_eur * self.nights).quantize(
                cents, rounding=ROUND_HALF_UP
            )
        if self.platform == self.Platform.BOOKING:
            self.platform_commission_eur = (self.total_price_eur * Decimal("0.15")).quantize(
                cents, rounding=ROUND_HALF_UP
            )
        else:
            self.platform_commission_eur = Decimal("0.00")
        self.net_revenue_eur = self.total_price_eur - self.platform_commission_eur
        self.full_clean()
        super().save(*args, **kwargs)

    @builtin_property
    def calendar_color(self):
        """The type's colour, from the one table that owns colours."""
        row = ReservationType.objects.filter(code=self.platform).only("color").first()
        return row.color if row else "#6b7280"


class GuestStay(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    guest = models.ForeignKey(Guest, on_delete=models.CASCADE, related_name="guest_stays")
    reservation = models.OneToOneField(Reservation, on_delete=models.CASCADE, related_name="guest_stay")
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="guest_stays")
    check_in = models.DateField()
    check_out = models.DateField()
    nights = models.PositiveIntegerField()
    amount_paid_eur = models.DecimalField(max_digits=10, decimal_places=2)
    platform = models.CharField(max_length=20)

    class Meta:
        ordering = ["-check_in"]
        indexes = [
            models.Index(fields=["guest", "check_in"]),
            models.Index(fields=["property", "check_in"]),
        ]

    def __str__(self):
        return f"{self.guest} stayed at {self.property} ({self.check_in} to {self.check_out})"
