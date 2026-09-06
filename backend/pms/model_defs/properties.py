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
    beds = models.PositiveIntegerField(default=1)
    # Decimal, not an integer: "1.5 bathrooms" is a real layout — one full
    # bathroom and one without a shower.
    bathrooms = models.DecimalField(max_digits=3, decimal_places=1, default=Decimal("1.0"))
    max_guests = models.PositiveIntegerField(default=2)
    location_label = models.CharField(max_length=255, blank=True, help_text="Short location shown to guests, e.g. 'Prishtina, Kosovo'")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    rating = models.DecimalField(max_digits=3, decimal_places=2, null=True, blank=True)
    review_count = models.PositiveIntegerField(default=0)
    photo = models.FileField(upload_to="properties/", blank=True, null=True)
    notes = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    # Admin-only switch: a hidden property (and everything tied to it) is
    # excluded from every list a management-role user can fetch.
    hidden_from_management = models.BooleanField(default=False)
    floor = models.CharField(max_length=50, blank=True)
    wifi_name = models.CharField(max_length=255, blank=True)
    wifi_password = models.CharField(max_length=255, blank=True)
    # ── Fleet only ──────────────────────────────────────────────────────────
    # A vehicle is a Property with platform="fleet", so its service record
    # lives here rather than in a parallel table: every vehicle has exactly one,
    # and a second table would need a lifecycle of its own for no gain. All of
    # these stay empty on an apartment.
    #
    # Two clocks run independently. The calendar says a service is due every
    # `service_interval_months`; the odometer says it is due every
    # `service_interval_km` since `last_service_km`. Whichever arrives first
    # wins - see `vehicle_alerts`.
    # Identity, for the hire agreement. A rental contract has to name the car
    # precisely enough to be enforceable - the chassis number and the plates
    # are what identify *this* vehicle rather than a model.
    brand = models.CharField(max_length=60, blank=True)
    model = models.CharField(max_length=60, blank=True)
    chassis_number = models.CharField(max_length=40, blank=True)
    licence_plate = models.CharField(max_length=20, blank=True)
    # Where the hirer is permitted to drive it. Free text because the list is a
    # commercial decision that changes per vehicle and per insurer.
    allowed_countries = models.CharField(max_length=200, blank=True)

    last_service_date = models.DateField(null=True, blank=True)
    last_service_km = models.PositiveIntegerField(null=True, blank=True)
    current_km = models.PositiveIntegerField(null=True, blank=True)
    service_interval_km = models.PositiveIntegerField(null=True, blank=True, default=10000)
    service_interval_months = models.PositiveIntegerField(null=True, blank=True, default=12)
    # How much notice to give. Per vehicle rather than one global setting,
    # because a window only means something next to its interval: 800 km is 8%
    # of a 10,000 km service cycle and under 3% of a 30,000 km one. Zero means
    # "tell me only once it is overdue".
    service_warning_days = models.PositiveIntegerField(default=30)
    service_warning_km = models.PositiveIntegerField(default=800)
    registration_warning_days = models.PositiveIntegerField(default=30)
    registration_date = models.DateField(null=True, blank=True)
    registration_expiry = models.DateField(null=True, blank=True)

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
