"""Staff leaves: a register somebody keeps, not a workflow anybody uses.

This replaced a request-and-approve flow hung off the Django login accounts.
Two things were wrong with that. Leave is recorded for cleaners and handymen who
have no login at all, so hanging it off `auth.User` could not describe the
people it was for. And nobody was ever going to file a request through the PMS -
the office knows who was off; it needs somewhere to write it down and a running
total.

So: `StaffMember` is a name and a yearly allowance. `StaffLeave` is a period
against that name, entered by whoever keeps the register. There is no status,
because nothing is being decided here.

The allowance rule that matters: **only annual leave spends it.** Sick days are
not holiday, and counting them against the 21 would quietly punish illness.
"""

from datetime import date

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import StaffLeave, StaffMember


def staff_client(role="Admin", username="leave-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client, user


class StaffRegisterTests(TestCase):
    """People are added by name. Most of them have no login."""

    def setUp(self):
        self.client, self.user = staff_client()

    def test_a_member_of_staff_is_added_by_name(self):
        response = self.client.post(
            "/api/staff-members/",
            data={"name": "Arben Krasniqi"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(StaffMember.objects.get().name, "Arben Krasniqi")

    def test_the_yearly_allowance_defaults_to_twenty_one_days(self):
        self.client.post(
            "/api/staff-members/", data={"name": "Arben"}, content_type="application/json"
        )
        self.assertEqual(StaffMember.objects.get().annual_leave_days, 21)

    def test_the_allowance_can_be_set_per_person(self):
        self.client.post(
            "/api/staff-members/",
            data={"name": "Arben", "annualLeaveDays": 25},
            content_type="application/json",
        )
        self.assertEqual(StaffMember.objects.get().annual_leave_days, 25)

    def test_the_allowance_can_be_changed_later(self):
        member = StaffMember.objects.create(name="Arben")
        self.client.patch(
            f"/api/staff-members/{member.id}/",
            data={"annualLeaveDays": 28},
            content_type="application/json",
        )
        member.refresh_from_db()
        self.assertEqual(member.annual_leave_days, 28)

    def test_a_nameless_member_of_staff_is_refused(self):
        response = self.client.post(
            "/api/staff-members/", data={"name": "  "}, content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)

    def test_a_negative_allowance_is_refused(self):
        response = self.client.post(
            "/api/staff-members/",
            data={"name": "Arben", "annualLeaveDays": -3},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_somebody_who_has_left_is_deactivated_not_deleted(self):
        """Their leave last year still happened, and the year's figures have to
        keep adding up."""
        member = StaffMember.objects.create(name="Arben")
        self.client.patch(
            f"/api/staff-members/{member.id}/",
            data={"active": False},
            content_type="application/json",
        )
        member.refresh_from_db()
        self.assertFalse(member.active)
        self.assertTrue(StaffMember.objects.filter(pk=member.pk).exists())

    def test_the_list_leaves_out_people_who_have_left(self):
        StaffMember.objects.create(name="Here")
        StaffMember.objects.create(name="Gone", active=False)
        names = [row["name"] for row in self.client.get("/api/staff-members/").json()["staff"]]
        self.assertEqual(names, ["Here"])

    def test_they_can_be_asked_for(self):
        StaffMember.objects.create(name="Gone", active=False)
        rows = self.client.get("/api/staff-members/", {"inactive": "1"}).json()["staff"]
        self.assertEqual([row["name"] for row in rows], ["Gone"])

    def test_deleting_is_possible_for_a_name_typed_in_error(self):
        member = StaffMember.objects.create(name="Typo")
        self.assertEqual(self.client.delete(f"/api/staff-members/{member.id}/").status_code, 200)
        self.assertFalse(StaffMember.objects.filter(pk=member.pk).exists())


class RecordingLeaveTests(TestCase):
    def setUp(self):
        self.client, self.user = staff_client()
        self.member = StaffMember.objects.create(name="Arben Krasniqi")

    def post(self, **overrides):
        payload = {
            "staffMemberId": str(self.member.id),
            "leaveType": "annual",
            "startDate": "2026-08-03",
            "endDate": "2026-08-07",
        }
        payload.update(overrides)
        return self.client.post(
            "/api/staff-leave/", data=payload, content_type="application/json"
        )

    def test_a_period_is_recorded_against_a_name(self):
        self.assertEqual(self.post().status_code, 201)
        self.assertEqual(StaffLeave.objects.get().staff_member, self.member)

    def test_the_days_are_counted_inclusively(self):
        """Monday to Friday off is five days, not four."""
        self.post()
        self.assertEqual(StaffLeave.objects.get().days, 5)

    def test_a_single_day_off_is_one_day(self):
        self.post(startDate="2026-08-03", endDate="2026-08-03")
        self.assertEqual(StaffLeave.objects.get().days, 1)

    def test_leave_that_ends_before_it_starts_is_refused(self):
        self.assertEqual(self.post(startDate="2026-08-07", endDate="2026-08-03").status_code, 400)

    def test_an_unknown_leave_type_is_refused(self):
        self.assertEqual(self.post(leaveType="sabbatical").status_code, 400)

    def test_an_unknown_member_of_staff_is_refused(self):
        bad = "11111111-1111-1111-1111-111111111111"
        self.assertEqual(self.post(staffMemberId=bad).status_code, 400)

    def test_who_wrote_it_down_is_recorded(self):
        """Not an approval - just the register's own audit trail."""
        self.post()
        self.assertEqual(StaffLeave.objects.get().recorded_by, self.user)

    def test_a_period_can_be_corrected(self):
        self.post()
        leave = StaffLeave.objects.get()
        self.client.patch(
            f"/api/staff-leave/{leave.id}/",
            data={"endDate": "2026-08-05"},
            content_type="application/json",
        )
        leave.refresh_from_db()
        self.assertEqual(leave.days, 3)

    def test_a_period_entered_wrongly_can_be_removed(self):
        self.post()
        leave = StaffLeave.objects.get()
        self.assertEqual(self.client.delete(f"/api/staff-leave/{leave.id}/").status_code, 200)
        self.assertEqual(StaffLeave.objects.count(), 0)

    def test_there_is_no_approval_step(self):
        """Nothing is being decided. A period exists or it does not."""
        self.post()
        self.assertFalse(hasattr(StaffLeave.objects.get(), "status"))


class AllowanceTests(TestCase):
    """How many days are left — the question the page exists to answer."""

    def setUp(self):
        self.client, _ = staff_client()
        self.member = StaffMember.objects.create(name="Arben", annual_leave_days=21)

    def leave(self, start, end, leave_type="annual", member=None):
        return StaffLeave.objects.create(
            staff_member=member or self.member,
            leave_type=leave_type,
            start_date=date.fromisoformat(start),
            end_date=date.fromisoformat(end),
        )

    def summary(self, year=2026):
        rows = self.client.get("/api/staff-leave/", {"year": year}).json()["staff"]
        return {row["name"]: row for row in rows}

    def test_an_untouched_allowance_is_all_remaining(self):
        row = self.summary()["Arben"]
        self.assertEqual(row["annualAllowance"], 21)
        self.assertEqual(row["annualTaken"], 0)
        self.assertEqual(row["annualRemaining"], 21)

    def test_annual_leave_spends_the_allowance(self):
        self.leave("2026-08-03", "2026-08-07")  # 5 days
        row = self.summary()["Arben"]
        self.assertEqual(row["annualTaken"], 5)
        self.assertEqual(row["annualRemaining"], 16)

    def test_sick_days_do_not_spend_the_allowance(self):
        """Sick leave is not holiday. Counting it against the 21 would quietly
        punish being ill."""
        self.leave("2026-08-03", "2026-08-07", leave_type="sick")
        row = self.summary()["Arben"]
        self.assertEqual(row["annualTaken"], 0)
        self.assertEqual(row["annualRemaining"], 21)
        self.assertEqual(row["sickDays"], 5)

    def test_unpaid_leave_does_not_spend_the_allowance_either(self):
        self.leave("2026-08-03", "2026-08-07", leave_type="unpaid")
        self.assertEqual(self.summary()["Arben"]["annualTaken"], 0)

    def test_taking_more_than_the_allowance_goes_negative_rather_than_hiding_it(self):
        """Somebody has taken 25 of 21. The register says so; it does not
        clamp to zero and pretend."""
        self.leave("2026-01-01", "2026-01-25")  # 25 days
        row = self.summary()["Arben"]
        self.assertEqual(row["annualTaken"], 25)
        self.assertEqual(row["annualRemaining"], -4)

    def test_last_years_leave_does_not_count_against_this_year(self):
        self.leave("2025-08-03", "2025-08-07")
        self.assertEqual(self.summary(2026)["Arben"]["annualTaken"], 0)
        self.assertEqual(self.summary(2025)["Arben"]["annualTaken"], 5)

    def test_a_period_spanning_new_year_is_split_across_both_years(self):
        """30 Dec to 2 Jan is two days of one year's allowance and two of the
        next. Charging it all to whichever year it started in is how an
        allowance quietly gains or loses days."""
        self.leave("2026-12-30", "2027-01-02")
        self.assertEqual(self.summary(2026)["Arben"]["annualTaken"], 2)
        self.assertEqual(self.summary(2027)["Arben"]["annualTaken"], 2)

    def test_every_member_of_staff_appears_even_with_no_leave(self):
        StaffMember.objects.create(name="Never Off")
        self.assertIn("Never Off", self.summary())

    def test_the_periods_themselves_come_back_for_the_grid(self):
        self.leave("2026-08-03", "2026-08-07")
        rows = self.client.get("/api/staff-leave/", {"year": 2026}).json()["leave"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["startDate"], "2026-08-03")
        self.assertEqual(rows[0]["days"], 5)

    def test_a_period_from_another_year_is_not_in_the_grid(self):
        self.leave("2025-08-03", "2025-08-07")
        self.assertEqual(self.client.get("/api/staff-leave/", {"year": 2026}).json()["leave"], [])

    def test_a_period_overlapping_the_year_is_in_the_grid(self):
        self.leave("2026-12-30", "2027-01-02")
        self.assertEqual(len(self.client.get("/api/staff-leave/", {"year": 2026}).json()["leave"]), 1)


class WhoCanUseItTests(TestCase):
    """Office staff keep the register. Nobody else needs it."""

    def setUp(self):
        self.member = StaffMember.objects.create(name="Arben")

    def test_management_can_read_and_write(self):
        client, _ = staff_client(role="Management", username="leave-manager")
        self.assertEqual(client.get("/api/staff-leave/").status_code, 200)
        response = client.post(
            "/api/staff-leave/",
            data={
                "staffMemberId": str(self.member.id),
                "leaveType": "annual",
                "startDate": "2026-08-03",
                "endDate": "2026-08-04",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)

    def test_cleaning_staff_cannot_reach_it(self):
        """They are recorded in it, and do not keep it."""
        client, _ = staff_client(role="Cleaning", username="leave-cleaner")
        self.assertEqual(client.get("/api/staff-leave/").status_code, 403)
        self.assertEqual(client.get("/api/staff-members/").status_code, 403)

    def test_a_signed_out_visitor_reads_nothing(self):
        self.assertIn(Client().get("/api/staff-leave/").status_code, (401, 403))
        self.assertIn(Client().get("/api/staff-members/").status_code, (401, 403))
