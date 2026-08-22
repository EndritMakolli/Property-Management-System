import uuid
from decimal import Decimal

from django.db import models
from django.db.models.functions import Lower
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
    # Radius (meters) of the approximate-location circle shown to guests on maps.
    # Exact coordinates are never sent to the public site while this is > 0.
    map_privacy_radius_m = models.PositiveIntegerField(default=300)

    class Meta:
        verbose_name = "Booking Site Settings"
        verbose_name_plural = "Booking Site Settings"

    def __str__(self):
        return "Booking Site Settings"

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class PricingGroup(TimeStampedModel):
    """An ordered bucket of pricing rules sharing one interaction behaviour."""

    class Behaviour(models.TextChoices):
        # STACK is the only behaviour where sort_order decides the outcome.
        # The other three pick a single winner by a property of the rules
        # themselves, so their rules can be displayed in any order without
        # changing a price — see _pricing_engine._single_winner.
        STACK = "stack", "Stack — every eligible rule applies, in order"
        EXCLUSIVE = "exclusive", "Exclusive — the first eligible rule applies"
        BEST = "best", "Best — the eligible rule that gives the lowest price applies"
        SPECIFIC = "specific", "Most specific — the narrowest matching rule applies"

    # AirStay rents apartments and Fleet rents vehicles; they shared one set
    # of rules, so a bedroom-based rate or a 28-night tier written for a flat
    # was also pricing a car. A group belongs to exactly one platform, and the
    # engine only ever loads the groups belonging to the property it is
    # pricing — see _pricing_engine._load_rules.
    platform = models.CharField(
        max_length=20,
        choices=Property.Platform.choices,
        default=Property.Platform.AIRSTAY,
        db_index=True,
    )
    name = models.CharField(max_length=80)
    sort_order = models.PositiveIntegerField(default=0)
    behaviour = models.CharField(
        max_length=10, choices=Behaviour.choices, default=Behaviour.STACK
    )

    class Meta:
        ordering = ["sort_order", "id"]
        # Both platforms want a group called "Base Prices"; only one per
        # platform may.
        constraints = [
            models.UniqueConstraint(fields=["platform", "name"], name="unique_group_name_per_platform"),
        ]

    def __str__(self):
        return f"{self.name} ({self.platform})"


