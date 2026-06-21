from django.db import models

from .base import TimeStampedModel


class PropertyReview(TimeStampedModel):
    """A guest review shown on the public apartment detail page. Managed in the PMS."""

    property = models.ForeignKey(
        "pms.Property",
        on_delete=models.CASCADE,
        related_name="reviews",
    )
    guest_name = models.CharField(max_length=255)
    rating = models.PositiveSmallIntegerField(default=5)
    comment = models.TextField(blank=True)
    stay_label = models.CharField(max_length=60, blank=True, help_text="e.g. 'May 2026'")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.guest_name} · {self.rating}★"
