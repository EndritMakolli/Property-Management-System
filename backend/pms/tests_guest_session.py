"""The guest session, and its deliberate independence from the staff one.

A guest is never a `django.contrib.auth.User`. They get their own key in the
same Django session, which means two things have to be true and are each pinned
by a test here:

* **A staff session and a guest session coexist.** `cycle_key()` rotates the
  session id while keeping its contents, so signing in as a guest does not
  disturb a staff login in the same browser, and vice versa.
* **Neither can be mistaken for the other.** A staff login alone is not a guest
  session; a guest session alone leaves `request.user` anonymous, which is the
  whole reason every existing `require_roles` endpoint already rejects a guest
  without being modified.

One asymmetry is accepted rather than engineered around, and
`test_staff_logout_also_ends_a_guest_session` exists to stop someone "fixing"
it: `django.contrib.auth.logout()` calls `session.flush()`, which takes the
guest key with it. Only an operator ever holds both sessions, and being signed
out of a portal is not a harm.
"""

import uuid

from django.contrib.auth.models import Group, User
from django.test import Client, RequestFactory, TestCase

from .models import GuestAccount
from .views._guest_session import (
    GUEST_SESSION_KEY,
    current_guest,
    end_guest_session,
    require_guest,
    start_guest_session,
)


def request_with_session(factory, client=None):
    """A request carrying a real, saved session."""
    from django.contrib.sessions.middleware import SessionMiddleware

    request = factory.get("/")
    SessionMiddleware(lambda r: None).process_request(request)
    request.session.save()
    return request


class SessionLifecycleTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = GuestAccount.for_email("ana@example.com")

    def test_signing_in_rotates_the_session_key(self):
        """Otherwise a session id planted before sign-in still works after."""
        request = request_with_session(self.factory)
        before = request.session.session_key
        start_guest_session(request, self.account)
        self.assertNotEqual(request.session.session_key, before)

    def test_signing_in_records_the_account(self):
        request = request_with_session(self.factory)
        start_guest_session(request, self.account)
        self.assertEqual(request.session[GUEST_SESSION_KEY], str(self.account.pk))

    def test_the_account_can_be_read_back(self):
        request = request_with_session(self.factory)
        start_guest_session(request, self.account)
        self.assertEqual(current_guest(request), self.account)

    def test_there_is_no_guest_without_a_key(self):
        self.assertIsNone(current_guest(request_with_session(self.factory)))

    def test_an_account_that_no_longer_exists_is_forgotten(self):
        request = request_with_session(self.factory)
        request.session[GUEST_SESSION_KEY] = str(uuid.uuid4())
        self.assertIsNone(current_guest(request))
        self.assertNotIn(GUEST_SESSION_KEY, request.session)

    def test_a_corrupt_key_is_forgotten_rather_than_raising(self):
        request = request_with_session(self.factory)
        request.session[GUEST_SESSION_KEY] = "not-a-uuid"
        self.assertIsNone(current_guest(request))

    def test_signing_out_drops_the_key(self):
        request = request_with_session(self.factory)
        start_guest_session(request, self.account)
        end_guest_session(request)
        self.assertIsNone(current_guest(request))


class RequireGuestTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = GuestAccount.for_email("ana@example.com")

    def test_a_signed_in_guest_is_returned_with_no_denial(self):
        request = request_with_session(self.factory)
        start_guest_session(request, self.account)
        account, denied = require_guest(request)
        self.assertEqual(account, self.account)
        self.assertIsNone(denied)

    def test_an_anonymous_caller_is_denied_with_401(self):
        account, denied = require_guest(request_with_session(self.factory))
        self.assertIsNone(account)
        self.assertEqual(denied.status_code, 401)


class TheTwoSessionsAreIndependentTests(TestCase):
    """Neither system may be mistaken for the other, in either direction."""

    def setUp(self):
        self.factory = RequestFactory()
        self.account = GuestAccount.for_email("ana@example.com")
        group, _ = Group.objects.get_or_create(name="Admin")
        self.staff = User.objects.create_user(username="admin", password="pw")
        self.staff.groups.add(group)

    def test_a_staff_login_alone_is_not_a_guest_session(self):
        client = Client()
        client.force_login(self.staff)
        request = self.factory.get("/")
        request.session = client.session
        self.assertIsNone(current_guest(request))

    def test_signing_in_as_a_guest_leaves_a_staff_login_intact(self):
        client = Client()
        client.force_login(self.staff)
        request = self.factory.get("/")
        request.session = client.session

        start_guest_session(request, self.account)

        from django.contrib.auth import SESSION_KEY

        self.assertIn(SESSION_KEY, request.session)

    def test_signing_out_as_a_guest_leaves_a_staff_login_intact(self):
        """end_guest_session must never call session.flush()."""
        client = Client()
        client.force_login(self.staff)
        request = self.factory.get("/")
        request.session = client.session
        start_guest_session(request, self.account)

        end_guest_session(request)

        from django.contrib.auth import SESSION_KEY

        self.assertIn(SESSION_KEY, request.session)
        self.assertIsNone(current_guest(request))

    def test_staff_logout_also_ends_a_guest_session(self):
        """Characterisation, not a defect.

        auth.logout() calls session.flush(), which clears every key including
        this one. Accepted: only an operator ever holds both sessions, and
        being signed out of a guest portal costs one emailed link. Pinned here
        so the behaviour is a decision rather than a surprise.
        """
        client = Client()
        client.force_login(self.staff)
        session = client.session
        session[GUEST_SESSION_KEY] = str(self.account.pk)
        session.save()
        self.assertIn(GUEST_SESSION_KEY, client.session)

        client.post("/api/auth/logout/")

        self.assertNotIn(GUEST_SESSION_KEY, client.session)
