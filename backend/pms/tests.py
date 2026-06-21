"""Tests for the highest-risk money paths: the pricing engine and the
public booking availability endpoint, plus the CSRF posture of the API."""

import json
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from .models import PricingRule, PromoCode, Property, Reservation
from .views._pricing import calculate_price


def make_property(**overrides):
    defaults = {
        "name": "Test Apartment",
        "bedrooms": 1,
        "max_guests": 2,
        "base_price_eur": Decimal("50.00"),
        "platform": Property.Platform.AIRSTAY,
        "active": True,
        "listing_active": True,
    }
    defaults.update(overrides)
    return Property.objects.create(**defaults)


def day(offset):
    return date.today() + timedelta(days=offset)


class PricingEngineTests(TestCase):
    def setUp(self):
        self.prop = make_property()

    def test_base_price_no_discounts(self):
        bd = calculate_price(self.prop, day(30), day(33))
        self.assertEqual(bd["nights"], 3)
        self.assertEqual(bd["subtotal"], "150.00")
        self.assertEqual(bd["total"], "150.00")
        self.assertEqual(bd["errors"], [])

    def test_default_long_stay_tier_applies(self):
        # 7 nights hits the built-in 15% tier: 350 − 52.50 = 297.50
        bd = calculate_price(self.prop, day(30), day(37))
        self.assertEqual(Decimal(bd["long_stay_pct"]), Decimal("15"))
        self.assertEqual(bd["long_stay_amount"], "52.50")
        self.assertEqual(bd["total"], "297.50")

    def test_custom_long_stay_rule_overrides_default(self):
        PricingRule.objects.create(
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=True,
            min_nights=7,
            discount_pct=Decimal("20"),
        )
        bd = calculate_price(self.prop, day(30), day(37))
        self.assertEqual(Decimal(bd["long_stay_pct"]), Decimal("20"))
        self.assertEqual(bd["total"], "280.00")

    def test_disabled_rule_is_ignored(self):
        PricingRule.objects.create(
            rule_type=PricingRule.RuleType.LONG_STAY,
            scope="all",
            enabled=False,
            min_nights=2,
            discount_pct=Decimal("90"),
        )
        bd = calculate_price(self.prop, day(30), day(33))
        # Falls back to defaults; 3 nights has no default tier.
        self.assertEqual(bd["long_stay_pct"], "0")
        self.assertEqual(bd["total"], "150.00")

    def test_last_minute_discount(self):
        PricingRule.objects.create(
            rule_type=PricingRule.RuleType.LAST_MINUTE,
            scope="all",
            enabled=True,
            days_before_checkin=3,
            discount_pct=Decimal("10"),
        )
        bd = calculate_price(self.prop, day(2), day(4))  # 2 days ahead → within window
        self.assertEqual(Decimal(bd["last_minute_pct"]), Decimal("10"))
        self.assertEqual(bd["total"], "90.00")  # 100 − 10%

        far = calculate_price(self.prop, day(30), day(32))  # outside window
        self.assertEqual(far["last_minute_pct"], "0")

    def test_seasonal_fixed_price(self):
        PricingRule.objects.create(
            rule_type=PricingRule.RuleType.SEASONAL,
            scope="all",
            enabled=True,
            start_date=day(20),
            end_date=day(60),
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("80.00"),
        )
        bd = calculate_price(self.prop, day(30), day(33))
        self.assertEqual(bd["effective_nightly"], "80.00")
        self.assertEqual(bd["total"], "240.00")
        self.assertTrue(bd["has_seasonal"])

    def test_promo_percentage_stacks_last(self):
        promo = PromoCode.objects.create(
            code="TEN",
            discount_type="percentage",
            discount_value=Decimal("10"),
            scope="all",
            active=True,
        )
        bd = calculate_price(self.prop, day(30), day(33), promo_code_obj=promo)
        self.assertEqual(bd["promo_amount"], "15.00")
        self.assertEqual(bd["total"], "135.00")

    def test_minimum_nights_produces_error(self):
        PricingRule.objects.create(
            rule_type=PricingRule.RuleType.MINIMUM_NIGHTS,
            scope="all",
            enabled=True,
            min_nights=3,
        )
        bd = calculate_price(self.prop, day(30), day(32))  # only 2 nights
        self.assertEqual(bd["min_nights_required"], 3)
        self.assertIn("Minimum stay is 3 nights.", bd["errors"])


class BookingAvailabilityTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.prop = make_property(name="Apartment A")

    def search(self, check_in, check_out, guests=2):
        return self.client.get(
            "/api/booking/availability/",
            {"check_in": check_in.isoformat(), "check_out": check_out.isoformat(), "guests": guests},
        ).json()

    def test_free_property_is_available(self):
        data = self.search(day(10), day(13))
        names = [row["property"]["name"] for row in data["available"]]
        self.assertIn("Apartment A", names)
        self.assertEqual(data["nights"], 3)

    def test_overlapping_reservation_blocks_property(self):
        Reservation.objects.create(
            property=self.prop,
            guest_name="Guest",
            platform=Reservation.Platform.PRIVATE,
            check_in=day(11),
            check_out=day(12),
            nightly_price_eur=Decimal("50.00"),
        )
        data = self.search(day(10), day(13))
        self.assertEqual(data["available"], [])

    def test_guest_capacity_filters_out_small_units(self):
        data = self.search(day(10), day(13), guests=4)
        self.assertEqual(data["available"], [])

    def test_combination_offered_when_no_single_unit_fits(self):
        make_property(name="Apartment B", max_guests=2)
        data = self.search(day(10), day(13), guests=4)
        self.assertEqual(data["available"], [])
        self.assertTrue(data["combinations"], "expected a multi-apartment combination")
        combo = data["combinations"][0]
        self.assertEqual(len(combo["apartments"]), 2)
        self.assertEqual(combo["combinedTotal"], "300.00")

    def test_calendar_returns_blocked_ranges(self):
        Reservation.objects.create(
            property=self.prop,
            guest_name="Guest",
            platform=Reservation.Platform.PRIVATE,
            check_in=day(5),
            check_out=day(8),
            nightly_price_eur=Decimal("50.00"),
        )
        data = self.client.get(f"/api/booking/properties/{self.prop.id}/calendar/").json()
        self.assertEqual(
            data["blocked"],
            [{"checkIn": day(5).isoformat(), "checkOut": day(8).isoformat()}],
        )


def make_admin(client):
    group, _ = Group.objects.get_or_create(name="Admin")
    user = User.objects.create_user(username="admin", password="pw")
    user.groups.add(group)
    client.force_login(user)
    return user


class BackupRoundTripTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property(name="Apartment A")
        Reservation.objects.create(
            property=self.prop,
            guest_name="Guest",
            platform=Reservation.Platform.PRIVATE,
            check_in=day(1),
            check_out=day(3),
            nightly_price_eur=Decimal("50.00"),
        )

    def test_export_returns_json_attachment(self):
        resp = self.client.get("/api/backup/export/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("attachment", resp["Content-Disposition"])
        records = json.loads(resp.content)
        self.assertTrue(any(r["model"] == "pms.reservation" for r in records))

    def test_import_replaces_all_data(self):
        export = self.client.get("/api/backup/export/").content
        # Diverge from the backup: a new apartment that import must wipe.
        make_property(name="Apartment B")
        self.assertEqual(Property.objects.count(), 2)

        upload = SimpleUploadedFile("backup.json", export, content_type="application/json")
        resp = self.client.post("/api/backup/import/", {"file": upload})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["ok"])

        # Apartment B is gone; the backed-up state is restored intact.
        self.assertEqual(Property.objects.count(), 1)
        self.assertEqual(Property.objects.first().name, "Apartment A")
        self.assertEqual(Reservation.objects.count(), 1)

    def test_import_rejects_garbage_without_touching_data(self):
        upload = SimpleUploadedFile("bad.json", b"not json", content_type="application/json")
        resp = self.client.post("/api/backup/import/", {"file": upload})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Property.objects.count(), 1)  # untouched

    def test_export_requires_admin(self):
        self.client.logout()
        group, _ = Group.objects.get_or_create(name="Management")
        mgr = User.objects.create_user(username="mgr", password="pw")
        mgr.groups.add(group)
        self.client.force_login(mgr)
        self.assertEqual(self.client.get("/api/backup/export/").status_code, 403)


class DashboardForecastTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_forecast_shape(self):
        prop = make_property()
        Reservation.objects.create(
            property=prop,
            guest_name="G",
            platform=Reservation.Platform.PRIVATE,
            check_in=day(0),
            check_out=day(2),
            nightly_price_eur=Decimal("50.00"),
        )
        data = self.client.get(
            "/api/dashboard/forecast/", {"platform": Property.Platform.AIRSTAY}
        ).json()
        self.assertEqual(len(data["workload"]["days"]), 14)
        self.assertEqual(data["workload"]["days"][0]["checkIns"], 1)
        self.assertIn("projectedTurnoverEur", data["monthForecast"])
        self.assertNotIn("turnovers", data["workload"]["days"][0])


class CsrfPostureTests(TestCase):
    def test_authenticated_endpoints_reject_forged_posts(self):
        client = Client(enforce_csrf_checks=True)
        response = client.post(
            "/api/auth/login/",
            data='{"username": "x", "password": "y"}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_public_booking_endpoints_stay_open(self):
        client = Client(enforce_csrf_checks=True)
        prop = make_property()
        response = client.post(
            "/api/booking/calculate/",
            data=(
                '{"propertyId": "%s", "checkIn": "%s", "checkOut": "%s"}'
                % (prop.id, day(10).isoformat(), day(12).isoformat())
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["priceBreakdown"]["total"], "100.00")
