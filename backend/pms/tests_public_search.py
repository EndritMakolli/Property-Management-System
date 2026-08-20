"""The public listing must respect the party size, like the search does.

/api/booking/availability/ has always filtered on max_guests. The plain
listing behind it — used by the map page, which shows each apartment's
capacity on its card — never did, so a guest searching for five people was
shown two-person studios alongside the apartments that actually fit them.
"""

from django.conf import settings
from django.test import Client, TestCase

from .tests import make_property


class PublicListingGuestFilterTests(TestCase):
    def setUp(self):
        settings.ALLOWED_HOSTS.append("testserver")
        self.client = Client()
        self.studio = make_property(name="Studio", bedrooms=1, max_guests=2)
        self.flat = make_property(name="Two bed", bedrooms=2, max_guests=4)
        self.house = make_property(name="Three bed", bedrooms=3, max_guests=7)

    def names(self, query=""):
        response = self.client.get(f"/api/booking/properties/{query}")
        self.assertEqual(response.status_code, 200)
        return sorted(p["name"] for p in response.json()["properties"])

    def test_without_a_party_size_every_listing_shows(self):
        self.assertEqual(self.names(), ["Studio", "Three bed", "Two bed"])

    def test_a_party_of_three_is_not_shown_a_two_person_studio(self):
        self.assertEqual(self.names("?guests=3"), ["Three bed", "Two bed"])

    def test_a_party_of_five_only_sees_what_fits_them(self):
        self.assertEqual(self.names("?guests=5"), ["Three bed"])

    def test_capacity_may_exceed_the_party(self):
        """Four people fit a seven-person house; it must still be offered."""
        self.assertIn("Three bed", self.names("?guests=4"))

    def test_a_party_larger_than_anything_sees_nothing(self):
        self.assertEqual(self.names("?guests=9"), [])

    def test_one_guest_sees_everything(self):
        self.assertEqual(len(self.names("?guests=1")), 3)

    def test_a_nonsense_party_size_is_ignored_rather_than_erroring(self):
        self.assertEqual(len(self.names("?guests=abc")), 3)

    def test_a_zero_or_negative_party_size_is_treated_as_one(self):
        self.assertEqual(len(self.names("?guests=0")), 3)
        self.assertEqual(len(self.names("?guests=-4")), 3)
