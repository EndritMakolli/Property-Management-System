import uuid
from decimal import Decimal

from django.db import models
from django.utils import timezone

from .base import TimeStampedModel
from .properties import Property
from .reservations import Reservation


class PropertyPhoto(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="photos")
    photo = models.FileField(upload_to="properties/photos/")
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"Photo {self.sort_order} for {self.property.name}"


class Amenity(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    icon = models.CharField(max_length=50, blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "Amenities"

    def __str__(self):
        return self.name


class PropertyAmenity(models.Model):
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="property_amenities")
    amenity = models.ForeignKey(Amenity, on_delete=models.CASCADE, related_name="property_amenities")

    class Meta:
        unique_together = [("property", "amenity")]

    def __str__(self):
        return f"{self.property.name} — {self.amenity.name}"


class HouseRule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    text = models.TextField()
    sort_order = models.PositiveIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.text[:80]


class BookingSiteSettings(models.Model):
    """Singleton — always use get_or_create(pk=1)."""

    whatsapp_number = models.CharField(max_length=30, blank=True)
    building_address = models.TextField(blank=True)
    building_name = models.CharField(max_length=255, blank=True)
    same_day_booking_enabled = models.BooleanField(default=True)
    same_day_booking_cutoff_hour = models.PositiveIntegerField(default=18)
    advance_booking_limit_months = models.PositiveIntegerField(default=12)
    non_refundable_discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("10.00"))

    class Meta:
        verbose_name = "Booking Site Settings"
        verbose_name_plural = "Booking Site Settings"

    def __str__(self):
        return "Booking Site Settings"

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class PricingRule(TimeStampedModel):
    class RuleType(models.TextChoices):
        LONG_STAY = "long_stay", "Long Stay Discount"
        SEASONAL = "seasonal", "Seasonal / Date-Range Pricing"
        LAST_MINUTE = "last_minute", "Last-Minute Discount"
        MINIMUM_NIGHTS = "minimum_nights", "Minimum Nights"

    class Scope(models.TextChoices):
        ALL = "all", "All Properties"
        PROPERTY = "property", "Specific Property"
        BEDROOM_GROUP = "bedroom_group", "Bedroom Group"

    class AdjustmentType(models.TextChoices):
        FIXED_PRICE = "fixed_price", "Fixed Nightly Price"
        PCT_INCREASE = "pct_increase", "Percentage Increase"
        PCT_DECREASE = "pct_decrease", "Percentage Decrease"
        FIXED_INCREASE = "fixed_increase", "Fixed Amount Increase"
        FIXED_DECREASE = "fixed_decrease", "Fixed Amount Decrease"

    rule_type = models.CharField(max_length=20, choices=RuleType.choices)
    scope = models.CharField(max_length=20, choices=Scope.choices, default=Scope.ALL)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, null=True, blank=True, related_name="pricing_rules"
    )
    bedroom_group = models.PositiveIntegerField(null=True, blank=True, help_text="Number of bedrooms this rule targets")
    enabled = models.BooleanField(default=True)

    # Long stay / last-minute / min-nights
    min_nights = models.PositiveIntegerField(null=True, blank=True)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    # Last-minute
    days_before_checkin = models.PositiveIntegerField(null=True, blank=True)

    # Seasonal
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    adjustment_type = models.CharField(
        max_length=20, choices=AdjustmentType.choices, null=True, blank=True
    )
    adjustment_value = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["rule_type", "scope"]

    def __str__(self):
        return f"{self.get_rule_type_display()} ({self.scope})"


class PromoCode(TimeStampedModel):
    class DiscountType(models.TextChoices):
        PERCENTAGE = "percentage", "Percentage"
        FIXED_AMOUNT = "fixed_amount", "Fixed Amount"

    class Scope(models.TextChoices):
        ALL = "all", "All Properties"
        PROPERTY = "property", "Specific Property"
        BEDROOM_GROUP = "bedroom_group", "Bedroom Group"

    code = models.CharField(max_length=50, unique=True)
    discount_type = models.CharField(max_length=20, choices=DiscountType.choices)
    discount_value = models.DecimalField(max_digits=10, decimal_places=2)
    scope = models.CharField(max_length=20, choices=Scope.choices, default=Scope.ALL)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, null=True, blank=True, related_name="promo_codes"
    )
    bedroom_group = models.PositiveIntegerField(null=True, blank=True)
    usage_limit = models.PositiveIntegerField(null=True, blank=True, help_text="Null means unlimited")
    usage_count = models.PositiveIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return self.code


class CancellationPolicy(TimeStampedModel):
    class Scope(models.TextChoices):
        ALL = "all", "All Properties"
        PROPERTY = "property", "Specific Property"
        BEDROOM_GROUP = "bedroom_group", "Bedroom Group"

    class PolicyType(models.TextChoices):
        FREE = "free", "Free Cancellation"
        PARTIAL = "partial", "Partial Refund"
        NON_REFUNDABLE = "non_refundable", "Non-Refundable"

    scope = models.CharField(max_length=20, choices=Scope.choices, default=Scope.ALL)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, null=True, blank=True, related_name="cancellation_policies"
    )
    bedroom_group = models.PositiveIntegerField(null=True, blank=True)
    policy_type = models.CharField(max_length=20, choices=PolicyType.choices)
    days_before_checkin = models.PositiveIntegerField(
        null=True, blank=True, help_text="Guest must cancel this many days before check-in for free cancellation"
    )
    refund_pct = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True, help_text="Refund percentage for partial policy"
    )
    auto_process = models.BooleanField(default=True, help_text="Automatically process cancellation/refund")

    class Meta:
        ordering = ["scope", "policy_type"]

    def __str__(self):
        return f"{self.get_policy_type_display()} ({self.scope})"


class BookingRequest(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        EXPIRED = "expired", "Expired"

    token = models.UUIDField(default=uuid.uuid4, unique=True)
    property = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="booking_requests")
    guest_name = models.CharField(max_length=255)
    guest_email = models.EmailField()
    guest_phone = models.CharField(max_length=30)
    check_in = models.DateField()
    check_out = models.DateField()
    nights = models.PositiveIntegerField(editable=False, default=0)
    guests_count = models.PositiveIntegerField(default=1)
    total_price_eur = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    price_breakdown = models.JSONField(default=dict)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    expires_at = models.DateTimeField()
    rejection_message = models.TextField(blank=True)
    promo_code = models.ForeignKey(PromoCode, on_delete=models.SET_NULL, null=True, blank=True)
    reservation = models.ForeignKey(
        Reservation, on_delete=models.SET_NULL, null=True, blank=True, related_name="booking_request"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "expires_at"]),
            models.Index(fields=["property", "check_in", "check_out"]),
            models.Index(fields=["token"]),
        ]

    def save(self, *args, **kwargs):
        if self.check_in and self.check_out:
            self.nights = (self.check_out - self.check_in).days
        if not self.expires_at:
            self.expires_at = timezone.now() + timezone.timedelta(hours=24)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.guest_name} @ {self.property.name} ({self.check_in}–{self.check_out}) [{self.status}]"
