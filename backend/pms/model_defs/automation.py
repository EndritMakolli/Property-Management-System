from django.db import models
from django.utils import timezone

from .base import TimeStampedModel


class ClaudeTask(TimeStampedModel):
    class TaskType(models.TextChoices):
        DAILY_REPORT = "daily_report", "Daily Report"
        OVERLAP_CHECK = "overlap_check", "Overlap Check"
        SEND_WHATSAPP = "send_whatsapp", "Send WhatsApp"
        FLAG_INQUIRY = "flag_inquiry", "Flag Inquiry"
        SYNC_RESERVATIONS = "sync_reservations", "Sync Reservations"
        GENERATE_REPORT = "generate_report", "Generate Report"
        LINK_GUEST = "link_guest", "Link Guest"
        SEARCH_AVAILABILITY = "search_availability", "Search Availability"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"

    class TriggeredBy(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        MANUAL = "manual", "Manual"
        WEBHOOK = "webhook", "Webhook"

    task_type = models.CharField(max_length=30, choices=TaskType.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    triggered_by = models.CharField(max_length=10, choices=TriggeredBy.choices, default=TriggeredBy.MANUAL)
    input_data = models.JSONField(default=dict)
    output_data = models.JSONField(default=dict)
    error_message = models.TextField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["task_type", "created_at"]),
        ]

    def __str__(self):
        return f"[{self.task_type}] {self.status} - {self.created_at:%Y-%m-%d %H:%M}"

    def mark_done(self, output_data: dict):
        self.status = self.Status.DONE
        self.output_data = output_data
        self.completed_at = timezone.now()
        self.save()

    def mark_failed(self, error: str):
        self.status = self.Status.FAILED
        self.error_message = error
        self.completed_at = timezone.now()
        self.save()
