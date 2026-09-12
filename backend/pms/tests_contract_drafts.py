"""A contract you can edit, put down, and pick up again.

Until now a contract was rendered on demand and never stored: open it, print
it, and any correction made on screen was gone the moment the modal closed.
That is fine for a document nobody touches and wrong for one that is negotiated
- a deposit agreed on the phone, a clause struck out, an ID number written in.

So a contract now has a saved draft per reservation. The rules that matter:

  * Opening a reservation with no draft still renders from the template, so
    nothing changes for a contract nobody has edited.
  * Saving keeps exactly what was typed - a draft that silently re-renders from
    the template on reopening has thrown the edit away.
  * The draft can be reset back to the template, because the way out of a mess
    must not be deleting the reservation.
  * A draft carries no ID document and no property secret, the same as a
    freshly rendered one. `tests_contracts` holds that for the render; this
    holds it for the stored copy.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import ContractTemplate, Guest, GuestDocument, Property, Reservation, ReservationContract
from .tests import make_property


def staff_client(role="Admin", username="draft-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client


class ContractDraftTests(TestCase):
    def setUp(self):
        self.client = staff_client()
        self.prop = make_property(name="Apartment #11")
        self.reservation = Reservation.objects.create(
            property=self.prop,
            guest_name="Arben Krasniqi",
            platform="private",
            check_in=date.today(),
            check_out=date.today() + timedelta(days=4),
            nightly_price_eur=Decimal("55.00"),
        )
        self.url = f"/api/reservations/{self.reservation.id}/contract/"

    def test_a_reservation_with_no_draft_renders_from_the_template(self):
        body = self.client.get(self.url).json()
        self.assertTrue(body["body"])
        self.assertFalse(body["isDraft"])

    def test_saving_a_draft_keeps_exactly_what_was_typed(self):
        response = self.client.put(
            self.url,
            data={"body": "Agreed: deposit of 100 EUR, returned on departure."},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        reopened = self.client.get(self.url).json()
        self.assertEqual(reopened["body"], "Agreed: deposit of 100 EUR, returned on departure.")
        self.assertTrue(reopened["isDraft"])

    def test_reopening_a_draft_does_not_re_render_over_it(self):
        """The bug this exists to prevent: a draft that helpfully refreshes
        itself from the template has silently destroyed the edit."""
        self.client.put(self.url, data={"body": "Struck out clause 4."}, content_type="application/json")
        ContractTemplate.objects.filter(kind=ContractTemplate.Kind.APARTMENT).update(
            body_en="A completely different template."
        )
        self.assertEqual(self.client.get(self.url).json()["body"], "Struck out clause 4.")

    def test_a_draft_can_be_edited_again(self):
        self.client.put(self.url, data={"body": "First pass."}, content_type="application/json")
        self.client.put(self.url, data={"body": "Second pass."}, content_type="application/json")
        self.assertEqual(self.client.get(self.url).json()["body"], "Second pass.")
        self.assertEqual(ReservationContract.objects.filter(reservation=self.reservation).count(), 1)

    def test_the_hand_filled_fields_are_kept(self):
        """The ID number, licence number and deposit are written in at the desk.
        They were on paper before; losing them on reopening is the same bug."""
        self.client.put(
            self.url,
            data={
                "body": "Terms.",
                "clientIdNumber": "1234567890",
                "licenceNumber": "K-88-771",
                "deposit": "100",
            },
            content_type="application/json",
        )
        body = self.client.get(self.url).json()
        self.assertEqual(body["client"]["idNumber"], "1234567890")
        self.assertEqual(body["fields"]["licenceNumber"], "K-88-771")
        self.assertEqual(body["fields"]["deposit"], "100")

    def test_a_draft_can_be_reset_back_to_the_template(self):
        self.client.put(self.url, data={"body": "Nonsense."}, content_type="application/json")
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 200)
        reopened = self.client.get(self.url).json()
        self.assertFalse(reopened["isDraft"])
        self.assertNotEqual(reopened["body"], "Nonsense.")

    def test_each_language_keeps_its_own_draft(self):
        """An Albanian contract edited at the desk must not overwrite the
        English one a different guest signed last week."""
        self.client.put(f"{self.url}?language=en", data={"body": "English terms."}, content_type="application/json")
        self.client.put(f"{self.url}?language=sq", data={"body": "Kushtet shqip."}, content_type="application/json")
        self.assertEqual(self.client.get(f"{self.url}?language=en").json()["body"], "English terms.")
        self.assertEqual(self.client.get(f"{self.url}?language=sq").json()["body"], "Kushtet shqip.")

    def test_one_reservations_draft_does_not_leak_into_another(self):
        other = Reservation.objects.create(
            property=self.prop,
            guest_name="Someone Else",
            platform="private",
            check_in=date.today() + timedelta(days=30),
            check_out=date.today() + timedelta(days=33),
            nightly_price_eur=Decimal("55.00"),
        )
        self.client.put(self.url, data={"body": "Mine."}, content_type="application/json")
        self.assertNotEqual(
            self.client.get(f"/api/reservations/{other.id}/contract/").json()["body"], "Mine."
        )

    def test_saving_records_who_last_touched_it(self):
        self.client.put(self.url, data={"body": "Terms."}, content_type="application/json")
        draft = ReservationContract.objects.get(reservation=self.reservation)
        self.assertEqual(draft.updated_by.username, "draft-admin")
        self.assertIsNotNone(draft.updated_at)

    def test_cleaning_cannot_read_or_write_a_contract(self):
        cleaner = staff_client(role="Cleaning", username="draft-cleaner")
        self.assertEqual(cleaner.get(self.url).status_code, 403)
        self.assertEqual(
            cleaner.put(self.url, data={"body": "x"}, content_type="application/json").status_code, 403
        )

    def test_a_signed_out_visitor_gets_nothing(self):
        self.assertIn(Client().get(self.url).status_code, (401, 403))

    def test_an_unknown_reservation_is_404(self):
        missing = "11111111-1111-1111-1111-111111111111"
        self.assertEqual(self.client.get(f"/api/reservations/{missing}/contract/").status_code, 404)

    def test_a_body_that_is_not_a_string_is_refused(self):
        response = self.client.put(self.url, data={"body": {"x": 1}}, content_type="application/json")
        self.assertEqual(response.status_code, 400)


class DraftsCarryNoSecretsTests(TestCase):
    """The stored copy is held to the same line as the rendered one."""

    def setUp(self):
        self.client = staff_client(username="draft-secret-admin")
        self.prop = make_property(
            name="Apartment #12",
            wifi_password="hunter2-very-secret",
            latitude=Decimal("42.66"),
            longitude=Decimal("21.16"),
        )
        self.guest = Guest.objects.create(first_name="Arben", last_name="Krasniqi")
        GuestDocument.objects.create(
            guest=self.guest, doc_type="passport", file="guests/passport-scan.jpg"
        )
        self.reservation = Reservation.objects.create(
            property=self.prop,
            guest=self.guest,
            guest_name="Arben Krasniqi",
            platform="private",
            check_in=date.today(),
            check_out=date.today() + timedelta(days=2),
            nightly_price_eur=Decimal("55.00"),
        )
        self.url = f"/api/reservations/{self.reservation.id}/contract/"

    def test_a_saved_draft_still_carries_no_passport_scan(self):
        self.client.put(self.url, data={"body": "Terms."}, content_type="application/json")
        raw = self.client.get(self.url).content.decode()
        self.assertNotIn("passport-scan", raw)

    def test_a_saved_draft_still_carries_no_wifi_password(self):
        self.client.put(self.url, data={"body": "Terms."}, content_type="application/json")
        raw = self.client.get(self.url).content.decode()
        self.assertNotIn("hunter2-very-secret", raw)

    def test_the_id_number_stays_a_number_somebody_typed(self):
        """It must never be wired to the uploaded document. A contract is
        printed and handed to the guest."""
        body = self.client.get(self.url).json()
        self.assertEqual(body["client"]["idNumber"], "")
