"""An issue you can tick off, rather than only destroy.

"To Fix" had no status of any kind - no resolved flag, no closed date, nobody's
name against it. The only way to clear an item was DELETE, so the list could
say what was outstanding and never what had been dealt with. Twenty-two open
issues and no history of a single repair.

It was also the one place in the application that destroyed rather than
archived: a reservation archives, a client archives, only maintenance was
thrown away. Now it is fixed or it is open, and Delete is what it is
everywhere else - the exception, for a row entered by mistake.
"""

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .models import MaintenanceIssue
from .tests import make_property


def staff_client(role="Admin", username="fix-admin"):
    client = Client()
    group, _ = Group.objects.get_or_create(name=role)
    user = User.objects.create_user(username=username, password="pw")
    user.groups.add(group)
    client.force_login(user)
    return client, user


class ResolvingAnIssueTests(TestCase):
    def setUp(self):
        self.client, self.user = staff_client()
        self.prop = make_property(name="Apartment #31")
        self.issue = MaintenanceIssue.objects.create(
            property=self.prop, description="Kitchen tap drips", reporter_name="Ana"
        )
        self.url = f"/api/maintenance/{self.issue.id}/"

    def test_a_new_issue_is_open(self):
        self.assertFalse(self.issue.is_resolved)
        self.assertIsNone(self.issue.resolved_at)

    def test_an_issue_can_be_marked_fixed(self):
        response = self.client.patch(
            self.url, data={"isResolved": True}, content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.issue.refresh_from_db()
        self.assertTrue(self.issue.is_resolved)

    def test_fixing_records_who_and_when(self):
        """The whole point: six months on, what was done and by whom."""
        self.client.patch(self.url, data={"isResolved": True}, content_type="application/json")
        self.issue.refresh_from_db()
        self.assertIsNotNone(self.issue.resolved_at)
        self.assertEqual(self.issue.resolved_by, self.user)

    def test_an_issue_can_be_reopened(self):
        """A tap that drips again is the same tap."""
        self.client.patch(self.url, data={"isResolved": True}, content_type="application/json")
        self.client.patch(self.url, data={"isResolved": False}, content_type="application/json")
        self.issue.refresh_from_db()
        self.assertFalse(self.issue.is_resolved)
        self.assertIsNone(self.issue.resolved_at)
        self.assertIsNone(self.issue.resolved_by)

    def test_resolving_does_not_delete_it(self):
        self.client.patch(self.url, data={"isResolved": True}, content_type="application/json")
        self.assertTrue(MaintenanceIssue.objects.filter(pk=self.issue.pk).exists())

    def test_the_description_can_still_be_edited(self):
        self.client.patch(
            self.url, data={"description": "Kitchen tap drips badly"}, content_type="application/json"
        )
        self.issue.refresh_from_db()
        self.assertEqual(self.issue.description, "Kitchen tap drips badly")

    def test_editing_the_description_does_not_reopen_a_fixed_issue(self):
        """Only the keys sent. A form that omits isResolved must not clear it."""
        self.client.patch(self.url, data={"isResolved": True}, content_type="application/json")
        self.client.patch(
            self.url, data={"description": "Kitchen tap, fixed washer"}, content_type="application/json"
        )
        self.issue.refresh_from_db()
        self.assertTrue(self.issue.is_resolved)

    def test_cleaning_staff_can_tick_an_issue_off(self):
        """They are the ones who find them and often the ones who fix them."""
        cleaner, _ = staff_client(role="Cleaning", username="fix-cleaner")
        response = cleaner.patch(
            self.url, data={"isResolved": True}, content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)

    def test_a_signed_out_visitor_cannot_touch_an_issue(self):
        response = Client().patch(
            self.url, data={"isResolved": True}, content_type="application/json"
        )
        self.assertIn(response.status_code, (401, 403))


class ListingOpenAndFixedTests(TestCase):
    def setUp(self):
        self.client, _ = staff_client(username="fix-lister")
        self.prop = make_property(name="Apartment #32")
        self.open_issue = MaintenanceIssue.objects.create(
            property=self.prop, description="Still broken"
        )
        self.done = MaintenanceIssue.objects.create(property=self.prop, description="Sorted")
        self.client.patch(
            f"/api/maintenance/{self.done.id}/",
            data={"isResolved": True},
            content_type="application/json",
        )

    def rows(self, **params):
        return self.client.get("/api/maintenance/", params).json()["issues"]

    def test_the_list_shows_only_open_issues_by_default(self):
        """The list answers "what needs doing". A fixed tap is history."""
        ids = [row["id"] for row in self.rows()]
        self.assertIn(str(self.open_issue.id), ids)
        self.assertNotIn(str(self.done.id), ids)

    def test_fixed_issues_can_be_asked_for(self):
        ids = [row["id"] for row in self.rows(resolved="1")]
        self.assertEqual(ids, [str(self.done.id)])

    def test_a_row_says_whether_it_is_fixed(self):
        row = self.rows()[0]
        self.assertIn("isResolved", row)
        self.assertFalse(row["isResolved"])

    def test_a_fixed_row_carries_who_fixed_it(self):
        row = self.rows(resolved="1")[0]
        self.assertEqual(row["resolvedBy"], "fix-lister")
        self.assertTrue(row["resolvedAt"])


class DeleteIsStillThereTests(TestCase):
    """For a row entered by mistake. Resolving is the normal way out."""

    def test_an_issue_can_still_be_deleted(self):
        client, _ = staff_client(username="fix-deleter")
        prop = make_property(name="Apartment #33")
        issue = MaintenanceIssue.objects.create(property=prop, description="Typo")
        response = client.delete(f"/api/maintenance/{issue.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(MaintenanceIssue.objects.filter(pk=issue.pk).exists())
