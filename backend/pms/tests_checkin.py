"""Arrivals need to say whether the guest has stayed before.

The dashboard's check-in list puts returning private guests in their own group
so they can be greeted as such. That needs one fact the reservation serializer
did not carry, and it has to come from the server: the browser only holds the
reservations it has loaded, so it cannot tell a first-time guest from one whose
earlier stay is outside the window.

`Guest.is_returning` is the right source here — unlike the reports donut, which
asks "was *this stay* their first?" and must compute an ordinal instead. Here
the question really is the lifetime one: is this person known to us already?
"""

from decimal import Decimal

from django.test import Client, TestCase

from .models import Guest, Reservation
from .tests import day, make_admin, make_property


class ReturningFlagOnReservationTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property()

    def book(self, guest=None, start=1):
        return Reservation.objects.create(
            property=self.prop,
            guest=guest,
            guest_name="Ana Berisha",
            guest_phone="+38344111222",
            platform=Reservation.Platform.PRIVATE,
            check_in=day(start),
            check_out=day(start + 2),
            nightly_price_eur=Decimal("50.00"),
        )

    def serialized(self, reservation):
        rows = self.client.get("/api/reservations/").json()["reservations"]
        return next(row for row in rows if row["id"] == str(reservation.id))

    def test_a_reservation_says_whether_its_guest_is_returning(self):
        guest = Guest.objects.create(first_name="Ana", last_name="Berisha", is_returning=True)
        self.assertTrue(self.serialized(self.book(guest=guest))["guestIsReturning"])

    def test_a_first_time_guest_is_not_returning(self):
        guest = Guest.objects.create(first_name="Ana", last_name="Berisha")
        self.assertFalse(self.serialized(self.book(guest=guest))["guestIsReturning"])

    def test_a_reservation_with_no_client_record_is_not_returning(self):
        """Absence of a link is not evidence of a first visit, but it is the
        only safe thing to show — better than badging a stranger as returning."""
        reservation = self.book()
        # The linker attaches a guest on create, so detach to model an old row.
        Reservation.objects.filter(pk=reservation.pk).update(guest=None)
        self.assertFalse(self.serialized(reservation)["guestIsReturning"])