class PricingRule(TimeStampedModel):
    class RuleType(models.TextChoices):
        # The nightly rate everything else works from. Dateless by design:
        # a rate that only holds between two dates is a SEASONAL rule.
        BASE_PRICE = "base_price", "Base Price"
        # Changes no rate; locks the nights it covers so no whole-stay
        # discount can reach them. See _pricing_engine pass 1.
        BLOCK_DISCOUNTS = "block_discounts", "Exclude Discounts"
        # Raises or lowers the rate over a date range. Distinct from SEASONAL,
        # which states an absolute nightly price.
        DATE_ADJUST = "date_adjust", "Date Increase / Decrease"
        LONG_STAY = "long_stay", "Long Stay Discount"
        SEASONAL = "seasonal", "Seasonal / Date-Range Pricing"
        LAST_MINUTE = "last_minute", "Last-Minute Discount"
        NON_REFUNDABLE = "non_refundable", "Non-Refundable Discount"
        PROMO = "promo", "Promo Code"
        MANUAL = "manual", "Manual Discount"

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

    class Application(models.TextChoices):
        PER_NIGHT = "per_night", "Per night"
        WHOLE_STAY = "whole_stay", "Whole stay"

    name = models.CharField(max_length=120, blank=True)
    group = models.ForeignKey(
        PricingGroup, on_delete=models.PROTECT, related_name="rules",
    )
    sort_order = models.PositiveIntegerField(default=0)
    application = models.CharField(
        max_length=12, choices=Application.choices, default=Application.WHOLE_STAY
    )
    # Per-night rules only: locks the night at the end of this rule's group, so
    # later groups and every whole-stay adjustment skip it entirely.
    is_final = models.BooleanField(default=False)

    # Percentages that stack ADD instead of compounding, so a 10%, a 15% and
    # a 30% loading over the same night read as 55% rather than 64.45%. See
    # _pricing_engine pass 1.
    stacks = models.BooleanField(default=False)

    # What a BLOCK_DISCOUNTS rule excludes on the nights it covers. Both null
    # means "every whole-stay discount", which is the safe default and what
    # the night lock has always done. Naming one narrows it, so a peak-date
    # fence can stop the long-stay ladder while leaving promo codes working.
    #
    # CASCADE, not SET_NULL: an exclusion whose target no longer exists has no
    # meaning, and SET_NULL would silently promote it to blocking EVERY
    # discount — quietly charging guests more. Deleting it instead errs toward
    # fewer blocks, which is the safer way to be wrong.
    blocks_group = models.ForeignKey(
        "PricingGroup",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="blocked_by",
    )
    blocks_rule = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="blocked_by",
    )

    # Promo rules only.
    code = models.CharField(max_length=50, null=True, blank=True)
    usage_limit = models.PositiveIntegerField(null=True, blank=True, help_text="Null means unlimited")
    usage_count = models.PositiveIntegerField(default=0)
    min_subtotal_eur = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    rule_type = models.CharField(max_length=20, choices=RuleType.choices)
    scope = models.CharField(max_length=20, choices=Scope.choices, default=Scope.ALL)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, null=True, blank=True, related_name="pricing_rules"
    )
    bedroom_group = models.PositiveIntegerField(null=True, blank=True, help_text="Number of bedrooms this rule targets")
    enabled = models.BooleanField(default=True)

    # Long stay / last-minute / min-nights
    min_nights = models.PositiveIntegerField(null=True, blank=True)

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
        ordering = ["sort_order", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["code"],
                condition=models.Q(code__isnull=False),
                name="pricingrule_code_unique_when_set",
            )
        ]

    def __str__(self):
        return f"{self.get_rule_type_display()} ({self.scope})"


class StayConstraint(TimeStampedModel):
    """Non-price booking limits. These gate whether a stay is bookable; they
    never change its price, which is why they are not PricingRules."""

    class Kind(models.TextChoices):
        MIN_NIGHTS = "min_nights", "Minimum nights"
        # How far ahead guests may book. The cutoff is `end_date`, which
        # already means "the last date this applies to"; `value` counts
        # nothing here, which is why it is nullable.
        MAX_ADVANCE = "max_advance", "Latest bookable date"

    class Scope(models.TextChoices):
        ALL = "all", "All Properties"
        PROPERTY = "property", "Specific Property"
        BEDROOM_GROUP = "bedroom_group", "Bedroom Group"

    # Same split as PricingGroup: a two-night minimum written for apartments
    # must not block a one-day car hire.
    platform = models.CharField(
        max_length=20,
        choices=Property.Platform.choices,
        default=Property.Platform.AIRSTAY,
        db_index=True,
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.MIN_NIGHTS)
    value = models.PositiveIntegerField(null=True, blank=True)
    scope = models.CharField(max_length=20, choices=Scope.choices, default=Scope.ALL)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, null=True, blank=True, related_name="stay_constraints"
    )
    bedroom_group = models.PositiveIntegerField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "scope"]

    def __str__(self):
        return f"{self.get_kind_display()} {self.value} ({self.scope})"


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
    promo_code = models.ForeignKey(
        PricingRule, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="booking_requests",
    )
    reservation = models.ForeignKey(
        Reservation, on_delete=models.SET_NULL, null=True, blank=True, related_name="booking_request"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "expires_at"]),
            models.Index(fields=["property", "check_in", "check_out"]),
            models.Index(fields=["token"]),
            # The guest portal matches a signed-in account to the bookings
            # it made by the email they were made with.
            models.Index(Lower("guest_email"), name="bookingreq_email_lower"),
        ]

    def save(self, *args, **kwargs):
        if self.check_in and self.check_out:
            self.nights = (self.check_out - self.check_in).days
        if not self.expires_at:
            self.expires_at = timezone.now() + timezone.timedelta(hours=24)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.guest_name} @ {self.property.name} ({self.check_in}–{self.check_out}) [{self.status}]"
