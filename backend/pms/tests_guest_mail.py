"""Telling the guest their request was approved or rejected.

Until now nothing ever reached them. The booking form did not even ask for an
email, and the rejection message staff typed was saved to the database and read
by nobody.

Two things here are deliberately the opposite of how the existing mail and draft
code works, and both matter:

* **Fail open.** `_two_factor.py` fails *closed* — no email, no login — because a
  weakened second factor is worse than a locked-out user. Here the reverse holds:
  the reservation is already created, and rolling it back because SMTP hiccupped
  would lose real work. A send that fails says so and leaves the booking alone.

* **Strict rendering.** The staff draft renderer leaves an unfillable
  placeholder *visible*, because a human always reads the draft before sending.
  Nobody proofreads an email on its way out to a guest, so an unresolved
  placeholder refuses the send instead. "Përshëndetje (guest name)" must never
  arrive in someone's inbox.
"""

import json
from decimal import Decimal

from django.core import mail
from django.test import Client, TestCase

from .models import BookingRequest, MessageTemplate, Reservation
from .tests import day, make_admin, make_property


class LifecycleTemplateTests(TestCase):
    def test_the_two_new_scenarios_are_seeded(self):
        scenarios = set(MessageTemplate.objects.values_list("scenario", flat=True))
        self.assertIn("booking_approved", scenarios)
        self.assertIn("booking_rejected", scenarios)

    def test_they_ship_in_both_languages(self):
        for scenario in ("booking_approved", "booking_rejected"):
            row = MessageTemplate.objects.get(scenario=scenario)
            self.assertTrue(row.body_sq.strip(), scenario)
            self.assertTrue(row.body_en.strip(), scenario)

    def test_the_existing_four_are_untouched(self):
        self.assertEqual(MessageTemplate.objects.count(), 6)


class GuestMailTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property(name="Apartment A")
        self.request = BookingRequest.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            guest_email="ana@example.com",
            guest_phone="+38344111222",
            check_in=day(30),
            check_out=day(35),
            guests_count=2,
            total_price_eur=Decimal("250.00"),
            status=BookingRequest.Status.PENDING,
        )

    def draft(self, **params):
        query = "&".join(f"{key}={value}" for key, value in params.items())
        return self.client.get(f"/api/booking-requests/{self.request.id}/notify/?{query}")

    def send(self, **body):
        payload = {"language": "sq", "scenario": "booking_approved"}
        payload.update(body)
        return self.client.post(
            f"/api/booking-requests/{self.request.id}/notify/",
            data=json.dumps(payload),
            content_type="application/json",
        )

    # ---- the draft ----

    def test_a_draft_can_be_read_before_sending(self):
        response = self.draft(scenario="booking_approved", language="sq")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["body"].strip())

    def test_the_draft_is_filled_in_with_the_real_booking(self):
        body = self.draft(scenario="booking_approved", language="sq").json()["body"]
        self.assertIn("Ana Berisha", body)
        self.assertIn("Apartment A", body)

    def test_the_draft_reports_anything_it_could_not_fill(self):
        MessageTemplate.objects.filter(scenario="booking_approved").update(
            body_sq="Hello (something we do not have)"
        )
        self.assertEqual(
            self.draft(scenario="booking_approved", language="sq").json()["unresolved"],
            ["something we do not have"],
        )

    def test_the_rejection_draft_carries_the_reason_staff_typed(self):
        self.request.rejection_message = "Kemi mbyllur per mirembajtje."
        self.request.save(update_fields=["rejection_message"])
        MessageTemplate.objects.filter(scenario="booking_rejected").update(body_sq="X (reason) Y")
        body = self.draft(scenario="booking_rejected", language="sq").json()["body"]
        self.assertIn("Kemi mbyllur per mirembajtje.", body)

    # ---- sending ----

    def test_sending_delivers_an_email_to_the_guest(self):
        response = self.send(body="Pershendetje Ana, u konfirmua.")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["ana@example.com"])

    def test_the_edited_body_is_what_gets_sent(self):
        self.send(body="Exactly this text.")
        self.assertIn("Exactly this text.", mail.outbox[0].body)

    def test_an_empty_body_is_refused(self):
        self.assertEqual(self.send(body="   ").status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_a_body_with_an_unfilled_placeholder_is_refused(self):
        """A guest must never receive "Hello (guest name)"."""
        response = self.send(body="Pershendetje (guest name), u konfirmua.")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)
        self.assertIn("guest name", response.json()["error"])

    def test_a_request_with_no_email_cannot_be_notified(self):
        self.request.guest_email = ""
        self.request.save(update_fields=["guest_email"])
        response = self.send(body="Anything.")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_the_subject_names_the_apartment(self):
        self.send(body="Confirmed.")
        self.assertIn("Apartment A", mail.outbox[0].subject)

    # ---- permissions ----

    def test_an_anonymous_caller_cannot_send(self):
        response = Client().post(
            f"/api/booking-requests/{self.request.id}/notify/",
            data=json.dumps({"body": "hi", "language": "sq", "scenario": "booking_approved"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(len(mail.outbox), 0)

    def test_cleaning_staff_cannot_send(self):
        from django.contrib.auth.models import Group, User

        client = Client()
        group, _ = Group.objects.get_or_create(name="Cleaning")
        user = User.objects.create_user(username="cleaner", password="pw")
        user.groups.add(group)
        client.force_login(user)
        response = client.post(
            f"/api/booking-requests/{self.request.id}/notify/",
            data=json.dumps({"body": "hi", "language": "sq", "scenario": "booking_approved"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)


class ApprovalMintsATokenTests(TestCase):
    """An approved request produced a reservation with no guest-facing handle."""

    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property()
        self.request = BookingRequest.objects.create(
            property=self.prop,
            guest_name="Ana",
            guest_email="ana@example.com",
            guest_phone="+38344111222",
            check_in=day(40),
            check_out=day(43),
            total_price_eur=Decimal("150.00"),
            status=BookingRequest.Status.PENDING,
        )

    def test_the_created_reservation_gets_a_booking_token(self):
        response = self.client.post(f"/api/booking-requests/{self.request.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        reservation = Reservation.objects.get(pk=response.json()["reservationId"])
        self.assertIsNotNone(reservation.booking_token)

    def test_that_token_resolves_for_the_guest(self):
        response = self.client.post(f"/api/booking-requests/{self.request.id}/approve/")
        reservation = Reservation.objects.get(pk=response.json()["reservationId"])
        lookup = Client().get(f"/api/booking/reservations/{reservation.booking_token}/")
        self.assertEqual(lookup.status_code, 200)
        self.assertEqual(lookup.json()["type"], "reservation")
