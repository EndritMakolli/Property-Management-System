"""Invoicing an individual as well as a business.

The bill-to block already held a name, address, phone, email, tax id and VAT
id. What it could not do was say *who* it was billing. Every invoice was shaped
like a business one, so an invoice to a private guest either carried two empty
tax fields or invited someone to type a personal ID into a box labelled VAT.

`client_type` is the fix, and it earns its place by changing three things:
which reference number is asked for, which one is printed, and - the part that
matters - what may be left blank. An individual with no tax id is a complete
invoice, not an incomplete one.
"""

from datetime import date
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import Invoice


def staff_client(role="Admin", username="invoice-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client


def payload(**overrides):
    body = {
        "number": "2026-0001",
        "issueDate": date.today().isoformat(),
        "clientName": "Arben Krasniqi",
        "lineItems": [{"description": "Accommodation", "quantity": 3, "unitPrice": "50.00"}],
        "taxRate": "18.00",
    }
    body.update(overrides)
    return body


class CustomerTypeTests(TestCase):
    def setUp(self):
        self.client = staff_client()

    def create(self, **overrides):
        return self.client.post(
            "/api/invoices/", data=payload(**overrides), content_type="application/json"
        )

    def test_an_invoice_defaults_to_a_business(self):
        """Every invoice before this change was a business one; keep that."""
        response = self.create()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["invoice"]["clientType"], "business")

    def test_an_individual_can_be_billed(self):
        response = self.create(clientType="individual")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["invoice"]["clientType"], "individual")

    def test_an_individual_needs_no_tax_id(self):
        """The whole point: a private guest has neither a VAT nor a tax number."""
        response = self.create(clientType="individual", clientTaxId="", clientVatId="")
        self.assertEqual(response.status_code, 201)

    def test_an_individual_carries_a_personal_id_instead(self):
        response = self.create(clientType="individual", clientIdNumber="1234567890")
        self.assertEqual(response.json()["invoice"]["clientIdNumber"], "1234567890")

    def test_a_business_carries_a_registration_number(self):
        response = self.create(clientType="business", clientRegistrationNo="70123456")
        self.assertEqual(response.json()["invoice"]["clientRegistrationNo"], "70123456")

    def test_a_business_still_carries_tax_and_vat(self):
        response = self.create(
            clientType="business", clientTaxId="811111111", clientVatId="330011223"
        )
        row = response.json()["invoice"]
        self.assertEqual(row["clientTaxId"], "811111111")
        self.assertEqual(row["clientVatId"], "330011223")

    def test_an_unknown_customer_type_is_refused(self):
        response = self.create(clientType="alien")
        self.assertEqual(response.status_code, 400)

    def test_the_type_can_be_changed_afterwards(self):
        created = self.create().json()["invoice"]
        response = self.client.patch(
            f"/api/invoices/{created['id']}/",
            data={"clientType": "individual"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["invoice"]["clientType"], "individual")

    def test_an_individual_keeps_the_contact_details_that_identify_them(self):
        response = self.create(
            clientType="individual",
            clientAddress="Rr. Agim Ramadani 4",
            clientCity="Prishtina",
            clientPhone="044123456",
            clientEmail="arben@example.com",
        )
        row = response.json()["invoice"]
        self.assertEqual(row["clientAddress"], "Rr. Agim Ramadani 4")
        self.assertEqual(row["clientPhone"], "044123456")
        self.assertEqual(row["clientEmail"], "arben@example.com")

    def test_a_name_is_still_required_for_either_kind(self):
        """Whoever is being billed, the invoice has to say who."""
        for kind in ("individual", "business"):
            with self.subTest(kind=kind):
                response = self.create(clientType=kind, clientName="")
                self.assertEqual(response.status_code, 400)

    def test_existing_invoices_read_as_businesses(self):
        """A row written before the column existed must not come back blank."""
        invoice = Invoice.objects.create(
            number="2025-9999",
            issue_date=date.today(),
            client_name="Old Co",
            line_items=[],
            tax_rate=Decimal("18.00"),
        )
        response = self.client.get(f"/api/invoices/{invoice.id}/")
        self.assertEqual(response.json()["invoice"]["clientType"], "business")


class CustomerTypeRolesTests(TestCase):
    def test_cleaning_cannot_create_an_invoice(self):
        cleaner = staff_client(role="Cleaning", username="invoice-cleaner")
        response = cleaner.post(
            "/api/invoices/", data=payload(), content_type="application/json"
        )
        self.assertEqual(response.status_code, 403)
