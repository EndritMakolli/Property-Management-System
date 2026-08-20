"""Rendering a guest reply from a template.

The renderer is deliberately pure — no HTTP, no models — because the awkward
parts are all textual: a discount clause that must vanish rather than print
"− 0€", a bullet that repeats once per free bedroom type, and a placeholder
that could not be filled and must stay visible rather than silently blank.

Placeholder syntax is parenthesised natural language, matched case-insensitively
and tolerant of internal whitespace, so staff can write `(nightly price)` the
way they would say it.
"""

from datetime import date

from django.test import TestCase

from .views._drafts import detect_scenario, format_stay_date, render_template


class DateFormattingTests(TestCase):
    def test_albanian_dates_are_dotted_and_padded(self):
        self.assertEqual(format_stay_date(date(2026, 9, 20), "sq"), "20.09.2026")

    def test_english_dates_are_written_out(self):
        self.assertEqual(format_stay_date(date(2026, 9, 20), "en"), "20 Sep 2026")

    def test_an_empty_date_renders_as_nothing(self):
        self.assertEqual(format_stay_date(None, "sq"), "")


class PlaceholderTests(TestCase):
    def render(self, body, values, **kwargs):
        return render_template(body, values, **kwargs)

    def test_a_placeholder_is_replaced_by_its_value(self):
        body, unresolved = self.render("Nga (check-in).", {"check-in": "20.09.2026"})
        self.assertEqual(body, "Nga 20.09.2026.")
        self.assertEqual(unresolved, [])

    def test_matching_ignores_case(self):
        body, _ = self.render("(Nightly Price)€", {"nightly price": "35"})
        self.assertEqual(body, "35€")

    def test_matching_tolerates_internal_whitespace(self):
        body, _ = self.render("( nightly   price )€", {"nightly price": "35"})
        self.assertEqual(body, "35€")

    def test_an_unknown_placeholder_stays_visible_and_is_reported(self):
        """A visible gap is safer than a silent deletion — staff always edit."""
        body, unresolved = self.render("Hi (guest name).", {})
        self.assertEqual(body, "Hi (guest name).")
        self.assertEqual(unresolved, ["guest name"])

    def test_an_empty_value_counts_as_unresolved(self):
        body, unresolved = self.render("Hi (guest name).", {"guest name": ""})
        self.assertEqual(body, "Hi (guest name).")
        self.assertEqual(unresolved, ["guest name"])

    def test_each_unresolved_placeholder_is_reported_once(self):
        _, unresolved = self.render("(a) then (a) then (b)", {})
        self.assertEqual(sorted(unresolved), ["a", "b"])


class OptionalSegmentTests(TestCase):
    """`[...]` disappears when the placeholders inside it have no value."""

    LINE = "= (subtotal)€[ − (discount)€ zbritje] = (total price)€"

    def test_the_segment_stays_when_its_value_is_present(self):
        body, _ = render_template(
            self.LINE, {"subtotal": "245", "discount": "36.75", "total price": "208.25"}
        )
        self.assertEqual(body, "= 245€ − 36.75€ zbritje = 208.25€")

    def test_the_segment_goes_when_its_value_is_missing(self):
        body, unresolved = render_template(
            self.LINE, {"subtotal": "90", "total price": "90"}
        )
        self.assertEqual(body, "= 90€ = 90€")

    def test_a_dropped_segment_is_not_reported_as_unresolved(self):
        """It was optional; its absence is the point, not a failure."""
        _, unresolved = render_template(self.LINE, {"subtotal": "90", "total price": "90"})
        self.assertEqual(unresolved, [])

    def test_a_zero_discount_drops_the_segment(self):
        body, _ = render_template(
            self.LINE, {"subtotal": "90", "discount": "0", "total price": "90"}
        )
        self.assertEqual(body, "= 90€ = 90€")

    def test_segments_without_placeholders_are_left_alone(self):
        body, _ = render_template("keep [these] brackets", {})
        self.assertEqual(body, "keep [these] brackets")


