"""The template and draft endpoints."""

import json

from django.test import Client, TestCase

from .models import MessageTemplate
from .tests import day, make_admin, make_property


class TemplateEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_the_four_seeded_templates_are_listed(self):
        rows = self.client.get("/api/message-templates/").json()["messageTemplates"]
        self.assertEqual(
            sorted(r["scenario"] for r in rows),
            ["alternative_dates", "available", "no_availability", "split_stay"],
        )

    def test_each_template_ships_in_both_languages(self):
        rows = self.client.get("/api/message-templates/").json()["messageTemplates"]
        for row in rows:
            self.assertTrue(row["bodySq"].strip(), row["scenario"])
            self.assertTrue(row["bodyEn"].strip(), row["scenario"])

    def test_a_template_can_be_reworded(self):
        response = self.client.patch(
            "/api/message-templates/available/",
            data=json.dumps({"bodySq": "Pershendetje (nights)."}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            MessageTemplate.objects.get(scenario="available").body_sq,
            "Pershendetje (nights).",
        )

    def test_rewording_one_language_leaves_the_other_alone(self):
        before = MessageTemplate.objects.get(scenario="available").body_en
        self.client.patch(
            "/api/message-templates/available/",
            data=json.dumps({"bodySq": "changed"}),
            content_type="application/json",
        )
        self.assertEqual(MessageTemplate.objects.get(scenario="available").body_en, before)

    def test_an_unknown_scenario_is_not_found(self):
        response = self.client.patch(
            "/api/message-templates/nonsense/",
            data=json.dumps({"bodySq": "x"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)


class DraftEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property(name="Apartment A", bedrooms=2, max_guests=4)

    def draft(self, **overrides):
        body = {
            "checkIn": day(30).isoformat(),
            "checkOut": day(37).isoformat(),
            "guests": 2,
            "language": "sq",
            "freeTypes": [2],
            "splitCovers": False,
            "nextFree": "",
        }
        body.update(overrides)
        return self.client.post(
            "/api/message-drafts/", data=json.dumps(body), content_type="application/json"
        )

    def test_a_free_apartment_renders_the_available_template(self):
        data = self.draft().json()
        self.assertEqual(data["scenario"], "available")
        self.assertEqual(data["detected"], "available")
        self.assertFalse(data["empty"])

    def test_the_draft_carries_the_real_dates_and_price(self):
        body = self.draft().json()["body"]
        self.assertIn("7 nate", body)
        # 7 nights at 50 = 350, less the seeded 15% tier = 297.50.
        self.assertIn("297.5", body)

    def test_nothing_free_and_no_split_offers_other_dates(self):
        data = self.draft(freeTypes=[], nextFree=day(60).isoformat()).json()
        self.assertEqual(data["detected"], "alternative_dates")

    def test_a_split_outranks_alternative_dates(self):
        data = self.draft(freeTypes=[], splitCovers=True, nextFree=day(60).isoformat()).json()
        self.assertEqual(data["detected"], "split_stay")

    def test_nothing_at_all_is_no_availability(self):
        data = self.draft(freeTypes=[], nextFree="").json()
        self.assertEqual(data["detected"], "no_availability")

    def test_staff_may_override_the_detected_scenario(self):
        data = self.draft(scenario="no_availability").json()
        self.assertEqual(data["detected"], "available")
        self.assertEqual(data["scenario"], "no_availability")

    def test_english_renders_english_dates(self):
        body = self.draft(language="en").json()["body"]
        self.assertNotIn("Pershendetje", body)
        self.assertIn("Hello", body)

    def test_an_empty_template_is_reported_rather_than_sent_blank(self):
        MessageTemplate.objects.filter(scenario="available").update(body_sq="")
        data = self.draft().json()
        self.assertTrue(data["empty"])
        self.assertEqual(data["body"], "")

    def test_the_intro_names_every_free_type_in_one_sentence(self):
        """`(bedrooms)` repeats its line per type — an intro must not. The
        list placeholder is stay-wide, so the sentence is written once."""
        make_property(name="Studio", bedrooms=1, max_guests=2)
        MessageTemplate.objects.filter(scenario="available").update(
            body_sq="Kemi te lire banese me (bedrooms list) dhoma gjumi."
        )
        body = self.draft(freeTypes=[1, 2]).json()["body"]
        self.assertEqual(body, "Kemi te lire banese me 1 dhe 2 dhoma gjumi.")

    def test_three_types_read_as_a_list(self):
        make_property(name="Studio", bedrooms=1, max_guests=2)
        make_property(name="House", bedrooms=3, max_guests=7)
        MessageTemplate.objects.filter(scenario="available").update(
            body_sq="me (bedrooms list) dhoma"
        )
        self.assertEqual(
            self.draft(freeTypes=[1, 2, 3]).json()["body"], "me 1, 2 dhe 3 dhoma"
        )

    def test_one_type_needs_no_conjunction(self):
        MessageTemplate.objects.filter(scenario="available").update(
            body_sq="me (bedrooms list) dhoma"
        )
        self.assertEqual(self.draft(freeTypes=[2]).json()["body"], "me 2 dhoma")

    def test_english_joins_with_and(self):
        make_property(name="Studio", bedrooms=1, max_guests=2)
        MessageTemplate.objects.filter(scenario="available").update(
            body_en="with (bedrooms list) bedrooms"
        )
        self.assertEqual(
            self.draft(freeTypes=[1, 2], language="en").json()["body"],
            "with 1 and 2 bedrooms",
        )

    def test_the_change_date_reaches_the_draft(self):
        """A split stay has to say when the guest moves, not just that they do."""
        MessageTemplate.objects.filter(scenario="split_stay").update(
            body_sq="Nderrimi behet me (change date)."
        )
        body = self.draft(
            freeTypes=[], splitCovers=True, changeDate=day(33).isoformat()
        ).json()["body"]
        self.assertIn(f"{day(33).day:02d}.{day(33).month:02d}.{day(33).year}", body)

    def test_a_split_stay_prices_the_bullet_from_the_plan(self):
        """Nothing is free for the whole window, so freeTypes is empty — the
        bullet must still fill, priced from the apartments in the plan."""
        MessageTemplate.objects.filter(scenario="split_stay").update(
            body_sq="- Banesa me (bedrooms) dhoma, (nightly price)€, gjithsej (total price)€"
        )
        body = self.draft(
            freeTypes=[], splitCovers=True, splitTypes=[2],
            changeDate=[day(33).isoformat()],
        ).json()["body"]
        self.assertNotIn("(bedrooms)", body)
        self.assertNotIn("(nightly price)", body)
        self.assertIn("Banesa me 2 dhoma", body)

    def test_a_mixed_split_is_priced_at_the_cheapest_type(self):
        """A guest moving from a 1-bed to a 2-bed is charged the 1-bed rate —
        the upgrade is free rather than something to explain."""
        make_property(name="Studio", bedrooms=1, max_guests=2)
        MessageTemplate.objects.filter(scenario="split_stay").update(
            body_sq="- Banesa me (bedrooms) dhoma, (nightly price)€"
        )
        body = self.draft(
            freeTypes=[], splitCovers=True, splitTypes=[2, 1],
            changeDate=[day(33).isoformat()],
        ).json()["body"]
        self.assertIn("Banesa me 1 dhoma", body)
        self.assertNotIn("Banesa me 2 dhoma", body)

    def test_a_mixed_split_quotes_one_line_not_one_per_type(self):
        make_property(name="Studio", bedrooms=1, max_guests=2)
        MessageTemplate.objects.filter(scenario="split_stay").update(
            body_sq="- Banesa me (bedrooms) dhoma"
        )
        body = self.draft(
            freeTypes=[], splitCovers=True, splitTypes=[1, 2],
            changeDate=[day(33).isoformat()],
        ).json()["body"]
        self.assertEqual(body.count("- Banesa"), 1)

    def test_free_types_still_win_when_something_is_free(self):
        """splitTypes must not override a genuine availability result."""
        MessageTemplate.objects.filter(scenario="available").update(
            body_sq="- Banesa me (bedrooms) dhoma"
        )
        body = self.draft(freeTypes=[2], splitTypes=[1]).json()["body"]
        self.assertIn("Banesa me 2 dhoma", body)

    def test_two_change_dates_join_with_the_albanian_conjunction(self):
        """"22.08.2026 dhe 24.08.2026", not a bare comma list."""
        MessageTemplate.objects.filter(scenario="split_stay").update(
            body_sq="Nderrimi behet me (change date)."
        )
        body = self.draft(
            freeTypes=[],
            splitCovers=True,
            changeDate=[day(31).isoformat(), day(33).isoformat()],
        ).json()["body"]
        self.assertEqual(
            body,
            f"Nderrimi behet me {day(31).day:02d}.{day(31).month:02d}.{day(31).year} dhe "
            f"{day(33).day:02d}.{day(33).month:02d}.{day(33).year}.",
        )

    def test_three_change_dates_use_commas_then_the_conjunction(self):
        MessageTemplate.objects.filter(scenario="split_stay").update(body_sq="me (change date)")
        body = self.draft(
            freeTypes=[],
            splitCovers=True,
            changeDate=[day(31).isoformat(), day(33).isoformat(), day(35).isoformat()],
        ).json()["body"]
        self.assertIn(", ", body)
        self.assertIn(" dhe ", body)

    def test_english_change_dates_join_with_and(self):
        MessageTemplate.objects.filter(scenario="split_stay").update(body_en="on (change date)")
        body = self.draft(
            freeTypes=[],
            splitCovers=True,
            language="en",
            changeDate=[day(31).isoformat(), day(33).isoformat()],
        ).json()["body"]
        self.assertIn(" and ", body)

    def test_several_changes_are_all_named(self):
        MessageTemplate.objects.filter(scenario="split_stay").update(
            body_sq="Nderrimi behet me (change date)."
        )
        body = self.draft(
            freeTypes=[],
            splitCovers=True,
            changeDate=[day(33).isoformat(), day(35).isoformat()],
        ).json()["body"]
        self.assertIn(f"{day(33).day:02d}.", body)
        self.assertIn(f"{day(35).day:02d}.", body)

    def test_no_change_date_leaves_the_placeholder_visible(self):
        MessageTemplate.objects.filter(scenario="split_stay").update(
            body_sq="Nderrimi behet me (change date)."
        )
        data = self.draft(freeTypes=[], splitCovers=True).json()
        self.assertIn("(change date)", data["body"])
        self.assertIn("change date", data["unresolved"])

    def test_a_reversed_range_is_refused(self):
        response = self.draft(checkIn=day(37).isoformat(), checkOut=day(30).isoformat())
        self.assertEqual(response.status_code, 400)


class MessagingIsStaffOnlyTests(TestCase):
    def test_every_endpoint_refuses_an_anonymous_caller(self):
        anon = Client()
        self.assertIn(anon.get("/api/message-templates/").status_code, (401, 403))
        self.assertIn(
            anon.patch(
                "/api/message-templates/available/", data="{}", content_type="application/json"
            ).status_code,
            (401, 403),
        )
        self.assertIn(
            anon.post(
                "/api/message-drafts/", data="{}", content_type="application/json"
            ).status_code,
            (401, 403),
        )
