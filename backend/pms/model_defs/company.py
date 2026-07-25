from decimal import Decimal

from django.db import models


class CompanyProfile(models.Model):
    """Singleton company identity: shown on invoices and the public site.

    Always fetched via CompanyProfile.get() (pk=1), mirroring BookingSiteSettings.
    """

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    name = models.CharField(max_length=255, blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True, default="Kosovo")
    tax_id = models.CharField(max_length=50, blank=True, help_text="Business number (NUI/NIF)")
    vat_id = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    website = models.URLField(blank=True)
    logo = models.FileField(upload_to="company/", blank=True, null=True)
    bank_name = models.CharField(max_length=255, blank=True)
    iban = models.CharField(max_length=50, blank=True)
    swift = models.CharField(max_length=20, blank=True)
    bank_name2 = models.CharField(max_length=255, blank=True)
    iban2 = models.CharField(max_length=50, blank=True)
    swift2 = models.CharField(max_length=20, blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    default_tax_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("18.00"), help_text="Default VAT % on invoices"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Company profile"

    def __str__(self):
        return self.name or "Company profile"

    @classmethod
    def get(cls):
        obj, _created = cls.objects.get_or_create(pk=1)
        return obj
