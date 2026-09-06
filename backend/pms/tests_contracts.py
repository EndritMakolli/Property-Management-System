"""Contract drafts for an apartment let and a car hire.

Same shape as `MessageTemplate`: a fixed set of rows, seeded with a usable
default and then edited in place by the operator. The wording is theirs; what
this guarantees is that the placeholders resolve and that nothing is emitted
with a `(guest name)` still sitting in it unnoticed.

Rendering reuses `render_template` from views/_drafts.py rather than growing a
second placeholder engine — the two would drift, and the operator would have to
learn two syntaxes for the same brackets.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import CompanyProfile, ContractTemplate, Guest, Property, Reservation
from .tests import make_property


def staff_client(role="Admin", username="contract-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client


def make_stay(prop, name="Arben Krasniqi", **extra):
    today = date.today()
    return Reservation.objects.create(
        property=prop,
        guest_name=name,
        guest_phone="044123456",
        platform="private",
        check_in=extra.pop("check_in", today),
        check_out=extra.pop("check_out", today + timedelta(days=5)),
        nightly_price_eur=Decimal("50.00"),
        **extra,
    )


class ContractTemplateSeedTests(TestCase):
    """Both drafts exist and say something usable out of the box."""

    def test_both_kinds_are_seeded(self):
        kinds = set(ContractTemplate.objects.values_list("kind", flat=True))
        self.assertEqual(kinds, {"apartment", "vehicle"})

    def test_the_apartment_draft_is_not_empty(self):
        template = ContractTemplate.objects.get(kind="apartment")
        self.assertGreater(len(template.body_en.strip()), 400)
        self.assertGreater(len(template.body_sq.strip()), 400)

    def test_the_vehicle_draft_is_not_empty(self):
        template = ContractTemplate.objects.get(kind="vehicle")
        self.assertGreater(len(template.body_en.strip()), 400)
        self.assertGreater(len(template.body_sq.strip()), 400)

    def test_the_apartment_draft_refers_to_the_stay(self):
        """The terms name the dates and the price; who the parties are is laid
        out by the document, not typed into the template."""
        body = ContractTemplate.objects.get(kind="apartment").body_en
        for placeholder in ["(check-in)", "(check-out)", "(total price)"]:
            self.assertIn(placeholder, body, f"{placeholder} missing from the apartment draft")

    def test_the_vehicle_draft_refers_to_the_hire(self):
        body = ContractTemplate.objects.get(kind="vehicle").body_en
        for placeholder in ["(check-in)", "(check-out)", "(total price)"]:
            self.assertIn(placeholder, body, f"{placeholder} missing from the vehicle draft")

    def test_neither_draft_retypes_the_company_address(self):
        """It is already on the company profile; the document reads it there."""
        for kind in ("apartment", "vehicle"):
            with self.subTest(kind=kind):
                body = ContractTemplate.objects.get(kind=kind).body_en
                self.assertNotIn("(company address)", body)
                self.assertNotIn("(guest name)", body)

    def test_seeding_never_overwrites_an_edited_body(self):
        """The operator's wording survives a reference-data restore."""
        from .reference_data import ensure_reference_data

        template = ContractTemplate.objects.get(kind="apartment")
        template.body_en = "My own wording."
        template.save()
        ensure_reference_data()
        template.refresh_from_db()
        self.assertEqual(template.body_en, "My own wording.")

    def test_a_missing_template_is_restored(self):
        from .reference_data import ensure_reference_data

        ContractTemplate.objects.filter(kind="vehicle").delete()
        ensure_reference_data()
        self.assertTrue(ContractTemplate.objects.filter(kind="vehicle").exists())


