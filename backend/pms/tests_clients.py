"""The client directory: paging, filters, archiving, and the stay breakdown.

The directory used to hand back every guest in one response. With 397 clients
each carrying three aggregate annotations that is a slow query and a large
payload, and it only grows. These tests cover the paged, filtered replacement.

The sharpest edge here is in `AggregatesSurviveFilteringTests`. Read that class
before touching any filter on this endpoint.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import Guest, Reservation
from .tests import make_property


def staff_client(role="Admin", username="clients-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client


def make_guest(first="Ada", last="Lovelace", **extra):
    return Guest.objects.create(first_name=first, last_name=last, **extra)


def make_stay(guest, prop, check_in, check_out, price="100.00", platform="private"):
    # Decimal, not str: Reservation.save() multiplies the nightly rate by the
    # night count to derive the total, and a string has no quantize().
    return Reservation.objects.create(
        property=prop,
        guest=guest,
        guest_name=guest.full_name if guest else "",
        platform=platform,
        check_in=date.fromisoformat(check_in),
        check_out=date.fromisoformat(check_out),
        nightly_price_eur=Decimal(price),
    )


class PaginationTests(TestCase):
    """Twenty at a time, with an honest total."""

    def setUp(self):
        self.client = staff_client()
        for i in range(25):
            make_guest(first=f"Client{i:02d}", last="Test", phone=f"04400{i:04d}")

    def get(self, **params):
        return self.client.get("/api/guests/", params).json()

    def test_a_page_is_twenty_by_default(self):
        self.assertEqual(len(self.get()["guests"]), 20)

    def test_the_total_counts_everyone_not_just_the_page(self):
        self.assertEqual(self.get()["total"], 25)

    def test_the_offset_walks_to_the_rest(self):
        self.assertEqual(len(self.get(offset=20)["guests"]), 5)

    def test_the_two_pages_do_not_overlap(self):
        first = {row["id"] for row in self.get()["guests"]}
        second = {row["id"] for row in self.get(offset=20)["guests"]}
        self.assertEqual(first & second, set())

    def test_the_two_pages_together_are_everyone(self):
        first = {row["id"] for row in self.get()["guests"]}
        second = {row["id"] for row in self.get(offset=20)["guests"]}
        self.assertEqual(len(first | second), 25)

    def test_a_limit_can_be_asked_for(self):
        self.assertEqual(len(self.get(limit=5)["guests"]), 5)

    def test_an_absurd_limit_is_clamped_rather_than_obeyed(self):
        """Otherwise ?limit=100000 is the unbounded query we just removed."""
        self.assertLessEqual(len(self.get(limit=100000)["guests"]), 100)

    def test_a_negative_offset_does_not_reverse_the_slice(self):
        self.assertEqual(len(self.get(offset=-5)["guests"]), 20)

    def test_rubbish_paging_values_do_not_crash(self):
        response = self.client.get("/api/guests/", {"limit": "abc", "offset": "xyz"})
        self.assertEqual(response.status_code, 200)

    def test_an_offset_past_the_end_is_empty_not_an_error(self):
        page = self.get(offset=999)
        self.assertEqual(page["guests"], [])
        self.assertEqual(page["total"], 25)


class AggregatesSurviveFilteringTests(TestCase):
    """Filtering on reservations must not inflate the totals.

    `annotated_guests()` sums over the `reservations` relation. Adding
    `.filter(reservations__…)` to that same queryset makes Django join the
    table a second time, and every summed row is counted once per join. On real
    data this doubled a client from 1092 nights to 2184 and 22,602 EUR to
    45,204 — `Count(distinct=True)` survived it, `Sum` did not.

    The filter has to select ids through a subquery instead. These tests fail
    the moment someone writes the join back.
    """

    def setUp(self):
        self.client = staff_client()
        self.prop = make_property()
        self.guest = make_guest(first="Leon", last="Krasniqi", phone="044111222")
        # Three stays inside the same month: enough joins to multiply.
        make_stay(self.guest, self.prop, "2026-08-01", "2026-08-05")
        make_stay(self.guest, self.prop, "2026-08-10", "2026-08-15")
        make_stay(self.guest, self.prop, "2026-08-20", "2026-08-22")

    def row(self, **params):
        rows = self.client.get("/api/guests/", params).json()["guests"]
        return next(r for r in rows if r["id"] == str(self.guest.id))

    def test_the_unfiltered_totals_are_the_truth(self):
        row = self.row()
        self.assertEqual(row["totalStays"], 3)
        self.assertEqual(row["totalNights"], 4 + 5 + 2)

    def test_filtering_by_month_does_not_change_the_nights(self):
        self.assertEqual(self.row(year=2026, month=8)["totalNights"], self.row()["totalNights"])

    def test_filtering_by_month_does_not_change_the_money(self):
        self.assertEqual(self.row(year=2026, month=8)["totalPaidEur"], self.row()["totalPaidEur"])

    def test_filtering_by_month_does_not_change_the_stay_count(self):
        self.assertEqual(self.row(year=2026, month=8)["totalStays"], self.row()["totalStays"])

    def test_filtering_by_apartment_does_not_change_the_totals(self):
        filtered = self.row(propertyId=str(self.prop.id))
        self.assertEqual(filtered["totalNights"], self.row()["totalNights"])
        self.assertEqual(filtered["totalPaidEur"], self.row()["totalPaidEur"])

    def test_both_filters_at_once_still_do_not_inflate(self):
        both = self.row(year=2026, month=8, propertyId=str(self.prop.id))
        self.assertEqual(both["totalNights"], self.row()["totalNights"])


class PeriodFilterTests(TestCase):
    """A client belongs to a month if a stay of theirs overlapped it."""

    def setUp(self):
        self.client = staff_client()
        self.prop = make_property()
        self.august = make_guest(first="Aug", last="Guest", phone="044000001")
        make_stay(self.august, self.prop, "2026-08-10", "2026-08-14")
        self.june = make_guest(first="Jun", last="Guest", phone="044000002")
        make_stay(self.june, self.prop, "2026-06-10", "2026-06-14")
        self.crossing = make_guest(first="Cross", last="Guest", phone="044000003")
        make_stay(self.crossing, self.prop, "2026-07-30", "2026-08-02")
        # A second apartment: stays that overlap in time need somewhere to be,
        # or the model's own double-booking check rejects the fixture.
        self.other = make_property(name="Second Apartment")

    def names(self, **params):
        return {row["fullName"] for row in self.client.get("/api/guests/", params).json()["guests"]}

    def test_a_stay_inside_the_month_is_included(self):
        self.assertIn("Aug Guest", self.names(year=2026, month=8))

    def test_a_stay_in_another_month_is_left_out(self):
        self.assertNotIn("Jun Guest", self.names(year=2026, month=8))

    def test_a_stay_crossing_into_the_month_is_included(self):
        """Arrived 30 July, slept an August night — they were here in August."""
        self.assertIn("Cross Guest", self.names(year=2026, month=8))

    def test_a_stay_that_checked_out_on_the_first_is_not_an_august_guest(self):
        gone = make_guest(first="Gone", last="Guest", phone="044000004")
        make_stay(gone, self.other, "2026-07-28", "2026-08-01")
        self.assertNotIn("Gone Guest", self.names(year=2026, month=8))

    def test_all_time_returns_everyone(self):
        self.assertEqual(len(self.names()), 3)

    def test_a_client_with_no_stays_disappears_once_a_month_is_chosen(self):
        make_guest(first="Never", last="Stayed", phone="044000005")
        self.assertIn("Never Stayed", self.names())
        self.assertNotIn("Never Stayed", self.names(year=2026, month=8))


class ArchiveTests(TestCase):
    """Archiving files a client away; it does not destroy their history."""

    def setUp(self):
        self.client = staff_client()
        self.prop = make_property()
        self.guest = make_guest(first="Filed", last="Away", phone="044222333")
        self.stay = make_stay(self.guest, self.prop, "2026-08-01", "2026-08-05")

    def archive(self, value=True):
        return self.client.patch(
            f"/api/guests/{self.guest.id}/",
            data={"isArchived": value},
            content_type="application/json",
        )

    def names(self, **params):
        return {r["fullName"] for r in self.client.get("/api/guests/", params).json()["guests"]}

    def test_archiving_succeeds(self):
        self.assertEqual(self.archive().status_code, 200)

    def test_an_archived_client_leaves_the_directory(self):
        self.archive()
        self.assertNotIn("Filed Away", self.names())

    def test_an_archived_client_appears_in_the_archive(self):
        self.archive()
        self.assertIn("Filed Away", self.names(archived=1))

    def test_the_archive_holds_only_archived_clients(self):
        make_guest(first="Still", last="Here", phone="044999888")
        self.archive()
        self.assertEqual(self.names(archived=1), {"Filed Away"})

    def test_their_reservation_survives_and_keeps_the_name(self):
        self.archive()
        self.stay.refresh_from_db()
        self.assertEqual(self.stay.guest_id, self.guest.id)
        self.assertEqual(self.stay.guest_name, "Filed Away")

    def test_restoring_brings_them_back(self):
        self.archive()
        self.archive(False)
        self.assertIn("Filed Away", self.names())

    def test_archiving_stamps_when_it_happened(self):
        self.archive()
        self.guest.refresh_from_db()
        self.assertIsNotNone(self.guest.archived_at)

    def test_restoring_clears_the_stamp(self):
        self.archive()
        self.archive(False)
        self.guest.refresh_from_db()
        self.assertIsNone(self.guest.archived_at)

    def test_deleting_still_removes_permanently(self):
        """Archive is the soft option; delete stays available and stays final."""
        self.client.delete(f"/api/guests/{self.guest.id}/")
        self.assertFalse(Guest.objects.filter(pk=self.guest.pk).exists())

    def test_the_total_counts_the_page_you_asked_for(self):
        make_guest(first="Still", last="Here", phone="044999888")
        self.archive()
        self.assertEqual(self.client.get("/api/guests/").json()["total"], 1)


class ChannelPlaceholderTests(TestCase):
    """The iCal import invents a "guest" named after the channel.

    `link_or_create_guest` turns that label into a Guest row, so the directory
    grew a client called Airbnb with 42 stays — top of the list by every
    measure, and not a person. They are hidden, not deleted: the reservations
    still point at them.
    """

    def setUp(self):
        self.client = staff_client()
        self.prop = make_property()

    def names(self, **params):
        return {r["fullName"] for r in self.client.get("/api/guests/", params).json()["guests"]}

    def test_a_channel_named_client_with_no_contact_details_is_hidden(self):
        make_guest(first="Airbnb", last="")
        self.assertNotIn("Airbnb", self.names())

    def test_the_match_ignores_case(self):
        make_guest(first="booking", last="")
        self.assertNotIn("booking", self.names())

    def test_a_label_with_a_dot_is_matched_too(self):
        make_guest(first="Booking.com", last="")
        self.assertNotIn("Booking.com", self.names())

    def test_a_real_person_who_happens_to_share_the_name_is_kept(self):
        """Contact details are what separate a person from an import artefact."""
        make_guest(first="Airbnb", last="Hoxha", phone="044777666")
        self.assertIn("Airbnb Hoxha", self.names())

    def test_a_placeholder_with_an_email_is_kept(self):
        make_guest(first="Airbnb", last="", email="someone@example.com")
        self.assertIn("Airbnb", self.names())

    def test_an_ordinary_client_is_untouched(self):
        make_guest(first="Ardit", last="Berisha", phone="044123456")
        self.assertIn("Ardit Berisha", self.names())

    def test_hidden_placeholders_are_not_counted_in_the_total(self):
        make_guest(first="Airbnb", last="")
        make_guest(first="Ardit", last="Berisha", phone="044123456")
        self.assertEqual(self.client.get("/api/guests/").json()["total"], 1)


class SearchAndSortTests(TestCase):
    def setUp(self):
        self.client = staff_client()
        self.prop = make_property()
        self.a = make_guest(first="Ardit", last="Berisha", phone="044111111", email="a@x.com")
        self.b = make_guest(first="Blerim", last="Krasniqi", phone="044222222")
        self.other = make_property(name="Second Apartment")
        make_stay(self.a, self.prop, "2026-08-01", "2026-08-11")   # 10 nights
        make_stay(self.b, self.other, "2026-08-01", "2026-08-03")  # 2 nights

    def names(self, **params):
        return [r["fullName"] for r in self.client.get("/api/guests/", params).json()["guests"]]

    def test_search_still_matches_a_name(self):
        self.assertEqual(self.names(search="Ardit"), ["Ardit Berisha"])

    def test_search_still_matches_a_phone(self):
        self.assertEqual(self.names(search="044222222"), ["Blerim Krasniqi"])

    def test_search_still_matches_an_email(self):
        self.assertEqual(self.names(search="a@x.com"), ["Ardit Berisha"])

    def test_sorting_by_nights_puts_the_longest_first(self):
        self.assertEqual(self.names(sort="-nights")[0], "Ardit Berisha")

    def test_sorting_by_name_is_alphabetical(self):
        self.assertEqual(self.names(sort="name"), ["Ardit Berisha", "Blerim Krasniqi"])

    def test_an_unknown_sort_key_falls_back_rather_than_erroring(self):
        response = self.client.get("/api/guests/", {"sort": "; DROP TABLE"})
        self.assertEqual(response.status_code, 200)


class ClientDirectoryRolesTests(TestCase):
    """The directory holds names, phones and spend. Cleaning has no business here."""

    def test_cleaning_is_refused_the_list(self):
        client = staff_client(role="Cleaning", username="cleaner")
        self.assertEqual(client.get("/api/guests/").status_code, 403)

    def test_a_signed_out_visitor_is_refused(self):
        self.assertIn(Client().get("/api/guests/").status_code, (401, 403))

    def test_management_is_allowed(self):
        client = staff_client(role="Management", username="manager")
        self.assertEqual(client.get("/api/guests/").status_code, 200)


class ClientStayBreakdownTests(TestCase):
    """GET /api/guests/<id>/stays/ - one client's history, with their numbers.

    The top-level totals are lifetime and match what the directory row shows.
    The finished/upcoming split sits beside them rather than replacing them:
    `serialize_guest` counts every stay, `stay_stats` on the guest portal counts
    only stays that have ended, and blending the two produces a number nobody
    can reconcile against either page.
    """

    def setUp(self):
        self.client = staff_client()
        self.prop = make_property()
        self.other = make_property(name="Second Apartment")
        self.guest = make_guest(first="Rina", last="Gashi", phone="044555444")
        self.stranger = make_guest(first="Other", last="Person", phone="044666555")

        today = date.today()
        self.past = make_stay(
            self.guest, self.prop,
            (today - timedelta(days=30)).isoformat(),
            (today - timedelta(days=25)).isoformat(),
        )
        self.future = make_stay(
            self.guest, self.prop,
            (today + timedelta(days=10)).isoformat(),
            (today + timedelta(days=13)).isoformat(),
        )
        make_stay(self.stranger, self.other, "2026-03-01", "2026-03-04")

    def get(self, guest=None):
        target = guest or self.guest
        return self.client.get(f"/api/guests/{target.id}/stays/")

    def test_it_answers(self):
        self.assertEqual(self.get().status_code, 200)

    def test_it_returns_only_this_client_stays(self):
        ids = {row["id"] for row in self.get().json()["stays"]}
        self.assertEqual(ids, {str(self.past.id), str(self.future.id)})

    def test_another_client_stay_never_appears(self):
        names = {row["guestName"] for row in self.get().json()["stays"]}
        self.assertNotIn("Other Person", names)

    def test_a_maintenance_block_is_not_a_stay(self):
        make_stay(self.guest, self.other, "2026-05-01", "2026-05-03", platform="maintenance")
        self.assertEqual(len(self.get().json()["stays"]), 2)

    def test_an_archived_reservation_is_left_out(self):
        self.future.is_archived = True
        self.future.save()
        self.assertEqual(len(self.get().json()["stays"]), 1)

    def test_the_lifetime_total_counts_every_stay_including_the_future_one(self):
        self.assertEqual(self.get().json()["stats"]["stays"], 2)

    def test_the_finished_total_counts_only_what_has_ended(self):
        self.assertEqual(self.get().json()["stats"]["finished"]["stays"], 1)

    def test_the_upcoming_total_counts_what_has_not(self):
        self.assertEqual(self.get().json()["stats"]["upcoming"]["stays"], 1)

    def test_the_split_adds_back_to_the_lifetime_total(self):
        stats = self.get().json()["stats"]
        self.assertEqual(
            stats["finished"]["stays"] + stats["upcoming"]["stays"], stats["stays"]
        )

    def test_the_nights_split_adds_back_too(self):
        stats = self.get().json()["stats"]
        self.assertEqual(
            stats["finished"]["nights"] + stats["upcoming"]["nights"], stats["nights"]
        )

    def test_last_visit_is_the_last_finished_checkout_not_the_future_one(self):
        self.assertEqual(self.get().json()["stats"]["lastVisit"], self.past.check_out.isoformat())

    def test_the_lifetime_totals_match_the_directory_row(self):
        """The two pages must not disagree about the same client."""
        row = next(
            r for r in self.client.get("/api/guests/").json()["guests"]
            if r["id"] == str(self.guest.id)
        )
        stats = self.get().json()["stats"]
        self.assertEqual(stats["stays"], row["totalStays"])
        self.assertEqual(stats["nights"], row["totalNights"])
        self.assertEqual(stats["totalSpentEur"], row["totalPaidEur"])

    def test_a_client_with_no_stays_reads_as_zero_not_null(self):
        empty = make_guest(first="New", last="Client", phone="044000999")
        stats = self.get(empty).json()["stats"]
        self.assertEqual(stats["stays"], 0)
        self.assertEqual(stats["nights"], 0)
        self.assertEqual(stats["lastVisit"], "")

    def test_an_unknown_client_is_a_clean_404(self):
        response = self.client.get("/api/guests/6b1f0f1e-0000-4000-8000-000000000000/stays/")
        self.assertEqual(response.status_code, 404)

    def test_cleaning_cannot_read_a_client_history(self):
        cleaner = staff_client(role="Cleaning", username="cleaner-stays")
        self.assertEqual(cleaner.get(f"/api/guests/{self.guest.id}/stays/").status_code, 403)

    def test_a_signed_out_visitor_cannot(self):
        self.assertIn(Client().get(f"/api/guests/{self.guest.id}/stays/").status_code, (401, 403))