class RepeatingLineTests(TestCase):
    """A line carrying per-apartment placeholders repeats once per free type."""

    BODY = (
        "Kemi te lire:\n"
        "- [ ] Banesa me (bedrooms) dhoma, (capacity) persona, (nightly price)€\n"
        "Faleminderit."
    )

    def types(self):
        return [
            {"bedrooms": "1", "capacity": "2", "nightly price": "35"},
            {"bedrooms": "2", "capacity": "4", "nightly price": "35"},
            {"bedrooms": "3", "capacity": "7", "nightly price": "62"},
        ]

    def test_the_line_repeats_once_per_type(self):
        body, _ = render_template(self.BODY, {}, per_type=self.types())
        self.assertEqual(body.count("- [ ] Banesa"), 3)

    def test_each_repeat_carries_its_own_values(self):
        body, _ = render_template(self.BODY, {}, per_type=self.types())
        self.assertIn("Banesa me 1 dhoma, 2 persona, 35€", body)
        self.assertIn("Banesa me 3 dhoma, 7 persona, 62€", body)

    def test_surrounding_lines_are_not_repeated(self):
        body, _ = render_template(self.BODY, {}, per_type=self.types())
        self.assertEqual(body.count("Kemi te lire:"), 1)
        self.assertEqual(body.count("Faleminderit."), 1)

    def test_one_type_gives_one_line(self):
        body, _ = render_template(self.BODY, {}, per_type=self.types()[:1])
        self.assertEqual(body.count("- [ ] Banesa"), 1)

    def test_a_line_without_per_apartment_placeholders_never_repeats(self):
        body, _ = render_template("Nga (check-in).", {"check-in": "20.09.2026"}, per_type=self.types())
        self.assertEqual(body.count("Nga 20.09.2026."), 1)

    def test_stay_placeholders_still_resolve_inside_a_repeating_line(self):
        body, _ = render_template(
            "- (nights) nate × (nightly price)€",
            {"nights": "7"},
            per_type=[{"nightly price": "35"}, {"nightly price": "62"}],
        )
        self.assertIn("- 7 nate × 35€", body)
        self.assertIn("- 7 nate × 62€", body)


class TheOperatorsTemplateTests(TestCase):
    """The real Albanian body, end to end."""

    BODY = (
        "Faleminderit per kerkesen e rezervimit. Per datat qe keni kerkuar, nga "
        "(check-in) deri me (check-out) (check-out), rezervimi juaj perfshine "
        "(nights) nate.\n"
        "- [ ] Banesa me (bedrooms) dhoma gjumi ka kapacitet deri ne (capacity) "
        "persona dhe cmimi eshte (nightly price)€ per nate, pra (nights) nate × "
        "(nightly price)€ = (subtotal)€[ − (discount)€ zbritje] = (total price)€ "
        "cmimi total i qendrimit."
    )

    def test_it_renders_with_a_discount(self):
        body, unresolved = render_template(
            self.BODY,
            {"check-in": "10.08.2026", "check-out": "17.08.2026", "nights": "7"},
            per_type=[{
                "bedrooms": "2", "capacity": "4", "nightly price": "35",
                "subtotal": "245", "discount": "36.75", "total price": "208.25",
            }],
        )
        self.assertIn("nga 10.08.2026 deri me 17.08.2026", body)
        self.assertIn("7 nate × 35€ = 245€ − 36.75€ zbritje = 208.25€", body)
        self.assertEqual(unresolved, [])

    def test_a_short_stay_loses_the_discount_clause_entirely(self):
        body, unresolved = render_template(
            self.BODY,
            {"check-in": "10.08.2026", "check-out": "13.08.2026", "nights": "3"},
            per_type=[{
                "bedrooms": "2", "capacity": "4", "nightly price": "35",
                "subtotal": "105", "total price": "105",
            }],
        )
        self.assertIn("3 nate × 35€ = 105€ = 105€", body)
        self.assertNotIn("zbritje", body)
        self.assertEqual(unresolved, [])


class ScenarioDetectionTests(TestCase):
    """Which of the four situations the search landed in.

    The page supplies the facts it already computed; the backend decides.
    Priority: available -> split_stay -> alternative_dates -> no_availability.
    """

    def test_anything_free_means_available(self):
        self.assertEqual(
            detect_scenario(free_types=[{"bedrooms": "2"}], split_covers=False, next_free=None),
            "available",
        )

    def test_available_outranks_a_split_that_also_exists(self):
        """Never propose moving a guest when one apartment covers the stay."""
        self.assertEqual(
            detect_scenario(free_types=[{"bedrooms": "2"}], split_covers=True, next_free="2026-09-01"),
            "available",
        )

    def test_nothing_free_but_a_split_covers_the_dates(self):
        self.assertEqual(
            detect_scenario(free_types=[], split_covers=True, next_free="2026-09-01"),
            "split_stay",
        )

    def test_a_split_outranks_moving_the_guests_dates(self):
        """Keeping their dates is a smaller ask than changing them."""
        self.assertEqual(
            detect_scenario(free_types=[], split_covers=True, next_free="2026-09-01"),
            "split_stay",
        )

    def test_no_split_but_a_later_window_exists(self):
        self.assertEqual(
            detect_scenario(free_types=[], split_covers=False, next_free="2026-09-01"),
            "alternative_dates",
        )

    def test_nothing_at_all_within_the_horizon(self):
        self.assertEqual(
            detect_scenario(free_types=[], split_covers=False, next_free=None),
            "no_availability",
        )

    def test_an_empty_next_free_string_counts_as_nothing(self):
        self.assertEqual(
            detect_scenario(free_types=[], split_covers=False, next_free=""),
            "no_availability",
        )

    def test_missing_context_falls_back_to_no_availability(self):
        """Stale or absent context must not invent an answer for a guest."""
        self.assertEqual(detect_scenario(None, None, None), "no_availability")
