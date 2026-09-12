"""Sync must never lose a reservation.

An iCal feed is an unreliable narrator. It can be truncated mid-transfer, it
can be served stale by a CDN, and a channel can omit a booking for reasons of
its own. Treating "absent from this fetch" as "cancelled by the guest" turns
every one of those into data loss.

Three routes to losing a booking are covered here:

  1. A *partial* feed. The empty-feed guard only checks for zero valid events,
     so a feed truncated after three of forty bookings passes it and the other
     thirty-seven are reconciled away.
  2. The archive purge. Archived rows are deleted permanently after 30 days,
     and that runs as a side effect of *listing* the archive - a GET that
     destroys data.
  3. Adoption. A manually typed booking that matches a feed event by date is
     given the channel's UID, and from then on the feed can archive it.

The fix is not to stop reconciling. It is to make disappearance a *state* -
missing, needing review - before it becomes a decision.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase
from django.utils import timezone

from .models import Reservation, SyncLog
from .tests import make_property
from .views._ical import import_ical_reservations, parse_ical_events


def staff_client(role="Admin", username="sync-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client


def feed(*events, complete=True):
    """Build an iCal body. `complete=False` truncates it mid-transfer."""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0"]
    for uid, start, end in events:
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTART;VALUE=DATE:{start}",
            f"DTEND;VALUE=DATE:{end}",
            "SUMMARY:Reserved",
            "END:VEVENT",
        ]
    if complete:
        lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def ymd(day):
    return day.strftime("%Y%m%d")


class TruncatedFeedTests(TestCase):
    """A feed that stops early must not cancel what it did not get to."""

    def setUp(self):
        self.prop = make_property(name="Apartment #2")
        today = date.today()
        self.events = [
            (f"uid-{i}", ymd(today + timedelta(days=10 * i)), ymd(today + timedelta(days=10 * i + 3)))
            for i in range(1, 5)
        ]
        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(*self.events)))

    def live(self):
        return Reservation.objects.filter(
            property=self.prop, platform="airbnb", is_archived=False
        ).count()

    def test_the_full_feed_imported_everything(self):
        self.assertEqual(self.live(), 4)

    def test_a_truncated_feed_does_not_archive_the_bookings_it_never_reached(self):
        """Three of four arrive because the connection dropped. The fourth is
        not cancelled - nobody said it was."""
        partial = parse_ical_events(feed(*self.events[:3], complete=False))
        import_ical_reservations(self.prop, "airbnb", partial)
        self.assertEqual(self.live(), 4)

    def test_a_complete_feed_that_genuinely_drops_one_marks_it_missing_not_archived(self):
        """A real cancellation is still not acted on immediately - it is flagged."""
        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(*self.events[:3])))
        gone = Reservation.objects.get(external_uid="uid-4")
        self.assertFalse(gone.is_archived)
        self.assertIsNotNone(gone.missing_from_sync_since)

    def test_a_booking_that_comes_back_is_no_longer_missing(self):
        """A channel that omitted a booking once must not leave it flagged."""
        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(*self.events[:3])))
        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(*self.events)))
        back = Reservation.objects.get(external_uid="uid-4")
        self.assertIsNone(back.missing_from_sync_since)
        self.assertFalse(back.is_archived)

    def test_a_booking_missing_long_enough_is_finally_archived(self):
        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(*self.events[:3])))
        gone = Reservation.objects.get(external_uid="uid-4")
        gone.missing_from_sync_since = timezone.now() - timedelta(days=5)
        gone.save(update_fields=["missing_from_sync_since"])

        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(*self.events[:3])))
        gone.refresh_from_db()
        self.assertTrue(gone.is_archived)

    def test_an_empty_feed_still_changes_nothing(self):
        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed()))
        self.assertEqual(self.live(), 4)

    def test_a_feed_of_rubbish_changes_nothing(self):
        import_ical_reservations(self.prop, "airbnb", parse_ical_events("<html>404</html>"))
        self.assertEqual(self.live(), 4)

    def test_the_result_reports_what_it_flagged(self):
        result = import_ical_reservations(
            self.prop, "airbnb", parse_ical_events(feed(*self.events[:3]))
        )
        self.assertEqual(result["missing"], 1)
        self.assertEqual(result["cancelled"], 0)


class ManualReservationsAreNeverTouchedTests(TestCase):
    """A booking somebody typed in is not the feed's to cancel."""

    def setUp(self):
        self.prop = make_property(name="Apartment #3")
        today = date.today()
        self.manual = Reservation.objects.create(
            property=self.prop,
            guest_name="Walk-in guest",
            platform="private",
            check_in=today + timedelta(days=40),
            check_out=today + timedelta(days=44),
            nightly_price_eur=Decimal("50.00"),
        )

    def test_a_private_booking_survives_a_feed_that_never_mentions_it(self):
        today = date.today()
        import_ical_reservations(
            self.prop,
            "airbnb",
            parse_ical_events(feed(("uid-x", ymd(today + timedelta(days=1)), ymd(today + timedelta(days=3))))),
        )
        self.manual.refresh_from_db()
        self.assertFalse(self.manual.is_archived)
        self.assertIsNone(self.manual.missing_from_sync_since)

    def test_a_channel_booking_typed_in_by_hand_is_never_archived_by_the_feed(self):
        """Adoption gives it the channel's UID so the dates stay in step. That
        must not also hand the feed permission to cancel it."""
        today = date.today()
        typed = Reservation.objects.create(
            property=self.prop,
            guest_name="Typed from the Airbnb app",
            platform="airbnb",
            check_in=today + timedelta(days=60),
            check_out=today + timedelta(days=63),
            nightly_price_eur=Decimal("70.00"),
        )
        # First sync adopts it by matching the dates exactly.
        import_ical_reservations(
            self.prop,
            "airbnb",
            parse_ical_events(feed(("uid-adopted", ymd(typed.check_in), ymd(typed.check_out)))),
        )
        typed.refresh_from_db()
        self.assertEqual(typed.external_uid, "uid-adopted")

        # A later feed omits it for three weeks. It must still be there.
        for _ in range(3):
            import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(("uid-other", ymd(today + timedelta(days=5)), ymd(today + timedelta(days=7))))))
            typed.refresh_from_db()
            typed.missing_from_sync_since = timezone.now() - timedelta(days=30)
            typed.save(update_fields=["missing_from_sync_since"])
        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(("uid-other", ymd(today + timedelta(days=5)), ymd(today + timedelta(days=7))))))
        typed.refresh_from_db()
        self.assertFalse(
            typed.is_archived, "a booking a person created was archived by an external feed"
        )