class ContractTemplateApiTests(TestCase):
    def setUp(self):
        self.client = staff_client()

    def test_the_list_returns_both_drafts(self):
        response = self.client.get("/api/contract-templates/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["templates"]), 2)

    def test_a_draft_can_be_edited(self):
        response = self.client.patch(
            "/api/contract-templates/apartment/",
            data={"bodyEn": "Rewritten by the operator."},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            ContractTemplate.objects.get(kind="apartment").body_en, "Rewritten by the operator."
        )

    def test_editing_one_language_leaves_the_other_alone(self):
        before = ContractTemplate.objects.get(kind="apartment").body_sq
        self.client.patch(
            "/api/contract-templates/apartment/",
            data={"bodyEn": "English only."},
            content_type="application/json",
        )
        self.assertEqual(ContractTemplate.objects.get(kind="apartment").body_sq, before)

    def test_an_unknown_kind_is_a_404(self):
        response = self.client.patch(
            "/api/contract-templates/spaceship/",
            data={"bodyEn": "x"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    def test_cleaning_cannot_read_the_contracts(self):
        cleaner = staff_client(role="Cleaning", username="contract-cleaner")
        self.assertEqual(cleaner.get("/api/contract-templates/").status_code, 403)

    def test_cleaning_cannot_edit_them(self):
        cleaner = staff_client(role="Cleaning", username="contract-cleaner2")
        response = cleaner.patch(
            "/api/contract-templates/apartment/",
            data={"bodyEn": "x"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)


class ContractRenderTests(TestCase):
    """Filling a draft in for one reservation."""

    def setUp(self):
        self.client = staff_client(username="contract-render")
        company = CompanyProfile.get()
        company.name = "AirStay LLC"
        company.tax_id = "811111111"
        company.address = "Rr. Tirana 12"
        company.city = "Prishtina"
        company.save()
        self.prop = make_property(name="Apartment #2")
        self.prop.address = "Rr. Agim Ramadani 4"
        self.prop.floor = "third floor"
        self.prop.save()
        self.stay = make_stay(self.prop)

    def render(self, reservation=None, language="en"):
        target = reservation or self.stay
        return self.client.get(
            f"/api/reservations/{target.id}/contract/", {"language": language}
        )

    def test_it_renders(self):
        self.assertEqual(self.render().status_code, 200)

    def test_the_guest_is_returned_as_data_for_the_document_to_lay_out(self):
        self.assertEqual(self.render().json()["client"]["name"], "Arben Krasniqi")

    def test_the_company_is_returned_as_data(self):
        company = self.render().json()["company"]
        self.assertEqual(company["name"], "AirStay LLC")
        self.assertEqual(company["taxId"], "811111111")

    def test_the_subject_of_the_agreement_is_returned_as_data(self):
        subject = self.render().json()["subject"]
        self.assertEqual(subject["name"], "Apartment #2")
        self.assertIn("Rr. Agim Ramadani 4", subject["address"])
        self.assertFalse(subject["isVehicle"])

    def test_a_vehicle_hire_says_so(self):
        car = make_property(name="Kia Xceed", platform=Property.Platform.FLEET)
        hire = make_stay(car, name="Driton Berisha")
        self.assertTrue(self.render(hire).json()["subject"]["isVehicle"])

    def test_the_document_carries_a_reference_and_a_date(self):
        payload = self.render().json()
        self.assertTrue(payload["reference"])
        self.assertTrue(payload["issuedOn"])

    def test_the_dates_are_filled_in(self):
        """Compared without a leading zero: the English format renders
        "1 Sep 2026", so asserting "01" tested the strftime, not the render."""
        body = self.render().json()["body"]
        self.assertIn(str(self.stay.check_in.day), body)
        self.assertIn(self.stay.check_in.strftime("%b"), body)

    def test_no_placeholder_survives_for_a_complete_reservation(self):
        """A contract handed to a guest must not read "(guest name)"."""
        self.assertEqual(self.render().json()["unresolved"], [])

    def test_a_reservation_with_no_guest_name_still_renders_the_terms(self):
        """The name is a document field now, so an empty one is not an
        unresolved placeholder - it is simply a blank on the printed line."""
        bare = make_stay(make_property(name="Apartment #9"), name="")
        payload = self.render(bare).json()
        self.assertEqual(payload["client"]["name"], "")
        self.assertTrue(payload["body"].strip())

    def test_it_picks_the_apartment_draft_for_an_apartment(self):
        self.assertEqual(self.render().json()["kind"], "apartment")

    def test_it_picks_the_vehicle_draft_for_a_fleet_reservation(self):
        car = make_property(name="Kia Xceed", platform=Property.Platform.FLEET)
        hire = make_stay(car, name="Driton Berisha")
        self.assertEqual(self.render(hire).json()["kind"], "vehicle")

    def test_albanian_is_available(self):
        payload = self.render(language="sq").json()
        self.assertEqual(payload["language"], "sq")
        # The terms come back in Albanian; the parties come back as data either way.
        self.assertIn("PAGESA", payload["body"])
        self.assertEqual(payload["client"]["name"], "Arben Krasniqi")

    def test_the_dates_reach_the_albanian_terms(self):
        body = self.render(language="sq").json()["body"]
        self.assertIn(self.stay.check_in.strftime("%d"), body)

    def test_an_unknown_language_falls_back_rather_than_erroring(self):
        response = self.render(language="de")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["body"].strip())

    def test_an_unknown_reservation_is_a_404(self):
        response = self.client.get(
            "/api/reservations/6b1f0f1e-0000-4000-8000-000000000000/contract/"
        )
        self.assertEqual(response.status_code, 404)

    def test_cleaning_cannot_pull_a_contract(self):
        cleaner = staff_client(role="Cleaning", username="contract-cleaner3")
        response = cleaner.get(f"/api/reservations/{self.stay.id}/contract/")
        self.assertEqual(response.status_code, 403)


class VehicleIdentityOnTheContractTests(TestCase):
    """A hire agreement has to name *this* car, not a model.

    Brand, type, chassis number and plates are recorded per vehicle on the
    Fleet page and printed in the header table of the contract. Without them
    the agreement identifies nothing and is not much use if it is ever needed.
    """

    def setUp(self):
        self.client = staff_client(username="contract-vehicle")
        self.car = make_property(name="Kia Xceed", platform=Property.Platform.FLEET)
        self.car.brand = "Kia"
        self.car.model = "Stonic"
        self.car.chassis_number = "KNADA814BRT920569"
        self.car.licence_plate = "01-695-CZ"
        self.car.allowed_countries = "Kosovo, Albania, Montenegro, Macedonia"
        self.car.current_km = 42000
        self.car.save()
        self.hire = make_stay(self.car, name="Driton Berisha")

    def subject(self):
        response = self.client.get(f"/api/reservations/{self.hire.id}/contract/")
        self.assertEqual(response.status_code, 200)
        return response.json()["subject"]

    def test_the_brand_reaches_the_contract(self):
        self.assertEqual(self.subject()["brand"], "Kia")

    def test_the_type_reaches_the_contract(self):
        self.assertEqual(self.subject()["model"], "Stonic")

    def test_the_chassis_number_reaches_the_contract(self):
        self.assertEqual(self.subject()["chassisNumber"], "KNADA814BRT920569")

    def test_the_plates_reach_the_contract(self):
        self.assertEqual(self.subject()["licencePlate"], "01-695-CZ")

    def test_where_it_may_be_driven_reaches_the_contract(self):
        self.assertIn("Montenegro", self.subject()["allowedCountries"])

    def test_a_vehicle_with_nothing_recorded_still_renders(self):
        """A blank chassis prints an empty cell, it does not break the page."""
        bare = make_property(name="Dacia", platform=Property.Platform.FLEET)
        hire = make_stay(bare, name="Someone")
        response = self.client.get(f"/api/reservations/{hire.id}/contract/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["subject"]["chassisNumber"], "")

    def test_an_apartment_carries_no_vehicle_identity(self):
        flat = make_property(name="Apartment #7")
        stay = make_stay(flat, name="Guest")
        subject = self.client.get(f"/api/reservations/{stay.id}/contract/").json()["subject"]
        self.assertFalse(subject["isVehicle"])
        self.assertEqual(subject["brand"], "")


class ContractNeverLeaksIdDocumentsTests(TestCase):
    """A contract is printed and handed to the guest.

    ID documents are passports and national IDs. CLAUDE.md keeps them off
    /media/ and behind a role-checked download view; putting a link to one in
    a contract payload would walk straight around that. The placeholder is a
    *number* the operator writes in by hand, and there is no such field on the
    client record - so it stays empty rather than being wired to the nearest
    thing with "id" in its name.
    """

    def setUp(self):
        self.client = staff_client(username="contract-pii")
        self.prop = make_property(name="Apartment #4")
        self.stay = make_stay(self.prop)
        self.guest = Guest.objects.create(
            first_name="Arben",
            last_name="Krasniqi",
            id_document_url="https://example.com/media/guests/passport-scan.pdf",
        )
        self.stay.guest = self.guest
        self.stay.save()

    def payload(self):
        return self.client.get(f"/api/reservations/{self.stay.id}/contract/").json()

    def test_the_id_document_url_never_appears_anywhere_in_the_response(self):
        raw = self.client.get(f"/api/reservations/{self.stay.id}/contract/").content.decode()
        self.assertNotIn("passport-scan.pdf", raw)
        self.assertNotIn("/media/guests/", raw)

    def test_the_id_number_field_is_blank_for_the_operator_to_fill_in(self):
        self.assertEqual(self.payload()["client"]["idNumber"], "")

    def test_no_door_code_wifi_or_coordinate_reaches_a_contract(self):
        self.prop.wifi_password = "hunter2-wifi"
        self.prop.latitude = "42.662914"
        self.prop.longitude = "21.165503"
        self.prop.save()
        raw = self.client.get(f"/api/reservations/{self.stay.id}/contract/").content.decode()
        for secret in ("hunter2-wifi", "42.662914", "21.165503"):
            self.assertNotIn(secret, raw)
