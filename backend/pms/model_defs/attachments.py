import uuid

from django.db import models


class ReservationAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reservation_id = models.UUIDField(db_index=True)
    file = models.FileField(upload_to="reservations/attachments/")
    original_name = models.CharField(max_length=255, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self):
        return f"Attachment for reservation {self.reservation_id}: {self.original_name}"
