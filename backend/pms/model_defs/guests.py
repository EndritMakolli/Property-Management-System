import uuid
from builtins import property as builtin_property
from decimal import Decimal
from pathlib import Path

from django.db import models

from .base import TimeStampedModel


class Guest(TimeStampedModel):
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=30, blank=True, null=True)
    whatsapp_number = models.CharField(max_length=30, blank=True, null=True)
    nationality = models.CharField(max_length=100, blank=True, null=True)
    id_document_url = models.URLField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    is_returning = models.BooleanField(default=False)
    # Filed away rather than destroyed. Deleting a client used to be the only
    # option and it takes their history with them - the reservations keep their
    # typed-in name, but the stay counts, nights and spend are gone for good.
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["last_name", "first_name"]
        indexes = [
            models.Index(fields=["last_name", "first_name"]),
            models.Index(fields=["email"]),
            models.Index(fields=["phone"]),
        ]

    def __str__(self):
        return self.full_name

    @builtin_property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    @builtin_property
    def total_stays(self):
        return self.guest_stays.count()

    @builtin_property
    def total_nights(self):
        return sum(stay.nights for stay in self.guest_stays.all())

    @builtin_property
    def total_paid_eur(self):
        return sum((stay.amount_paid_eur for stay in self.guest_stays.all()), Decimal("0.00"))


def guest_document_path(instance, filename):
    """Store ID documents under an unguessable name.

    Django keeps the original filename, so a scan uploaded as `passport.jpg`
    would sit at a fully predictable path. These are passports and national
    IDs — even though the route is access-controlled, the stored name should
    not be enumerable if that control is ever bypassed.
    """
    extension = Path(filename or "").suffix.lower()[:10]
    return f"guests/documents/{uuid.uuid4().hex}{extension}"


class GuestDocument(models.Model):
    """An identification document (passport, ID card, …) attached to a guest."""

    class DocType(models.TextChoices):
        PASSPORT = "passport", "Passport"
        NATIONAL_ID = "national_id", "National ID"
        DRIVERS_LICENSE = "drivers_license", "Driver's license"
        OTHER = "other", "Other document"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    guest = models.ForeignKey(Guest, on_delete=models.CASCADE, related_name="documents")
    doc_type = models.CharField(max_length=20, choices=DocType.choices, default=DocType.OTHER)
    file = models.FileField(upload_to=guest_document_path)
    original_name = models.CharField(max_length=255, blank=True, default="")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self):
        return f"{self.guest} — {self.get_doc_type_display()}"
