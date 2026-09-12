"""Every automated guest message, held to the rules the engine actually has.

`render_template` resolves **a line at a time**. An optional `[segment]` that
opens on one line and closes on another therefore never matches: the brackets
are printed literally, and the placeholder inside is reported unresolved.

That is not a theoretical worry. `booking_rejected` shipped with exactly that
shape in both languages - `.[` on one line, `(reason)]` two lines later - and
because `views/_guest_mail.py` refuses to send a message with an unresolved
placeholder, declining a booking *without typing a reason* silently sent the
guest nothing at all. With a reason, it sent them square brackets.

These tests are a guard over the seeded content, not over the engine. The
engine is right; the templates were wrong.
"""

import re

from django.test import TestCase

from .models import ContractTemplate, MessageTemplate
from .views._drafts import render_template

PLACEHOLDER = re.compile(r"\(([^)]*)\)")


def bodies():
    """Every stored template body, labelled."""
    for row in MessageTemplate.objects.all():
        yield f"MessageTemplate[{row.scenario}]", "sq", row.body_sq
        yield f"MessageTemplate[{row.scenario}]", "en", row.body_en
    for row in ContractTemplate.objects.all():
        yield f"ContractTemplate[{row.kind}]", "sq", row.body_sq
        yield f"ContractTemplate[{row.kind}]", "en", row.body_en


class OptionalSegmentsResolveTests(TestCase):
    def test_no_template_opens_a_segment_it_does_not_close_on_the_same_line(self):
        broken = []
        for label, language, body in bodies():
            for number, line in enumerate((body or "").splitlines(), 1):
                if line.count("[") != line.count("]"):
                    broken.append(f"{label} [{language}] line {number}: {line.strip()!r}")
        self.assertEqual(
            broken,
            [],
            "An optional [segment] must open and close on one line — "
            "render_template works line by line:\n" + "\n".join(broken),
        )

    def test_no_placeholder_name_contains_a_newline(self):
        """Same rule, same reason: a `(name)` split over two lines is text.

        Counting brackets per line would be the obvious check and is wrong -
        the contract clause lists are numbered `a)`, `b)`, `c)`, so an
        unbalanced parenthesis is ordinary prose here. What actually breaks is
        a placeholder whose *name* spans lines, so that is what is tested.
        """
        for label, language, body in bodies():
            for name in PLACEHOLDER.findall(body or ""):
                self.assertNotIn("\n", name, f"{label} [{language}]: ({name!r})")


class RejectionEmailTests(TestCase):
    """The message that was not being sent."""

    def setUp(self):
        self.template = MessageTemplate.objects.get(
            scenario=MessageTemplate.Scenario.BOOKING_REJECTED
        )
        self.values = {
            "guest name": "Ana Berisha",
            "check-in": "3 August 2026",
            "check-out": "7 August 2026",
        }

    def test_a_decline_with_no_reason_resolves_completely(self):
        """The common case: staff decline without typing an explanation. It
        must be sendable — `_guest_mail` refuses anything with a placeholder
        left in it, so an unresolved (reason) means the guest hears nothing."""
        for language, body in (("en", self.template.body_en), ("sq", self.template.body_sq)):
            with self.subTest(language=language):
                _, unresolved = render_template(body, {**self.values, "reason": ""})
                self.assertEqual(unresolved, [])

    def test_a_decline_with_no_reason_prints_no_stray_brackets(self):
        for language, body in (("en", self.template.body_en), ("sq", self.template.body_sq)):
            with self.subTest(language=language):
                rendered, _ = render_template(body, {**self.values, "reason": ""})
                self.assertNotIn("[", rendered)
                self.assertNotIn("]", rendered)

    def test_a_decline_with_a_reason_includes_it_and_no_brackets(self):
        for language, body in (("en", self.template.body_en), ("sq", self.template.body_sq)):
            with self.subTest(language=language):
                rendered, unresolved = render_template(
                    body, {**self.values, "reason": "The apartment is being redecorated."}
                )
                self.assertIn("redecorated", rendered)
                self.assertNotIn("[", rendered)
                self.assertNotIn("]", rendered)
                self.assertEqual(unresolved, [])

    def test_the_guest_is_still_greeted_by_name(self):
        rendered, _ = render_template(self.template.body_en, {**self.values, "reason": ""})
        self.assertIn("Ana Berisha", rendered)


class ApprovalEmailTests(TestCase):
    """The other message that is actually emailed."""

    def test_an_approval_resolves_completely_from_a_booking(self):
        template = MessageTemplate.objects.get(
            scenario=MessageTemplate.Scenario.BOOKING_APPROVED
        )
        values = {
            "guest name": "Ana Berisha",
            "apartment": "Apartment #2",
            "check-in": "3 August 2026",
            "check-out": "7 August 2026",
            "nights": "4",
            "total price": "240",
        }
        for language, body in (("en", template.body_en), ("sq", template.body_sq)):
            with self.subTest(language=language):
                rendered, unresolved = render_template(body, values)
                self.assertEqual(unresolved, [])
                self.assertNotIn("[", rendered)


class EveryScenarioHasBothLanguagesTests(TestCase):
    """A blank body is a message nobody receives in that language."""

    def test_every_message_scenario_is_written_in_both_languages(self):
        missing = [
            f"{row.scenario} [{language}]"
            for row in MessageTemplate.objects.all()
            for language, body in (("sq", row.body_sq), ("en", row.body_en))
            if not (body or "").strip()
        ]
        self.assertEqual(missing, [])

    def test_every_contract_is_written_in_both_languages(self):
        missing = [
            f"{row.kind} [{language}]"
            for row in ContractTemplate.objects.all()
            for language, body in (("sq", row.body_sq), ("en", row.body_en))
            if not (body or "").strip()
        ]
        self.assertEqual(missing, [])

    def test_all_six_reply_scenarios_exist(self):
        """Four availability replies plus two booking outcomes. A scenario that
        is missing entirely renders as nothing at all."""
        self.assertEqual(
            sorted(MessageTemplate.objects.values_list("scenario", flat=True)),
            sorted(MessageTemplate.Scenario.values),
        )
