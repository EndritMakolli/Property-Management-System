from decimal import Decimal
import uuid

from django.db import models

from .base import TimeStampedModel


class Property(TimeStampedModel):
    class Platform(models.TextChoices):
        AIRSTAY = "airstay", "AirStay"
        FLEET = "fleet", "Fleet"

    platform = models.CharField(
        max_length=20,
        choices=Platform.choices,
        default=Platform.AIRSTAY,
        db_index=True,
    )
    name = models.CharField(max_length=255)
    unit_code = models.CharField(max_length=50, blank=True)
    address = models.TextField(blank=True)
    apartment_type = models.CharField(max_length=100, blank=True)
    airbnb_listing_id = models.CharField(max_length=100, blank=True, null=True, unique=True)
    booking_property_id = models.CharField(max_length=100, blank=True, null=True, unique=True)
    airbnb_ical_url = models.URLField(blank=True, null=True)
    booking_ical_url = models.URLField(blank=True, null=True)
    calendar_export_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    bedrooms = models.PositiveIntegerField(default=1)
    max_guests = models.PositiveIntegerField(default=2)
    base_price_eur = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    photo = models.FileField(upload_to="properties/", blank=True, null=True)
    notes = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    floor = models.CharField(max_length=50, blank=True)
    wifi_name = models.CharField(max_length=255, blank=True)
    wifi_password = models.CharField(max_length=255, blank=True)
    auto_sync_enabled = models.BooleanField(default=False)
    sync_interval_hours = models.PositiveIntegerField(default=24)
    description = models.TextField(blank=True)
    listing_active = models.BooleanField(default=True, help_text="Show on the public booking website")

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "Properties"
        indexes = [
            models.Index(fields=["unit_code"]),
            models.Index(fields=["active", "name"]),
        ]

    def __str__(self):
        return self.name
