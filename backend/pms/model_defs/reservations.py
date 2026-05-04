import uuid
from builtins import property as builtin_property
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from .base import TimeStampedModel
from .guests import Guest
from .properties import Property


class Reservation(TimeStampedModel):
    class Platform(models.TextChoices):
        PRIVATE = "private", "Private"
        AIRBNB = "airbnb", "Airbnb"
        BOOKING = "booking", "Booking.com"

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
    platform = models.CharField(max_length=20, choices=Platform.choices)
    platform_reservation_id = models.CharField(max_length=255, blank=True, null=True)
    external_uid = models.CharField(max_length=255, blank=True, null=True)
    total_price_eur = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    nightly_price_eur = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    payment_due = models.DateField(blank=True, null=True)
    paid = models.BooleanField(default=False)
    platform_commission_eur = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    net_revenue_eur = models.DecimalField(
        max_digits=10, decimal_places=2, editable=False, default=Decimal("0.00")
    )
    notes = models.TextField(blank=True, null=True)

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
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            errors["check_out"] = "Check-out must be after check-in."

        if self.guests_count and self.property_id and self.guests_count > self.property.max_guests:
            errors["guests_count"] = (
                f"Guest count ({self.guests_count}) exceeds property max "
                f"({self.property.max_guests})."
            )

        if not (self.guest_name or self.guest_phone):
            errors["guest_name"] = "Enter either a guest name or phone number."

        if self.check_in and self.check_out and self.property_id:
            overlapping = Reservation.objects.filter(
                property=self.property,
                check_in__lt=self.check_out,
                check_out__gt=self.check_in,
            ).exclude(pk=self.pk)
            if overlapping.exists():
                conflict = overlapping.first()
                errors["check_in"] = f"Reservation overlaps with {conflict}."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.check_in and self.check_out:
            self.nights = (self.check_out - self.check_in).days
        cents = Decimal("0.01")
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
        colors = {
            self.Platform.PRIVATE: "#7C3AED",
            self.Platform.AIRBNB: "#FF5A5F",
            self.Platform.BOOKING: "#003580",
        }
        return colors.get(self.platform, "#6B7280")


class GuestStay(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    guest = models.ForeignKey(Guest, on_delete=models.CASCADE, related_name="guest_stays")
    reservation = models.OneToOneField(Reservation, on_delete=models.CASCADE, related_name="guest_stay")
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="guest_stays")
    check_in = models.DateField()
    check_out = models.DateField()
    nights = models.PositiveIntegerField()
    amount_paid_eur = models.DecimalField(max_digits=10, decimal_places=2)
    platform = models.CharField(max_length=20, choices=Reservation.Platform.choices)

    class Meta:
        ordering = ["-check_in"]
        indexes = [
            models.Index(fields=["guest", "check_in"]),
            models.Index(fields=["property", "check_in"]),
        ]

    def __str__(self):
        return f"{self.guest} stayed at {self.property} ({self.check_in} to {self.check_out})"
