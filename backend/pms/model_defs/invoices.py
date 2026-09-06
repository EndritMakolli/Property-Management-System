from decimal import Decimal

from django.db import models

from .base import TimeStampedModel
from .guests import Guest
from .reservations import Reservation


class Invoice(TimeStampedModel):
    """A stored invoice. Line items live in JSON ({description, quantity,
    unitPrice}); subtotal/tax/total are always computed, never stored. The
    company block is frozen into company_snapshot at creation so later profile
    edits don't rewrite old invoices."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        FINALIZED = "finalized", "Finalized"
        ARCHIVED = "archived", "Archived"

    number = models.CharField(max_length=30, unique=True)
    issue_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    paid = models.BooleanField(default=False)

    class ClientType(models.TextChoices):
        BUSINESS = "business", "Business"
        INDIVIDUAL = "individual", "Individual"

    # Bill-to block (denormalized so invoices survive client edits/deletes).
    #
    # Who is being billed decides which reference number is asked for and
    # printed. An individual has no VAT or tax number - that is not a missing
    # field, it is the normal case - and carries a personal ID instead. A
    # business carries the tax id, the VAT id and its registration number.
    # Defaulting to business keeps every invoice written before this existed
    # reading exactly as it did.
    client_type = models.CharField(
        max_length=12, choices=ClientType.choices, default=ClientType.BUSINESS
    )
    client_name = models.CharField(max_length=255, blank=True)
    # Individual: national ID or passport. Business: registration number.
    client_id_number = models.CharField(max_length=50, blank=True)
    client_registration_no = models.CharField(max_length=50, blank=True)
    client_address = models.TextField(blank=True)
    client_city = models.CharField(max_length=100, blank=True)
    client_country = models.CharField(max_length=100, blank=True)
    client_tax_id = models.CharField(max_length=50, blank=True)
    client_vat_id = models.CharField(max_length=50, blank=True)
    client_email = models.EmailField(blank=True)
    client_phone = models.CharField(max_length=30, blank=True)

    guest = models.ForeignKey(
        Guest, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )
    reservation = models.ForeignKey(
        Reservation, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )

    line_items = models.JSONField(default=list)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("18.00"))
    # Kosovo convention: prices are usually VAT-inclusive — the invoice shows
    # the VAT share of the gross total instead of adding tax on top.
    prices_include_vat = models.BooleanField(default=True)
    currency = models.CharField(max_length=3, default="EUR")
    notes = models.TextField(blank=True)
    company_snapshot = models.JSONField(default=dict)
    created_by = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["issue_date"]),
        ]

    def __str__(self):
        return f"{self.number} — {self.client_name or 'No client'}"

    @property
    def line_sum(self) -> Decimal:
        total = Decimal("0.00")
        for item in self.line_items or []:
            try:
                quantity = Decimal(str(item.get("quantity") or "0"))
                unit_price = Decimal(str(item.get("unitPrice") or "0"))
            except Exception:  # noqa: BLE001 — malformed rows count as zero
                continue
            total += quantity * unit_price
        return total.quantize(Decimal("0.01"))

    @property
    def total(self) -> Decimal:
        if self.prices_include_vat:
            return self.line_sum
        return (self.line_sum + self.tax_amount).quantize(Decimal("0.01"))

    @property
    def tax_amount(self) -> Decimal:
        rate = self.tax_rate or Decimal("0")
        if self.prices_include_vat:
            # VAT share back-computed from the gross line sum.
            gross = self.line_sum
            net = (gross / (Decimal("1") + rate / Decimal("100"))).quantize(Decimal("0.01"))
            return (gross - net).quantize(Decimal("0.01"))
        return (self.line_sum * rate / Decimal("100")).quantize(Decimal("0.01"))

    @property
    def subtotal(self) -> Decimal:
        if self.prices_include_vat:
            return (self.line_sum - self.tax_amount).quantize(Decimal("0.01"))
        return self.line_sum
