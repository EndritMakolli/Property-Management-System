"""Half bathrooms.

"1.5 bathrooms" means one full bathroom and one without a shower — a real and
common layout that a whole number cannot express.

The subtlety is on the way out, not in. `JsonResponse` renders a `Decimal` as a
JSON *string*, so switching the column type without touching the serializers
would quietly change `bathrooms: 1` into `bathrooms: "1.0"` and break every
comparison the frontend does with it. These tests pin the wire format.
"""

import json
from decimal import Decimal

from django.test import Client, TestCase

from .models import MessageTemplate, Property
from .tests import day, make_admin, make_property


class BathroomStorageTests(TestCase):
    def test_a_half_bathroom_can_be_stored(self):
        prop = make_property(bathrooms=Decimal("1.5"))
        prop.refresh_from_db()
        self.assertEqual(prop.bathrooms, Decimal("1.5"))

    def test_a_whole_number_is_still_fine(self):
        prop = make_property(bathrooms=Decimal("2"))
        prop.refresh_from_db()
        self.assertEqual(prop.bathrooms, Decimal("2.0"))


class BathroomWireFormatTests(TestCase):
    """The API must keep sending a number, not a string."""

    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_the_staff_api_sends_a_number(self):
        make_property(bathrooms=Decimal("1.5"))
        row = self.client.get("/api/properties/").json()["properties"][0]
        self.assertIsInstance(row["bathrooms"], (int, float))
        self.assertEqual(row["bathrooms"], 1.5)

    def test_a_whole_number_is_not_sent_as_a_string(self):
        make_property(bathrooms=Decimal("2"))
        row = self.client.get("/api/properties/").json()["properties"][0]
        self.assertIsInstance(row["bathrooms"], (int, float))
        self.assertEqual(row["bathrooms"], 2)

    def test_the_public_api_sends_a_number(self):
        make_property(bathrooms=Decimal("1.5"))
        rows = Client().get("/api/booking/properties/").json()["properties"]
        self.assertEqual(rows[0]["bathrooms"], 1.5)


class BathroomInputTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_a_half_bathroom_survives_a_create(self):
        response = self.client.post(
            "/api/properties/",
            data={"name": "Half bath flat", "bedrooms": "1", "maxGuests": "2", "bathrooms": "1.5"},
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Property.objects.get(name="Half bath flat").bathrooms, Decimal("1.5"))

    def test_a_half_bathroom_survives_an_edit(self):
        prop = make_property()
        self.client.patch(
            f"/api/properties/{prop.id}/",
            data=json.dumps({"bathrooms": "2.5"}),
            content_type="application/json",
        )
        prop.refresh_from_db()
        self.assertEqual(prop.bathrooms, Decimal("2.5"))

    def test_nonsense_is_refused_rather_than_crashing(self):
        prop = make_property()
        response = self.client.patch(
            f"/api/properties/{prop.id}/",
            data=json.dumps({"bathrooms": "two and a bit"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class BathroomsInAGuestReplyTests(TestCase):
    """`(bathrooms)` is prose — it must not read "1.0 bathrooms"."""

    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def draft(self, prop_bathrooms):
        make_property(name="Apartment A", bedrooms=2, max_guests=4, bathrooms=prop_bathrooms)
        MessageTemplate.objects.filter(scenario="available").update(
            body_sq="- (bathrooms) banjo"
        )
        return self.client.post(
            "/api/message-drafts/",
            data=json.dumps(
                {
                    "checkIn": day(30).isoformat(),
                    "checkOut": day(33).isoformat(),
                    "language": "sq",
                    "freeTypes": [2],
                    "splitCovers": False,
                    "nextFree": "",
                }
            ),
            content_type="application/json",
        ).json()["body"]

    def test_a_whole_number_reads_as_a_whole_number(self):
        self.assertIn("- 1 banjo", self.draft(Decimal("1")))

    def test_a_half_reads_as_a_half(self):
        self.assertIn("- 1.5 banjo", self.draft(Decimal("1.5")))
