"""Servicing and registration for the Fleet vehicles.

A vehicle is a `Property` with `platform="fleet"`, so the service fields live
there rather than in a parallel table — a second table would need its own
lifecycle, and every vehicle already has exactly one row.

The interesting part is `vehicle_alerts`. It answers "what needs attention" in
one place, so the codes page, the dashboard and the notifications all agree
about whether a van is overdue. Two independent clocks run: the calendar (a
service is due every N months, registration expires on a date) and the odometer
(a service is due every N kilometres). Whichever comes first wins.
"""

from datetime import date, timedelta

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import Property
from .tests import make_property
from .views._fleet import vehicle_alerts


def staff_client(role="Admin", username="fleet-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client


def make_vehicle(name="Kia Xceed", **extra):
    return make_property(name=name, platform=Property.Platform.FLEET, **extra)


TODAY = date(2026, 8, 27)


class ServiceDueTests(TestCase):
    """A service falls due on a date or on an odometer reading."""

    def test_a_vehicle_with_nothing_recorded_asks_to_be_set_up(self):
        car = make_vehicle()
        alerts = vehicle_alerts(car, today=TODAY)
        self.assertTrue(any(a["kind"] == "service_unknown" for a in alerts))

    def test_a_recently_serviced_vehicle_is_quiet(self):
        car = make_vehicle(last_service_date=TODAY - timedelta(days=30), service_interval_months=12)
        self.assertEqual([a for a in vehicle_alerts(car, today=TODAY) if a["kind"].startswith("service")], [])

    def test_a_service_coming_up_warns(self):
        # Due in 12 months, serviced 11 months and 20 days ago.
        car = make_vehicle(last_service_date=TODAY - timedelta(days=355), service_interval_months=12)
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("service_due_soon", kinds)

    def test_an_overdue_service_is_flagged_as_overdue_not_soon(self):
        car = make_vehicle(last_service_date=TODAY - timedelta(days=400), service_interval_months=12)
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("service_overdue", kinds)
        self.assertNotIn("service_due_soon", kinds)

    def test_the_odometer_can_make_a_service_due_before_the_calendar_does(self):
        """Serviced last month, but it has done 15,000 km since."""
        car = make_vehicle(
            last_service_date=TODAY - timedelta(days=30),
            service_interval_months=12,
            last_service_km=100000,
            current_km=115000,
            service_interval_km=10000,
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("service_overdue", kinds)

    def test_kilometres_approaching_the_interval_warn(self):
        car = make_vehicle(
            last_service_date=TODAY - timedelta(days=30),
            last_service_km=100000,
            current_km=109200,
            service_interval_km=10000,
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("service_due_soon", kinds)

    def test_an_alert_says_how_far_over_it_is(self):
        car = make_vehicle(last_service_date=TODAY - timedelta(days=400), service_interval_months=12)
        alert = next(a for a in vehicle_alerts(car, today=TODAY) if a["kind"] == "service_overdue")
        self.assertIn("overdue", alert["message"].lower())

    def test_a_vehicle_never_reports_twice_for_the_same_service(self):
        """Overdue by date and by kilometres is still one thing to do."""
        car = make_vehicle(
            last_service_date=TODAY - timedelta(days=400),
            service_interval_months=12,
            last_service_km=100000,
            current_km=130000,
            service_interval_km=10000,
        )
        service_alerts = [a for a in vehicle_alerts(car, today=TODAY) if a["kind"].startswith("service")]
        self.assertEqual(len(service_alerts), 1)


class RegistrationTests(TestCase):
    def test_a_vehicle_with_no_registration_date_asks_for_one(self):
        car = make_vehicle()
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("registration_unknown", kinds)

    def test_a_registration_valid_for_months_is_quiet(self):
        car = make_vehicle(registration_expiry=TODAY + timedelta(days=200))
        self.assertEqual(
            [a for a in vehicle_alerts(car, today=TODAY) if a["kind"].startswith("registration")], []
        )

    def test_a_registration_expiring_within_a_month_warns(self):
        car = make_vehicle(registration_expiry=TODAY + timedelta(days=20))
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("registration_due_soon", kinds)

    def test_an_expired_registration_is_flagged_as_expired(self):
        car = make_vehicle(registration_expiry=TODAY - timedelta(days=3))
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("registration_expired", kinds)
        self.assertNotIn("registration_due_soon", kinds)

    def test_expiring_today_still_counts_as_expiring_not_expired(self):
        """It is legal to drive on the last day."""
        car = make_vehicle(registration_expiry=TODAY)
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("registration_due_soon", kinds)

    def test_an_expired_registration_is_the_most_severe_alert(self):
        car = make_vehicle(registration_expiry=TODAY - timedelta(days=3))
        alert = next(a for a in vehicle_alerts(car, today=TODAY) if a["kind"] == "registration_expired")
        self.assertEqual(alert["severity"], "overdue")


class VehicleServiceApiTests(TestCase):
    def setUp(self):
        self.client = staff_client()
        self.car = make_vehicle()
        # An apartment, to prove the endpoint does not return one.
        make_property(name="Apartment #2", platform=Property.Platform.AIRSTAY)

    def test_the_list_returns_vehicles_only(self):
        response = self.client.get("/api/fleet/service/")
        self.assertEqual(response.status_code, 200)
        names = [row["name"] for row in response.json()["vehicles"]]
        self.assertEqual(names, ["Kia Xceed"])

    def test_each_vehicle_carries_its_alerts(self):
        row = self.client.get("/api/fleet/service/").json()["vehicles"][0]
        self.assertIn("alerts", row)

    def test_the_service_record_can_be_saved(self):
        response = self.client.patch(
            f"/api/fleet/service/{self.car.id}/",
            data={
                "lastServiceDate": "2026-06-01",
                "lastServiceKm": 100000,
                "currentKm": 104000,
                "serviceIntervalKm": 10000,
                "serviceIntervalMonths": 12,
                "registrationDate": "2026-03-01",
                "registrationExpiry": "2027-03-01",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.car.refresh_from_db()
        self.assertEqual(self.car.last_service_km, 100000)
        self.assertEqual(self.car.registration_expiry, date(2027, 3, 1))

    def test_clearing_a_date_is_allowed(self):
        self.car.registration_expiry = date(2027, 1, 1)
        self.car.save()
        self.client.patch(
            f"/api/fleet/service/{self.car.id}/",
            data={"registrationExpiry": ""},
            content_type="application/json",
        )
        self.car.refresh_from_db()
        self.assertIsNone(self.car.registration_expiry)

    def test_an_odometer_reading_below_the_last_service_is_refused(self):
        """Kilometres do not go backwards; a typo here would hide a due service."""
        response = self.client.patch(
            f"/api/fleet/service/{self.car.id}/",
            data={"lastServiceKm": 100000, "currentKm": 90000},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_an_apartment_cannot_be_given_a_service_record(self):
        flat = Property.objects.get(name="Apartment #2")
        response = self.client.patch(
            f"/api/fleet/service/{flat.id}/",
            data={"currentKm": 1000},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    def test_cleaning_may_read_the_list(self):
        cleaner = staff_client(role="Cleaning", username="fleet-cleaner")
        self.assertEqual(cleaner.get("/api/fleet/service/").status_code, 200)

    def test_cleaning_may_not_edit_it(self):
        cleaner = staff_client(role="Cleaning", username="fleet-cleaner2")
        response = cleaner.patch(
            f"/api/fleet/service/{self.car.id}/",
            data={"currentKm": 1000},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)


class VehicleIdentityTests(TestCase):
    """Brand, type, chassis and plates are filled in per car on this page."""

    def setUp(self):
        self.client = staff_client(username="fleet-identity")
        self.car = make_vehicle()

    def patch(self, **payload):
        return self.client.patch(
            f"/api/fleet/service/{self.car.id}/",
            data=payload,
            content_type="application/json",
        )

    def test_the_identity_fields_save(self):
        response = self.patch(
            brand="Kia",
            model="Stonic",
            chassisNumber="KNADA814BRT920569",
            licencePlate="01-695-CZ",
            allowedCountries="Kosovo, Albania",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.car.refresh_from_db()
        self.assertEqual(self.car.brand, "Kia")
        self.assertEqual(self.car.model, "Stonic")
        self.assertEqual(self.car.chassis_number, "KNADA814BRT920569")
        self.assertEqual(self.car.licence_plate, "01-695-CZ")
        self.assertEqual(self.car.allowed_countries, "Kosovo, Albania")

    def test_they_come_back_in_the_list(self):
        self.patch(brand="Kia", licencePlate="01-695-CZ")
        row = self.client.get("/api/fleet/service/").json()["vehicles"][0]
        self.assertEqual(row["brand"], "Kia")
        self.assertEqual(row["licencePlate"], "01-695-CZ")

    def test_whitespace_is_trimmed(self):
        self.patch(licencePlate="  01-695-CZ  ")
        self.car.refresh_from_db()
        self.assertEqual(self.car.licence_plate, "01-695-CZ")

    def test_saving_the_identity_leaves_the_service_record_alone(self):
        self.car.current_km = 42000
        self.car.save()
        self.patch(brand="Kia")
        self.car.refresh_from_db()
        self.assertEqual(self.car.current_km, 42000)

    def test_cleaning_cannot_change_the_identity(self):
        cleaner = staff_client(role="Cleaning", username="fleet-cleaner3")
        response = cleaner.patch(
            f"/api/fleet/service/{self.car.id}/",
            data={"brand": "Kia"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)


class WarningWindowTests(TestCase):
    """How much notice each vehicle gives before a service or renewal.

    Per vehicle rather than one global setting, because the window only means
    something next to the interval it qualifies: 800 km is 8% of a 10,000 km
    service cycle and under 3% of a 30,000 km one. Every vehicle starts on the
    values the code used before this was configurable, so nothing changes until
    someone asks it to.
    """

    def setUp(self):
        self.client = staff_client(username="fleet-windows")

    def test_a_new_vehicle_keeps_the_old_defaults(self):
        car = make_vehicle()
        self.assertEqual(car.registration_warning_days, 30)
        self.assertEqual(car.service_warning_days, 30)
        self.assertEqual(car.service_warning_km, 800)

    def test_a_longer_registration_window_warns_earlier(self):
        car = make_vehicle(
            registration_expiry=TODAY + timedelta(days=60), registration_warning_days=90
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("registration_due_soon", kinds)

    def test_the_same_vehicle_on_the_default_window_stays_quiet(self):
        car = make_vehicle(
            registration_expiry=TODAY + timedelta(days=60), registration_warning_days=30
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertNotIn("registration_due_soon", kinds)

    def test_a_shorter_window_stays_quiet_for_longer(self):
        car = make_vehicle(
            registration_expiry=TODAY + timedelta(days=20), registration_warning_days=7
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertNotIn("registration_due_soon", kinds)

    def test_a_longer_service_day_window_warns_earlier(self):
        car = make_vehicle(
            last_service_date=TODAY - timedelta(days=300),
            service_interval_months=12,
            service_warning_days=90,
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("service_due_soon", kinds)

    def test_a_wider_kilometre_window_warns_earlier(self):
        car = make_vehicle(
            last_service_km=100000,
            current_km=107000,
            service_interval_km=10000,
            service_warning_km=4000,
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("service_due_soon", kinds)

    def test_the_same_reading_on_the_default_window_stays_quiet(self):
        car = make_vehicle(
            last_service_km=100000,
            current_km=107000,
            service_interval_km=10000,
            service_warning_km=800,
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertNotIn("service_due_soon", kinds)

    def test_a_window_of_zero_means_tell_me_only_when_it_is_overdue(self):
        car = make_vehicle(
            registration_expiry=TODAY + timedelta(days=1), registration_warning_days=0
        )
        self.assertEqual(
            [a for a in vehicle_alerts(car, today=TODAY) if a["kind"].startswith("registration")], []
        )

    def test_a_window_of_zero_still_reports_it_once_overdue(self):
        car = make_vehicle(
            registration_expiry=TODAY - timedelta(days=1), registration_warning_days=0
        )
        kinds = [a["kind"] for a in vehicle_alerts(car, today=TODAY)]
        self.assertIn("registration_expired", kinds)

    def test_the_windows_save_from_the_page(self):
        car = make_vehicle()
        response = self.client.patch(
            f"/api/fleet/service/{car.id}/",
            data={
                "registrationWarningDays": 60,
                "serviceWarningDays": 45,
                "serviceWarningKm": 1500,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        car.refresh_from_db()
        self.assertEqual(car.registration_warning_days, 60)
        self.assertEqual(car.service_warning_days, 45)
        self.assertEqual(car.service_warning_km, 1500)

    def test_they_come_back_in_the_list(self):
        make_vehicle(registration_warning_days=60)
        row = self.client.get("/api/fleet/service/").json()["vehicles"][0]
        self.assertEqual(row["registrationWarningDays"], 60)

    def test_a_negative_window_is_refused(self):
        car = make_vehicle()
        response = self.client.patch(
            f"/api/fleet/service/{car.id}/",
            data={"registrationWarningDays": -5},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
