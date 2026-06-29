import uuid

from django.db import models

from .base import TimeStampedModel
from .properties import Property


class SyncLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="sync_logs")
    channel = models.CharField(max_length=20)
    status = models.CharField(max_length=20, default="completed")
    imported_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    conflict_count = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)
    synced_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-synced_at"]
        indexes = [
            models.Index(fields=["property", "synced_at"]),
            models.Index(fields=["channel", "synced_at"]),
        ]

    def __str__(self):
        return f"{self.property} [{self.channel}] {self.status} @ {self.synced_at}"


class SyncConflict(TimeStampedModel):
    """A channel (Airbnb/Booking) event that could not be imported because the
    slot is already taken in the PMS. Surfaced under "Needs attention" so the
    user can link it to the existing reservation or dismiss it."""

    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="sync_conflicts")
    existing_reservation = models.ForeignKey(
        "Reservation",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sync_conflicts",
    )
    channel = models.CharField(max_length=20)
    external_uid = models.CharField(max_length=255)
    check_in = models.DateField()
    check_out = models.DateField()
    summary = models.CharField(max_length=255, blank=True)
    resolved = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["property", "channel", "external_uid"],
                name="unique_sync_conflict",
            ),
        ]
        indexes = [
            models.Index(fields=["resolved", "created_at"]),
        ]

    def __str__(self):
        return f"Conflict {self.channel}:{self.external_uid} @ {self.property}"
