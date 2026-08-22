"""Which bookings belong to a guest account.

This is the security boundary of the portal, so it is tested as a statement
about data rather than about a request — no HTTP, no session, no serializer.

The rule has two halves, and both are load-bearing:

  1. the guest_email on the row matches the account, compared lowercased, and
  2. the row originated on the website — a BookingRequest, or a Reservation a
     BookingRequest points at.

The second half is what keeps a stay staff typed in, and an Airbnb or
Booking.com import, out of the portal even when the email matches. It is not a
convenience filter. Without it, one person's stay can surface in another
person's account, because staff-entered rows carry whatever address was to hand.
"""

from decimal import Decimal

from django.test import TestCase

from .models import BookingRequest, Guest, GuestAccount, Reservation
from .tests import day, make_property
from .views._guest_ownership import (
    has_website_booking,
    owned_booking_request,
    owned_booking_requests,
    owned_reservations,
    stay_stats,
)

EMAIL = "ana@example.com"


class OwnershipTestCase(TestCase):
    def setUp(self):
        self.prop = make_property(name="Apartment A")
        self.account = GuestAccount.for_email(EMAIL)

    def website_request(self, email=EMAIL, start=30, status=BookingRequest.Status.PENDING):
        return BookingRequest.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            guest_email=email,
            guest_phone="+38344111222",
            check_in=day(start),
            check_out=day(start + 3),
            total_price_eur=Decimal("150.00"),
            status=status,
        )

    def reservation(self, email=EMAIL, platform="private", start=30, nights=3, paid="150.00"):
        return Reservation.objects.create(
            property=self.prop,
            guest_name="Ana Berisha",
            guest_email=email,
            platform=platform,
            check_in=day(start),
            check_out=day(start + nights),
            nightly_price_eur=Decimal(paid) / nights,
        )


class WhatIsOwnedTests(OwnershipTestCase):
    def test_a_request_made_with_this_email_is_owned(self):
        request = self.website_request()
        self.assertIn(request, owned_booking_requests(self.account))

    def test_case_does_not_matter(self):
        request = self.website_request(email="Ana.Berisha@EXAMPLE.com")
        account = GuestAccount.for_email("ana.berisha@example.com")
        self.assertIn(request, owned_booking_requests(account))

    def test_a_request_made_before_the_account_existed_is_owned(self):
        """Matching happens at read time, so signing up later still works."""
        request = self.website_request(email="later@example.com")
        account = GuestAccount.for_email("later@example.com")
        self.assertIn(request, owned_booking_requests(account))

    def test_an_approved_request_carries_its_reservation(self):
        reservation = self.reservation()
        request = self.website_request(status=BookingRequest.Status.APPROVED)
        request.reservation = reservation
        request.save(update_fields=["reservation"])
        self.assertIn(reservation, owned_reservations(self.account))


class WhatIsNotOwnedTests(OwnershipTestCase):
    """The half of the rule that keeps other people out."""

    def test_a_staff_entered_reservation_with_a_matching_email_is_not_owned(self):
        self.reservation()
        self.assertEqual(list(owned_reservations(self.account)), [])

    def test_an_airbnb_reservation_is_not_owned(self):
        self.reservation(platform="airbnb")
        self.assertEqual(list(owned_reservations(self.account)), [])

    def test_a_booking_com_reservation_is_not_owned(self):
        self.reservation(platform="booking")
        self.assertEqual(list(owned_reservations(self.account)), [])

    def test_one_account_owns_none_of_another_accounts_requests(self):
        mine = self.website_request()
        theirs = self.website_request(email="someone.else@example.com", start=60)
        other = GuestAccount.for_email("someone.else@example.com")

        self.assertEqual(list(owned_booking_requests(self.account)), [mine])
        self.assertEqual(list(owned_booking_requests(other)), [theirs])

    def test_a_request_with_no_email_belongs_to_nobody(self):
        """The booking form allowed a blank email before the portal existed."""
        self.website_request(email="")
        blank = GuestAccount.objects.create(email="")
        self.assertEqual(list(owned_booking_requests(blank)), [])

    def test_an_account_with_no_email_owns_nothing(self):
        """Fail safe: an empty portal, never every emailless booking at once."""
        self.website_request(email="")
        self.website_request(email="other@example.com", start=60)
        blank = GuestAccount.objects.create(email="")
        self.assertEqual(list(owned_booking_requests(blank)), [])
        self.assertEqual(list(owned_reservations(blank)), [])


