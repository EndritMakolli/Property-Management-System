from django.db import models

from .base import TimeStampedModel
from .properties import Property


class DoorCode(TimeStampedModel):
    property = models.OneToOneField(Property, on_delete=models.CASCADE, related_name="door_code")
    old_code = models.CharField(max_length=100, blank=True)
    new_code = models.CharField(max_length=100, blank=True)
    date_changed = models.DateField(blank=True, null=True)
    changed_by = models.CharField(max_length=150, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["property__name"]
        indexes = [
            models.Index(fields=["date_changed"]),
        ]

    def __str__(self):
        return f"Door code - {self.property}"


class LockboxCode(TimeStampedModel):
    name = models.CharField(max_length=100, blank=True)
    apartment_number = models.CharField(max_length=100, blank=True)
    old_code = models.CharField(max_length=100, blank=True)
    new_code = models.CharField(max_length=100, blank=True)
    date_changed = models.DateField(blank=True, null=True)
    changed_by = models.CharField(max_length=150, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["apartment_number", "created_at"]
        indexes = [
            models.Index(fields=["apartment_number"]),
            models.Index(fields=["date_changed"]),
        ]

    def __str__(self):
        return f"Lockbox code - {self.apartment_number or 'Unnamed'}"
