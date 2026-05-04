from builtins import property as builtin_property
from decimal import Decimal

from django.db import models

from .base import TimeStampedModel


class Guest(TimeStampedModel):
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=30, blank=True, null=True)
    whatsapp_number = models.CharField(max_length=30, blank=True, null=True)
    nationality = models.CharField(max_length=100, blank=True, null=True)
    id_document_url = models.URLField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    is_returning = models.BooleanField(default=False)

    class Meta:
        ordering = ["last_name", "first_name"]
        indexes = [
            models.Index(fields=["last_name", "first_name"]),
            models.Index(fields=["email"]),
            models.Index(fields=["phone"]),
        ]

    def __str__(self):
        return self.full_name

    @builtin_property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    @builtin_property
    def total_stays(self):
        return self.guest_stays.count()

    @builtin_property
    def total_nights(self):
        return sum(stay.nights for stay in self.guest_stays.all())

    @builtin_property
    def total_paid_eur(self):
        return sum((stay.amount_paid_eur for stay in self.guest_stays.all()), Decimal("0.00"))
