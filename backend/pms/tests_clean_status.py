"""Marking an apartment cleaned must land on the right calendar day.

The dashboard asks "was this cleaned on the day I am looking at?" — a calendar
question in the operator's timezone. The record is an instant, and an instant's
UTC date is not the same as its local date: at 00:56 in Europe/Budapest the UTC
date is still yesterday. Comparing the UTC date against the dashboard's local
date made the checkbox impossible to tick between midnight and 02:00, and only
then, which is why it read as "not checkable for some reason".

The serializer therefore reports the LOCAL calendar day the clean happened on,
so the dashboard compares a date against a date.
"""

from datetime import datetime, timezone as dt_timezone

from django.test import TestCase
from django.utils.timezone import localdate

from .models import ApartmentCleanStatus
from .tests import make_property
from .views._serializers import serialize_clean_status


class CleanedDateIsLocalTests(TestCase):
    def setUp(self):
        self.prop = make_property()

    def status_at(self, moment):
        status, _ = ApartmentCleanStatus.objects.get_or_create(property=self.prop)
        status.is_cleaned = True
        status.cleaned_at = moment
        status.save()
        return serialize_clean_status(status)

    def test_just_after_local_midnight_reports_the_new_local_day(self):
        # 22:56 UTC is 00:56 the NEXT day in Europe/Budapest (UTC+2 in August).
        body = self.status_at(datetime(2026, 8, 20, 22, 56, tzinfo=dt_timezone.utc))
        self.assertEqual(body["cleanedDate"], "2026-08-21")

    def test_midday_reports_the_same_day(self):
        body = self.status_at(datetime(2026, 8, 20, 12, 0, tzinfo=dt_timezone.utc))
        self.assertEqual(body["cleanedDate"], "2026-08-20")

    def test_just_before_local_midnight_still_reports_the_old_day(self):
        # 21:59 UTC is 23:59 the same day locally.
        body = self.status_at(datetime(2026, 8, 20, 21, 59, tzinfo=dt_timezone.utc))
        self.assertEqual(body["cleanedDate"], "2026-08-20")

    def test_an_uncleaned_apartment_has_no_date(self):
        status, _ = ApartmentCleanStatus.objects.get_or_create(property=self.prop)
        status.is_cleaned = False
        status.cleaned_at = None
        status.save()
        self.assertEqual(serialize_clean_status(status)["cleanedDate"], "")

    def test_the_raw_instant_is_still_reported(self):
        """cleanedAt stays, for anything that wants the time of day."""
        body = self.status_at(datetime(2026, 8, 20, 22, 56, tzinfo=dt_timezone.utc))
        self.assertTrue(body["cleanedAt"].startswith("2026-08-20T22:56"))


class MarkingCleanedUsesTheLocalDayTests(TestCase):
    """The endpoint must stamp a moment whose LOCAL day is today."""

    def setUp(self):
        self.client_prop = make_property()

    def test_marking_now_reports_today_in_local_terms(self):
        from django.test import Client

        from .tests import make_admin

        client = Client()
        make_admin(client)
        response = client.post(
            f"/api/clean-status/{self.client_prop.id}/mark/",
            data='{"isCleaned": true}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        # This is the assertion that fails between local midnight and 02:00
        # when the instant is stamped in UTC and read back as a UTC date.
        self.assertEqual(
            response.json()["cleanStatus"]["cleanedDate"], localdate().isoformat()
        )
