from decimal import Decimal

from django.db import models

from .base import TimeStampedModel
from .reservations import Reservation


class DailyEntry(TimeStampedModel):
    """One row per platform + calendar day — tracks deposit amount and receipt-left status."""

    platform = models.CharField(max_length=20)
    date = models.DateField()
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    receipt_left = models.BooleanField(default=False)
    note = models.TextField(blank=True)

    class Meta:
        unique_together = [("platform", "date")]
        ordering = ["date"]
        indexes = [
            models.Index(fields=["platform", "date"], name="pms_daily_platform_date_idx"),
        ]

    def __str__(self):
        return f"Daily entry {self.date} ({self.platform})"


class ReceiptItem(TimeStampedModel):
    """An individual receipt entry within a day."""

    daily_entry = models.ForeignKey(
        DailyEntry, on_delete=models.CASCADE, related_name="receipt_items"
    )
    value = models.DecimalField(max_digits=10, decimal_places=2)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Receipt {self.value} on {self.daily_entry.date}"


class ReceiptItemReservation(models.Model):
    """Through table: links one receipt item to one reservation."""

    receipt_item = models.ForeignKey(
        ReceiptItem, on_delete=models.CASCADE, related_name="reservation_links"
    )
    reservation = models.ForeignKey(
        Reservation, on_delete=models.CASCADE, related_name="receipt_links"
    )

    class Meta:
        unique_together = [("receipt_item", "reservation")]

    def __str__(self):
        return f"Link {self.receipt_item_id} → {self.reservation_id}"