class ArchiveIsNotAShredderTests(TestCase):
    """Listing the archive must not destroy anything."""

    def setUp(self):
        self.client = staff_client()
        self.prop = make_property(name="Apartment #4")
        today = date.today()
        self.old = Reservation.objects.create(
            property=self.prop,
            guest_name="Archived long ago",
            platform="private",
            check_in=today - timedelta(days=200),
            check_out=today - timedelta(days=197),
            nightly_price_eur=Decimal("50.00"),
            is_archived=True,
        )
        Reservation.objects.filter(pk=self.old.pk).update(
            archived_at=timezone.now() - timedelta(days=365)
        )

    def test_viewing_the_archive_does_not_delete_anything(self):
        """A GET is a read. It had been purging every row archived over 30
        days ago - including ones sync archived by mistake."""
        response = self.client.get("/api/reservations/", {"archived": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Reservation.objects.filter(pk=self.old.pk).exists())

    def test_the_old_reservation_is_still_listed(self):
        rows = self.client.get("/api/reservations/", {"archived": "1"}).json()["reservations"]
        self.assertIn(str(self.old.id), [row["id"] for row in rows])


class SyncLoggingTests(TestCase):
    """Every run says what it did, so a surprise can be explained afterwards."""

    def setUp(self):
        self.prop = make_property(name="Apartment #5")
        self.today = date.today()

    def test_a_run_records_what_it_flagged_as_missing(self):
        events = [("uid-1", ymd(self.today + timedelta(days=5)), ymd(self.today + timedelta(days=8)))]
        import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(*events)))
        result = import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed()))
        # An empty feed reconciles nothing at all.
        self.assertEqual(result["missing"], 0)

    def test_the_counts_add_up_on_a_first_import(self):
        events = [
            ("uid-1", ymd(self.today + timedelta(days=5)), ymd(self.today + timedelta(days=8))),
            ("uid-2", ymd(self.today + timedelta(days=15)), ymd(self.today + timedelta(days=18))),
        ]
        result = import_ical_reservations(self.prop, "airbnb", parse_ical_events(feed(*events)))
        self.assertEqual(result["imported"], 2)
        self.assertEqual(result["cancelled"], 0)
        self.assertEqual(result["missing"], 0)


class FeedIntegrityTests(TestCase):
    """Telling a whole feed from a half one."""

    def test_a_complete_feed_is_recognised(self):
        from .views._ical import feed_looks_complete

        self.assertTrue(feed_looks_complete(feed(("u", "20260101", "20260103"))))

    def test_a_truncated_feed_is_recognised(self):
        from .views._ical import feed_looks_complete

        self.assertFalse(feed_looks_complete(feed(("u", "20260101", "20260103"), complete=False)))

    def test_an_html_error_page_is_not_a_feed(self):
        from .views._ical import feed_looks_complete

        self.assertFalse(feed_looks_complete("<html><body>502 Bad Gateway</body></html>"))

    def test_an_empty_calendar_with_a_proper_ending_is_complete(self):
        from .views._ical import feed_looks_complete

        self.assertTrue(feed_looks_complete(feed()))

    def test_trailing_whitespace_does_not_make_a_feed_look_truncated(self):
        from .views._ical import feed_looks_complete

        self.assertTrue(feed_looks_complete(feed(("u", "20260101", "20260103")) + "\r\n\r\n"))
