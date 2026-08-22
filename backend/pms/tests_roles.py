"""Role resolution, and the one case it got wrong.

`user_role()` mapped an authenticated user to one of three roles by Django
group. Anyone with no group fell through to `ROLE_CLEANING` — and cleaning can
read `/api/codes/door/` and `/api/codes/lockboxes/`. So an account that existed
but had never been assigned a group silently held the door codes to every
apartment.

Nothing exploits that today: every non-superuser in the live database has a
group. It matters because it is about to become reachable. A guest portal is
being added, and the obvious implementation — a Django user per guest — would
have put every guest who signed in on exactly that path.

Guests are not Django users in the design that was chosen, so this is defence in
depth rather than the fix itself. It is still worth closing: a fallback that
grants access is the wrong default for a per-view permission system with no
default-deny.
"""

from django.contrib.auth.models import Group, User
from django.test import Client, TestCase

from .views._roles import ROLE_ADMIN, ROLE_CLEANING, ROLE_MANAGEMENT, user_role


def make(username, group_name=None, superuser=False):
    user = (
        User.objects.create_superuser(username=username, password="pw")
        if superuser
        else User.objects.create_user(username=username, password="pw")
    )
    if group_name:
        group, _ = Group.objects.get_or_create(name=group_name)
        user.groups.add(group)
    return user


class RoleResolutionTests(TestCase):
    def test_a_user_with_no_group_has_no_role(self):
        self.assertEqual(user_role(make("nobody")), "")

    def test_an_anonymous_user_has_no_role(self):
        from django.contrib.auth.models import AnonymousUser

        self.assertEqual(user_role(AnonymousUser()), "")

    def test_admin_group_resolves(self):
        self.assertEqual(user_role(make("a", "Admin")), ROLE_ADMIN)

    def test_management_group_resolves(self):
        self.assertEqual(user_role(make("m", "Management")), ROLE_MANAGEMENT)

    def test_cleaning_group_resolves(self):
        self.assertEqual(user_role(make("c", "Cleaning")), ROLE_CLEANING)

    def test_a_superuser_is_admin_without_a_group(self):
        """The one deliberate exception — superuser is checked before groups."""
        self.assertEqual(user_role(make("root", superuser=True)), ROLE_ADMIN)


class GrouplessUserReachesNothingTests(TestCase):
    """The point of the change: no group means no access, not cleaning access."""

    def setUp(self):
        self.client = Client()
        make("nobody")
        self.client.login(username="nobody", password="pw")

    def test_door_codes_are_refused(self):
        self.assertEqual(self.client.get("/api/codes/door/").status_code, 403)

    def test_lockbox_codes_are_refused(self):
        self.assertEqual(self.client.get("/api/codes/lockboxes/").status_code, 403)

    def test_the_cleaning_dashboard_is_refused(self):
        self.assertEqual(self.client.get("/api/clean-status/").status_code, 403)

    def test_a_real_cleaner_still_gets_in(self):
        """The change must not lock out the role it borrowed its name from."""
        client = Client()
        make("realcleaner", "Cleaning")
        client.login(username="realcleaner", password="pw")
        self.assertEqual(client.get("/api/codes/door/").status_code, 200)
