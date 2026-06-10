import uuid

from django.db import models

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
