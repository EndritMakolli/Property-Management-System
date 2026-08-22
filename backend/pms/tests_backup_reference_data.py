"""Importing an old backup must not leave the app without its vocabulary.

`_run_data_import` wipes every row of every pms model and then loads the file.
That is correct for *data* — but a backup exported before a lookup table existed
carries no rows for it, so the wipe empties it and nothing puts it back.

That is not hypothetical. It is exactly what happened to a live database: 797
reservations still referencing `airbnb`, `booking`, `private` and the rest, and
a completely empty `ReservationType` table — which meant no colours anywhere and
every reservation save rejected as an unknown type.

The import already heals older backups this way for monthly prices and guest
links. Reference data joins them.
"""

from decimal import Decimal

from django.test import TestCase

from .models import MessageTemplate, Reservation, ReservationType
from .reference_data import ensure_reference_data
from .tests import day, make_property
from .views._backup import _run_data_import

BUILTIN_CODES = ["airbnb", "booking", "direct", "maintenance", "monthly", "private"]


class ImportRestoresReferenceDataTests(TestCase):
    """The empty-file case: the worst a backup can do to a lookup table."""

    def test_the_reservation_types_come_back(self):
        self.assertIsNone(_run_data_import([]))
        self.assertEqual(
            sorted(ReservationType.objects.values_list("code", flat=True)), BUILTIN_CODES
        )

    def test_the_email_templates_come_back(self):
        _run_data_import([])
        scenarios = set(MessageTemplate.objects.values_list("scenario", flat=True))
        self.assertIn("booking_approved", scenarios)
        self.assertIn("booking_rejected", scenarios)

    def test_the_availability_templates_come_back_too(self):
        _run_data_import([])
        scenarios = set(MessageTemplate.objects.values_list("scenario", flat=True))
        self.assertIn("available", scenarios)
        self.assertEqual(MessageTemplate.objects.count(), 6)

    def test_every_restored_type_has_a_colour(self):
        _run_data_import([])
        for row in ReservationType.objects.all():
            self.assertRegex(row.color, r"^#[0-9a-fA-F]{6}$", row.code)


class EnsureReferenceDataTests(TestCase):
    def test_it_leaves_a_customised_colour_alone(self):
        """A newer backup carries the operator's own colours — do not stamp
        over them with the defaults."""
        ReservationType.objects.filter(code="airbnb").update(color="#123456")
        ensure_reference_data()
        self.assertEqual(ReservationType.objects.get(code="airbnb").color, "#123456")

    def test_it_leaves_edited_wording_alone(self):
        MessageTemplate.objects.filter(scenario="available").update(body_sq="my own words")
        ensure_reference_data()
        self.assertEqual(
            MessageTemplate.objects.get(scenario="available").body_sq, "my own words"
        )

    def test_it_is_safe_to_run_twice(self):
        ensure_reference_data()
        ensure_reference_data()
        self.assertEqual(ReservationType.objects.count(), 6)

    def test_a_type_only_the_data_knows_about_is_rebuilt(self):
        """An operator adds "Glamping", then restores a backup from before it.

        The reservations still say `glamping`, so the type has to exist or they
        become uneditable. Better a plain grey row than a broken record.
        """
        ReservationType.objects.create(
            code="glamping", label="Glamping", color="#00ff00", sort_order=9
        )
        prop = make_property()
        Reservation.objects.create(
            property=prop,
            guest_name="Ana",
            platform="glamping",
            check_in=day(1),
            check_out=day(3),
            nightly_price_eur=Decimal("50.00"),
        )
        ReservationType.objects.all().delete()

        ensure_reference_data()

        rebuilt = ReservationType.objects.get(code="glamping")
        self.assertFalse(rebuilt.is_builtin, "a rebuilt custom type stays deletable")
        self.assertRegex(rebuilt.color, r"^#[0-9a-fA-F]{6}$")

    def test_rebuilding_does_not_invent_types_nothing_uses(self):
        ensure_reference_data()
        self.assertEqual(ReservationType.objects.count(), 6)
