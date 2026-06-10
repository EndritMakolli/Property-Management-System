import uuid

from django.db import models

from .base import TimeStampedModel


class MonthlyTax(TimeStampedModel):
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    tvsh = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tatim_ne_fitim = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-year", "-month"]
        unique_together = [("year", "month")]
        indexes = [
            models.Index(fields=["year", "month"]),
        ]

    def __str__(self):
        return f"Taxes {self.year}/{self.month:02d}"
