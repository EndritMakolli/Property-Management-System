import uuid

from django.db import models

from .base import TimeStampedModel
from .properties import Property


class MaintenanceIssue(TimeStampedModel):
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="maintenance_issues")
    description = models.TextField()
    reporter_name = models.CharField(max_length=150, blank=True)
    reported_at = models.DateField(auto_now_add=True)

    class Meta:
        ordering = ["-reported_at", "-created_at"]
        indexes = [
            models.Index(fields=["property", "reported_at"]),
        ]

    def __str__(self):
        return f"{self.property} — {self.description[:60]}"


class MaintenancePhoto(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(MaintenanceIssue, on_delete=models.CASCADE, related_name="photos")
    photo = models.FileField(upload_to="maintenance/")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self):
        return f"Photo for issue {self.issue_id}"


class ApartmentCleanStatus(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    property = models.OneToOneField(Property, on_delete=models.CASCADE, related_name="clean_status")
    is_cleaned = models.BooleanField(default=False)
    cleaned_at = models.DateTimeField(blank=True, null=True)
    cleaned_by = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["property__name"]

    def __str__(self):
        status = "clean" if self.is_cleaned else "needs cleaning"
        return f"{self.property} — {status}"
