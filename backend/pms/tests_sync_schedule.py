"""Timed synchronisation: when a feed is fetched, and what happens when it isn't.

Two runs of the importer overlapping is the one thing this must never allow.
Both would reconcile the same apartment against two different snapshots of the
same feed, and the loser writes last - so the calendar ends up reflecting
whichever fetch happened to be slower, which is not a decision anybody made.

The other half is failure. A channel that cannot be reached is not a channel
that has cancelled everything (`tests_sync_safety` holds that line); it is a
channel to try again shortly. Trying again immediately hammers a service that
is already struggling, and waiting the full interval means a morning's
bookings arrive at lunchtime. So: back off, and cap the backing off.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from .models import ChannelSyncState, SyncRun
from .tests import make_property
from .views._sync_schedule import (
    MAX_BACKOFF,
    STALE_RUN_AFTER,
    due_channels,
    record_attempt,
    release_run,
    start_run,
)


class RunLockTests(TestCase):
    """Only one import at a time, whoever asks."""

    def test_a_first_run_starts(self):
        run = start_run(trigger="scheduled")
        self.assertIsNotNone(run)

    def test_a_second_run_is_refused_while_the_first_is_going(self):
        start_run(trigger="scheduled")
        self.assertIsNone(start_run(trigger="manual"))

    def test_a_run_can_start_once_the_first_has_finished(self):
        first = start_run(trigger="scheduled")
        release_run(first)
        self.assertIsNotNone(start_run(trigger="manual"))

    def test_a_run_whose_process_died_is_reclaimed(self):
        """A killed worker leaves the lock held forever otherwise, and auto-sync
        silently stops until somebody notices months later."""
        stuck = start_run(trigger="scheduled")
        SyncRun.objects.filter(pk=stuck.pk).update(
            started_at=timezone.now() - STALE_RUN_AFTER - timedelta(minutes=1),
            heartbeat_at=timezone.now() - STALE_RUN_AFTER - timedelta(minutes=1),
        )
        self.assertIsNotNone(start_run(trigger="scheduled"))

    def test_a_run_still_beating_is_not_reclaimed(self):
        """Long is not the same as dead. A big estate takes a while."""
        stuck = start_run(trigger="scheduled")
        SyncRun.objects.filter(pk=stuck.pk).update(
            started_at=timezone.now() - STALE_RUN_AFTER - timedelta(hours=2),
            heartbeat_at=timezone.now() - timedelta(seconds=5),
        )
        self.assertIsNone(start_run(trigger="scheduled"))

    def test_releasing_records_the_outcome(self):
        run = start_run(trigger="manual")
        release_run(run, properties=3, errors=1)
        run.refresh_from_db()
        self.assertEqual(run.status, SyncRun.Status.COMPLETED)
        self.assertEqual(run.properties_synced, 3)
        self.assertEqual(run.error_count, 1)
        self.assertIsNotNone(run.finished_at)

    def test_a_run_released_after_a_crash_is_marked_failed(self):
        run = start_run(trigger="scheduled")
        release_run(run, error="the database went away")
        run.refresh_from_db()
        self.assertEqual(run.status, SyncRun.Status.FAILED)
        self.assertIn("database", run.error_message)


class DueChannelTests(TestCase):
    """Which feeds get fetched this time round."""

    def setUp(self):
        self.prop = make_property(
            name="Apartment #7",
            auto_sync_enabled=True,
            sync_interval_hours=6,
            airbnb_ical_url="https://example.test/a.ics",
        )

    def test_a_channel_never_synced_is_due(self):
        self.assertEqual([c for _, c in due_channels()], ["airbnb"])

    def test_a_channel_synced_just_now_is_not_due(self):
        record_attempt(self.prop, "airbnb", ok=True)
        self.assertEqual(due_channels(), [])

    def test_a_channel_is_due_again_once_its_interval_has_passed(self):
        record_attempt(self.prop, "airbnb", ok=True)
        ChannelSyncState.objects.filter(property=self.prop, channel="airbnb").update(
            next_attempt_at=timezone.now() - timedelta(minutes=1)
        )
        self.assertEqual([c for _, c in due_channels()], ["airbnb"])

    def test_auto_sync_off_means_never_due(self):
        self.prop.auto_sync_enabled = False
        self.prop.save(update_fields=["auto_sync_enabled"])
        self.assertEqual(due_channels(), [])

    def test_a_channel_with_no_link_is_not_due(self):
        self.prop.airbnb_ical_url = ""
        self.prop.save(update_fields=["airbnb_ical_url"])
        self.assertEqual(due_channels(), [])

    def test_an_inactive_property_is_not_due(self):
        self.prop.active = False
        self.prop.save(update_fields=["active"])
        self.assertEqual(due_channels(), [])

    def test_both_channels_are_returned_when_both_are_linked(self):
        self.prop.booking_ical_url = "https://example.test/b.ics"
        self.prop.save(update_fields=["booking_ical_url"])
        self.assertEqual(sorted(c for _, c in due_channels()), ["airbnb", "booking"])


class RetryTests(TestCase):
    """A feed that cannot be reached is retried, sooner each failure than the
    next scheduled run but not immediately."""

    def setUp(self):
        self.prop = make_property(
            name="Apartment #8",
            auto_sync_enabled=True,
            sync_interval_hours=24,
            airbnb_ical_url="https://example.test/a.ics",
        )

    def state(self):
        return ChannelSyncState.objects.get(property=self.prop, channel="airbnb")

    def test_a_success_schedules_the_next_run_a_full_interval_away(self):
        record_attempt(self.prop, "airbnb", ok=True)
        state = self.state()
        gap = state.next_attempt_at - timezone.now()
        self.assertGreater(gap, timedelta(hours=23))
        self.assertLessEqual(gap, timedelta(hours=24))

    def test_a_failure_is_retried_much_sooner_than_the_interval(self):
        record_attempt(self.prop, "airbnb", ok=False, error="timed out")
        gap = self.state().next_attempt_at - timezone.now()
        self.assertLess(gap, timedelta(hours=1))

    def test_each_further_failure_waits_longer(self):
        record_attempt(self.prop, "airbnb", ok=False, error="timed out")
        first = self.state().next_attempt_at
        record_attempt(self.prop, "airbnb", ok=False, error="timed out")
        second = self.state().next_attempt_at
        self.assertGreater(second, first)

    def test_the_backing_off_is_capped(self):
        for _ in range(20):
            record_attempt(self.prop, "airbnb", ok=False, error="timed out")
        gap = self.state().next_attempt_at - timezone.now()
        self.assertLessEqual(gap, MAX_BACKOFF + timedelta(minutes=1))

    def test_a_success_clears_the_failures(self):
        record_attempt(self.prop, "airbnb", ok=False, error="timed out")
        record_attempt(self.prop, "airbnb", ok=False, error="timed out")
        self.assertEqual(self.state().consecutive_failures, 2)
        record_attempt(self.prop, "airbnb", ok=True)
        state = self.state()
        self.assertEqual(state.consecutive_failures, 0)
        self.assertEqual(state.last_error, "")
        self.assertIsNotNone(state.last_success_at)

    def test_the_error_is_kept_so_the_page_can_say_why(self):
        record_attempt(self.prop, "airbnb", ok=False, error="Could not reach the calendar link.")
        self.assertIn("Could not reach", self.state().last_error)

    def test_an_attempt_is_recorded_even_when_it_fails(self):
        record_attempt(self.prop, "airbnb", ok=False, error="timed out")
        self.assertIsNotNone(self.state().last_attempt_at)
        self.assertIsNone(self.state().last_success_at)


class SyncStatusEndpointTests(TestCase):
    """The page has to be able to say what the schedule is doing."""

    def setUp(self):
        from django.contrib.auth.models import Group, User
        from django.test import Client

        self.client = Client()
        group, _ = Group.objects.get_or_create(name="Admin")
        user = User.objects.create_user(username="sched-admin", password="pw")
        user.groups.add(group)
        self.client.force_login(user)

        self.prop = make_property(
            name="Apartment #9",
            auto_sync_enabled=True,
            sync_interval_hours=12,
            airbnb_ical_url="https://example.test/a.ics",
        )

    def test_status_reports_what_is_due(self):
        body = self.client.get("/api/sync/status/").json()
        self.assertEqual(body["dueNow"], 1)
        self.assertEqual(body["autoSyncProperties"], 1)
        self.assertIsNone(body["running"])

    def test_status_reports_a_feed_that_is_failing(self):
        record_attempt(self.prop, "airbnb", ok=False, error="Could not reach the calendar link.")
        channel = self.client.get("/api/sync/status/").json()["channels"][0]
        self.assertEqual(channel["consecutiveFailures"], 1)
        self.assertIn("Could not reach", channel["lastError"])
        self.assertTrue(channel["nextAttemptAt"])

    def test_status_reports_a_run_in_progress(self):
        start_run(trigger="scheduled")
        self.assertIsNotNone(self.client.get("/api/sync/status/").json()["running"])

    def test_running_a_sync_while_one_is_going_is_refused(self):
        """Not an error the user caused, but they must not get a second import
        started on top of the first."""
        start_run(trigger="scheduled")
        response = self.client.post("/api/sync/run/")
        self.assertEqual(response.status_code, 409)

    def test_cleaning_cannot_read_the_sync_status(self):
        from django.contrib.auth.models import Group, User
        from django.test import Client

        cleaner = Client()
        group, _ = Group.objects.get_or_create(name="Cleaning")
        user = User.objects.create_user(username="sched-cleaner", password="pw")
        user.groups.add(group)
        cleaner.force_login(user)
        self.assertEqual(cleaner.get("/api/sync/status/").status_code, 403)

    def test_a_signed_out_visitor_cannot_start_a_sync(self):
        from django.test import Client

        self.assertIn(Client().post("/api/sync/run/").status_code, (401, 403))

    def test_status_refuses_a_post(self):
        self.assertEqual(self.client.post("/api/sync/status/").status_code, 405)
