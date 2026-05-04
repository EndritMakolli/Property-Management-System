from builtins import property as builtin_property

from django.db import models
from django.utils import timezone

from .base import TimeStampedModel
from .guests import Guest
from .properties import Property
from .reservations import Reservation


class Inquiry(TimeStampedModel):
    class Platform(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        AIRBNB = "airbnb", "Airbnb"
        BOOKING = "booking", "Booking.com"
        DIRECT = "direct", "Direct"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        REPLIED = "replied", "Replied"
        CONVERTED = "converted", "Converted to Reservation"
        DISMISSED = "dismissed", "Dismissed"

    guest = models.ForeignKey(
        Guest, on_delete=models.SET_NULL, null=True, blank=True, related_name="inquiries"
    )
    property = models.ForeignKey(
        Property, on_delete=models.SET_NULL, null=True, blank=True, related_name="inquiries"
    )
    platform = models.CharField(max_length=20, choices=Platform.choices)
    check_in_requested = models.DateField(blank=True, null=True)
    check_out_requested = models.DateField(blank=True, null=True)
    guests_count = models.PositiveIntegerField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    content = models.TextField()
    converted_reservation = models.OneToOneField(
        Reservation, on_delete=models.SET_NULL, null=True, blank=True, related_name="inquiry"
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "Inquiries"
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["check_in_requested", "check_out_requested"]),
        ]

    def __str__(self):
        return f"Inquiry from {self.guest or 'Unknown'} ({self.status})"

    @builtin_property
    def is_stale(self):
        return self.status == self.Status.PENDING and (
            timezone.now() - self.created_at
        ).total_seconds() > 172800
