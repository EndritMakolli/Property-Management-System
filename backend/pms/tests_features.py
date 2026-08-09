"""Regression tests for the per-month expense model, map privacy, minimum-stay
surfacing and the media/archive backup paths."""

import io
import json
import math
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path

from django.conf import settings as django_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from .models import (
    BookingSiteSettings,
    ExpenseCategory,
    FinanceExpense,
    GuestDocument,
    PricingRule,
    Property,
)
from .tests import day, make_admin, make_property


class ExpensePaymentMonthTests(TestCase):
    """Paid status is per month: paying July must not mark August paid."""

    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.category = ExpenseCategory.objects.create(name="Wages")
        self.expense = FinanceExpense.objects.create(
            name="Employee wage",
            category=self.category,
            amount_eur=Decimal("800.00"),
            frequency=FinanceExpense.Frequency.REPEATED,
            start_year=2026,
            start_month=1,
        )

    def _pay(self, year, month, paid=True):
        return self.client.post(
            f"/api/finance/expenses/{self.expense.id}/payments/",
            data=json.dumps({"year": year, "month": month, "paid": paid}),
            content_type="application/json",
        )

    def _expense_row(self, year, month):
        body = self.client.get("/api/finance/summary/", {"year": year, "month": month}).json()
        return body["expenses"][0]

    def test_paying_one_month_leaves_the_next_unpaid(self):
        self.assertEqual(self._pay(2026, 7).status_code, 200)
        self.assertTrue(self._expense_row(2026, 7)["paidForMonth"])
        self.assertFalse(self._expense_row(2026, 8)["paidForMonth"])

    def test_unpaying_removes_only_that_month(self):
        self._pay(2026, 7)
        self._pay(2026, 8)
        self._pay(2026, 7, paid=False)
        self.assertFalse(self._expense_row(2026, 7)["paidForMonth"])
        self.assertTrue(self._expense_row(2026, 8)["paidForMonth"])

    def test_paid_amount_uses_the_snapshot_not_the_edited_amount(self):
        self._pay(2026, 7)
        # Raising the expense later must not rewrite what was already paid.
        FinanceExpense.objects.filter(pk=self.expense.pk).update(amount_eur=Decimal("900.00"))

        month = self.client.get(
            "/api/finance/analytics/", {"start": "2026-07", "end": "2026-07"}
        ).json()["months"][0]
        self.assertEqual(month["totalEur"], "900.00")
        self.assertEqual(month["paidEur"], "800.00")
        self.assertEqual(month["unpaidEur"], "100.00")

    def test_rejects_month_the_expense_is_not_active_in(self):
        self.assertEqual(self._pay(2025, 1).status_code, 400)

    def test_outstanding_lists_arrears_with_their_month(self):
        today = date.today()
        one_time = FinanceExpense.objects.create(
            name="Roof repair",
            category=self.category,
            amount_eur=Decimal("300.00"),
            frequency=FinanceExpense.Frequency.ONE_TIME,
            start_year=today.year,
            start_month=today.month,
        )
        rows = self.client.get("/api/finance/outstanding/").json()["outstanding"]
        self.assertIn(str(one_time.id), [row["id"] for row in rows])
        self.assertTrue(all("year" in row and "month" in row for row in rows))

    def test_outstanding_keeps_showing_unpaid_past_months(self):
        # The recurring wage started in Jan 2026 and was never paid, so months
        # before the current one must still be listed as owed.
        rows = self.client.get("/api/finance/outstanding/", {"months": 60}).json()["outstanding"]
        wage_months = [(r["year"], r["month"]) for r in rows if r["id"] == str(self.expense.id)]
        self.assertGreater(len(wage_months), 1)
        self.assertEqual(wage_months, sorted(wage_months))

    def test_analytics_all_time_survives_future_only_expenses(self):
        FinanceExpense.objects.all().delete()
        FinanceExpense.objects.create(
            name="Next year contract",
            category=self.category,
            amount_eur=Decimal("100.00"),
            frequency=FinanceExpense.Frequency.ONE_TIME,
            start_year=date.today().year + 2,
            start_month=1,
        )
        resp = self.client.get("/api/finance/analytics/", {"all": "1"})
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_analytics_requires_authentication(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/finance/analytics/").status_code, 401)


class MapPrivacyTests(TestCase):
    """Guests must never receive exact coordinates while privacy is enabled."""

    def setUp(self):
        self.client = Client()
        self.prop = make_property(
            latitude=Decimal("42.662900"), longitude=Decimal("21.165500")
        )

    def _public_property(self):
        return self.client.get("/api/booking/properties/").json()["properties"][0]

    def _set_radius(self, radius):
        settings = BookingSiteSettings.get()
        settings.map_privacy_radius_m = radius
        settings.save()

    def test_coordinates_are_shifted_but_stay_inside_the_circle(self):
        self._set_radius(300)
        data = self._public_property()
        self.assertEqual(data["mapRadiusM"], 300)

        lat, lng = float(data["latitude"]), float(data["longitude"])
        self.assertNotEqual(lat, float(self.prop.latitude))

        # The true point must lie inside the circle the guest is shown.
        dlat = (lat - float(self.prop.latitude)) * 111320
        dlng = (lng - float(self.prop.longitude)) * 111320 * math.cos(math.radians(lat))
        self.assertLess(math.hypot(dlat, dlng), 300)

    def test_offset_is_stable_across_requests(self):
        self._set_radius(300)
        first = self._public_property()
        second = self._public_property()
        self.assertEqual(first["latitude"], second["latitude"])
        self.assertEqual(first["longitude"], second["longitude"])

    def test_radius_zero_returns_exact_coordinates(self):
        self._set_radius(0)
        data = self._public_property()
        self.assertEqual(data["mapRadiusM"], 0)
        self.assertEqual(float(data["latitude"]), float(self.prop.latitude))

    def test_availability_results_are_also_fuzzed(self):
        self._set_radius(300)
        data = self.client.get(
            "/api/booking/availability/",
            {"check_in": day(10).isoformat(), "check_out": day(12).isoformat(), "guests": 1},
        ).json()
        served = data["available"][0]["property"]
        self.assertNotEqual(float(served["latitude"]), float(self.prop.latitude))


class MinNightsSurfacingTests(TestCase):
    """Too-short stays are surfaced with their minimum, not silently hidden."""

    def setUp(self):
        self.client = Client()
        self.prop = make_property()
        PricingRule.objects.create(
            rule_type=PricingRule.RuleType.MINIMUM_NIGHTS,
            scope=PricingRule.Scope.ALL,
            min_nights=3,
            enabled=True,
        )

    def _availability(self, nights):
        return self.client.get(
            "/api/booking/availability/",
            {
                "check_in": day(10).isoformat(),
                "check_out": day(10 + nights).isoformat(),
                "guests": 1,
            },
        ).json()

    def test_short_stay_appears_under_min_stay_blocked(self):
        data = self._availability(1)
        self.assertEqual(data["available"], [])
        self.assertEqual(len(data["minStayBlocked"]), 1)
        self.assertEqual(data["minStayBlocked"][0]["minNights"], 3)

    def test_long_enough_stay_is_bookable(self):
        data = self._availability(4)
        self.assertEqual(len(data["available"]), 1)
        self.assertEqual(data["minStayBlocked"], [])

    def test_listing_reports_the_minimum(self):
        data = self.client.get("/api/booking/properties/").json()["properties"][0]
        self.assertEqual(data["minNights"], 3)


class PublicListingPricingTests(TestCase):
    """Pricing rules must reach the listing endpoint, not just search."""

    def setUp(self):
        self.client = Client()
        self.prop = make_property(base_price_eur=Decimal("50.00"))
        PricingRule.objects.create(
            rule_type=PricingRule.RuleType.SEASONAL,
            scope=PricingRule.Scope.ALL,
            start_date=day(0),
            end_date=day(60),
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("80.00"),
            enabled=True,
        )

    def test_listing_with_dates_uses_the_seasonal_rate(self):
        data = self.client.get(
            "/api/booking/properties/",
            {"check_in": day(10).isoformat(), "check_out": day(12).isoformat()},
        ).json()["properties"][0]
        self.assertIsNotNone(data["priceBreakdown"])
        self.assertEqual(data["priceBreakdown"]["effective_nightly"], "80.00")

    def test_listing_without_dates_has_no_breakdown(self):
        data = self.client.get("/api/booking/properties/").json()["properties"][0]
        self.assertIsNone(data["priceBreakdown"])


class MediaBackupTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_media_import_rejects_path_traversal(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("../../escaped.txt", b"nope")
            archive.writestr("properties/ok.txt", b"fine")
        upload = SimpleUploadedFile(
            "media.zip", buffer.getvalue(), content_type="application/zip"
        )

        resp = self.client.post("/api/backup/media/import/", {"file": upload})
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["restoredFiles"], 1)
        self.assertEqual(body["skippedFiles"], 1)
        escaped = Path(django_settings.MEDIA_ROOT).parent / "escaped.txt"
        self.assertFalse(escaped.exists())

    def test_archive_export_contains_records(self):
        make_property(name="Apartment A")
        resp = self.client.get("/api/backup/archive/export/")
        self.assertEqual(resp.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(resp.content)) as archive:
            self.assertIn("backup.json", archive.namelist())
            records = json.loads(archive.read("backup.json"))
        self.assertTrue(any(r["model"] == "pms.property" for r in records))

    def test_archive_import_without_backup_json_is_rejected(self):
        make_property(name="Apartment A")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("media/properties/photo.jpg", b"x")
        upload = SimpleUploadedFile(
            "archive.zip", buffer.getvalue(), content_type="application/zip"
        )
        resp = self.client.post("/api/backup/archive/import/", {"file": upload})
        self.assertEqual(resp.status_code, 400)
        # The database must be untouched when the archive is unusable.
        self.assertEqual(Property.objects.count(), 1)

    def test_media_import_rejects_non_zip(self):
        upload = SimpleUploadedFile("x.zip", b"not a zip", content_type="application/zip")
        resp = self.client.post("/api/backup/media/import/", {"file": upload})
        self.assertEqual(resp.status_code, 400)

    def test_media_endpoints_require_authentication(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/backup/media/export/").status_code, 401)
        self.assertEqual(self.client.get("/api/backup/archive/export/").status_code, 401)


class GuestDocumentTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.guest = self.client.post(
            "/api/guests/",
            data=json.dumps({"firstName": "Ana", "lastName": "Krasniqi"}),
            content_type="application/json",
        ).json()["guest"]

    def test_upload_list_and_delete(self):
        upload = SimpleUploadedFile("passport.png", b"\x89PNG fake", content_type="image/png")
        created = self.client.post(
            f"/api/guests/{self.guest['id']}/documents/",
            {"file": upload, "docType": "passport"},
        )
        self.assertEqual(created.status_code, 201, created.content)
        document = created.json()["document"]
        self.assertEqual(document["docType"], "passport")
        self.assertTrue(document["url"])

        listed = self.client.get(f"/api/guests/{self.guest['id']}/documents/").json()
        self.assertEqual(len(listed["documents"]), 1)

        deleted = self.client.delete(
            f"/api/guests/{self.guest['id']}/documents/{document['id']}/"
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/guests/{self.guest['id']}/documents/").json()["documents"], []
        )

    def test_rejects_unsupported_file_type(self):
        upload = SimpleUploadedFile("virus.exe", b"MZ", content_type="application/x-msdownload")
        resp = self.client.post(
            f"/api/guests/{self.guest['id']}/documents/", {"file": upload}
        )
        self.assertEqual(resp.status_code, 400)

    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.get(f"/api/guests/{self.guest['id']}/documents/")
        self.assertEqual(resp.status_code, 401)

    def _upload(self):
        upload = SimpleUploadedFile("passport.png", b"\x89PNG fake", content_type="image/png")
        return self.client.post(
            f"/api/guests/{self.guest['id']}/documents/",
            {"file": upload, "docType": "passport"},
        ).json()["document"]

    def test_document_url_is_not_a_public_media_path(self):
        # ID documents are personal data — the URL must go through the
        # role-checked API, never the world-readable /media/ route.
        document = self._upload()
        self.assertNotIn("/media/", document["url"])
        self.assertIn(f"/api/guests/{self.guest['id']}/documents/", document["url"])

    def test_download_requires_authentication(self):
        document = self._upload()
        path = f"/api/guests/{self.guest['id']}/documents/{document['id']}/download/"
        self.assertEqual(self.client.get(path).status_code, 200)
        self.client.logout()
        self.assertEqual(self.client.get(path).status_code, 401)

    def test_raw_media_path_for_documents_is_blocked(self):
        self._upload()
        stored = GuestDocument.objects.first()
        resp = self.client.get(f"/media/{stored.file.name}")
        self.assertEqual(resp.status_code, 404)


class SyncAllTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_reports_zero_work_when_no_ical_links_configured(self):
        make_property(name="No links")
        resp = self.client.post(
            "/api/properties/sync-all/", data="{}", content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["summary"]["total"], 0)
        self.assertEqual(body["results"], [])

    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.post(
            "/api/properties/sync-all/", data="{}", content_type="application/json"
        )
        self.assertEqual(resp.status_code, 401)