class LookupByIdTests(OwnershipTestCase):
    def test_a_request_of_mine_resolves(self):
        request = self.website_request()
        self.assertEqual(owned_booking_request(self.account, request.id), request)

    def test_another_accounts_request_does_not_resolve(self):
        request = self.website_request(email="someone.else@example.com")
        self.assertIsNone(owned_booking_request(self.account, request.id))

    def test_an_unknown_id_does_not_resolve(self):
        import uuid

        self.assertIsNone(owned_booking_request(self.account, uuid.uuid4()))

    def test_a_malformed_id_is_refused_rather_than_raising(self):
        for junk in ("nonsense", "", None, 12345):
            self.assertIsNone(owned_booking_request(self.account, junk), junk)


class HasWebsiteBookingTests(OwnershipTestCase):
    """Whoever can be sent a sign-in link must be able to see something."""

    def test_true_for_an_address_that_booked(self):
        self.website_request()
        self.assertTrue(has_website_booking(EMAIL))

    def test_case_insensitive(self):
        self.website_request(email="ANA@EXAMPLE.COM")
        self.assertTrue(has_website_booking("ana@example.com"))

    def test_false_for_an_address_that_never_booked(self):
        self.assertFalse(has_website_booking("stranger@example.com"))

    def test_false_for_an_address_that_only_appears_on_a_staff_entered_stay(self):
        """Otherwise the server would email anyone whose address staff typed."""
        self.reservation(email="typed.in@example.com")
        self.assertFalse(has_website_booking("typed.in@example.com"))

    def test_false_for_a_blank_address(self):
        self.website_request(email="")
        self.assertFalse(has_website_booking(""))

    def test_it_agrees_with_what_the_portal_would_show(self):
        self.website_request()
        self.assertEqual(
            has_website_booking(EMAIL),
            owned_booking_requests(self.account).exists(),
        )


class StatsTests(OwnershipTestCase):
    def approved_stay(self, start, nights=3, paid="150.00", email=EMAIL):
        reservation = self.reservation(email=email, start=start, nights=nights, paid=paid)
        request = self.website_request(
            email=email, start=start, status=BookingRequest.Status.APPROVED
        )
        request.reservation = reservation
        request.save(update_fields=["reservation"])
        return reservation

    def test_a_new_account_has_nothing_to_show(self):
        self.assertEqual(
            stay_stats(self.account),
            {"stays": 0, "nights": 0, "totalSpentEur": "0.00", "lastVisit": ""},
        )

    def test_only_finished_stays_are_counted(self):
        self.approved_stay(start=-30)  # already happened
        self.approved_stay(start=60)  # still to come
        self.assertEqual(stay_stats(self.account)["stays"], 1)

    def test_nights_and_spend_come_from_the_finished_stay(self):
        self.approved_stay(start=-30, nights=4, paid="200.00")
        stats = stay_stats(self.account)
        self.assertEqual(stats["nights"], 4)
        self.assertEqual(stats["totalSpentEur"], "200.00")

    def test_the_last_visit_is_the_most_recent_checkout(self):
        self.approved_stay(start=-60)
        self.approved_stay(start=-30)
        self.assertEqual(stay_stats(self.account)["lastVisit"], day(-27).isoformat())

    def test_a_staff_entered_stay_is_not_counted(self):
        self.reservation(start=-30)
        self.assertEqual(stay_stats(self.account)["stays"], 0)

    def test_the_crm_totals_are_ignored(self):
        """Guest.total_stays counts everything staff entered too."""
        Guest.objects.create(
            first_name="Ana", last_name="Berisha", email=EMAIL, is_returning=True
        )
        self.approved_stay(start=-30)
        self.assertEqual(stay_stats(self.account)["stays"], 1)
