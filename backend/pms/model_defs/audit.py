import uuid

from django.db import models


class ReservationAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reservation_id = models.UUIDField(db_index=True)
    changed_by = models.CharField(max_length=150, blank=True)
    changed_at = models.DateTimeField(auto_now_add=True)
    field_name = models.CharField(max_length=100)
    old_value = models.TextField(blank=True)
    new_value = models.TextField(blank=True)

    class Meta:
        ordering = ["-changed_at"]
        indexes = [
            models.Index(fields=["reservation_id", "changed_at"]),
        ]

    def __str__(self):
        return f"Reservation {self.reservation_id} — {self.field_name} changed by {self.changed_by}"
