"""Engine tests. Every number here is hand-computed in the assertion comment,
so a failure tells you which rule interaction broke, not just that a total moved."""

from decimal import Decimal

from django.test import TestCase

from .models import PricingGroup, PricingRule
from .tests import day, make_property
from .views._pricing_engine import APPLIED, LOCKED_OUT, OVERRIDDEN, evaluate_stay


def make_rule(group_name, **kwargs):
    group = PricingGroup.objects.get(platform="airstay", name=group_name)
    defaults = {"scope": "all", "enabled": True, "application": "whole_stay"}
    defaults.update(kwargs)
    return PricingRule.objects.create(group=group, **defaults)


def report_for(result, rule):
    return next(r for r in result["reports"] if r["id"] == str(rule.pk))


class NightlyPassTests(TestCase):
    def setUp(self):
        self.prop = make_property(base_price_eur=Decimal("45.00"))

    def test_no_rules_leaves_every_night_at_base(self):
        result = evaluate_stay(self.prop, day(30), day(33))
        self.assertEqual([n["rate"] for n in result["nightly"]], [Decimal("45.00")] * 3)
        self.assertEqual(result["subtotal"], Decimal("135.00"))

    def test_seasonal_rule_prices_only_the_nights_it_covers(self):
        make_rule(
            "Seasonal Pricing",
            rule_type="seasonal",
            application="per_night",
            start_date=day(31),
            end_date=day(31),
            adjustment_type="fixed_price",
            adjustment_value=Decimal("80.00"),
        )
        result = evaluate_stay(self.prop, day(30), day(33))
        # night 30 base, night 31 fixed, night 32 base
        self.assertEqual(
            [n["rate"] for n in result["nightly"]],
            [Decimal("45.00"), Decimal("80.00"), Decimal("45.00")],
        )

    def test_stack_group_compounds_in_sort_order(self):
        make_rule(
            "Seasonal Pricing", rule_type="seasonal", application="per_night",
            sort_order=0, start_date=day(30), end_date=day(32),
            adjustment_type="fixed_price", adjustment_value=Decimal("56.00"),
        )
        make_rule(
            "Seasonal Pricing", rule_type="seasonal", application="per_night",
            sort_order=1, start_date=day(30), end_date=day(32),
            adjustment_type="pct_increase", adjustment_value=Decimal("50.00"),
        )
        result = evaluate_stay(self.prop, day(30), day(31))
        self.assertEqual(result["nightly"][0]["rate"], Decimal("84.00"))  # 56 × 1.5

    def test_a_final_rule_does_not_block_later_rules_in_its_own_group(self):
        make_rule(
            "Seasonal Pricing", rule_type="seasonal", application="per_night",
            sort_order=0, start_date=day(30), end_date=day(32), is_final=True,
            adjustment_type="fixed_price", adjustment_value=Decimal("56.00"),
        )
        make_rule(
            "Seasonal Pricing", rule_type="seasonal", application="per_night",
            sort_order=1, start_date=day(30), end_date=day(32),
            adjustment_type="pct_increase", adjustment_value=Decimal("50.00"),
        )
        result = evaluate_stay(self.prop, day(30), day(31))
        # Locking happens at the group boundary, so +50% still lands.
        self.assertEqual(result["nightly"][0]["rate"], Decimal("84.00"))
        self.assertTrue(result["nightly"][0]["locked"])


class ExclusiveGroupTests(TestCase):
    """Exclusive picks the FIRST eligible rule, so sort_order decides.

    These build their own group rather than borrowing a seeded one: the
    seeded ladder is now a "best" group, which deliberately ignores order.
    See tests_group_behaviour for that.
    """

    def setUp(self):
        self.prop = make_property(base_price_eur=Decimal("50.00"))
        PricingRule.objects.filter(rule_type="long_stay").delete()
        PricingGroup.objects.create(
            name="Test Exclusive", sort_order=60, behaviour=PricingGroup.Behaviour.EXCLUSIVE
        )

    def test_lowest_sort_order_wins_even_when_another_rule_discounts_more(self):
        winner = make_rule(
            "Test Exclusive", rule_type="long_stay", sort_order=1, min_nights=5,
            adjustment_type="pct_decrease", adjustment_value=Decimal("10.00"),
        )
        loser = make_rule(
            "Test Exclusive", rule_type="long_stay", sort_order=9, min_nights=5,
            adjustment_type="pct_decrease", adjustment_value=Decimal("40.00"),
        )
        result = evaluate_stay(self.prop, day(30), day(37))  # 7 nights × 50 = 350
        self.assertEqual(result["total"], Decimal("315.00"))  # 350 − 10%
        self.assertEqual(report_for(result, winner)["status"], APPLIED)
        self.assertEqual(report_for(result, loser)["status"], OVERRIDDEN)

    def test_a_sort_order_tie_breaks_by_age(self):
        # Two rules at the same sort_order must still resolve deterministically,
        # or the winner flips between runs.
        older = make_rule(
            "Test Exclusive", rule_type="long_stay", sort_order=0, min_nights=5,
            adjustment_type="pct_decrease", adjustment_value=Decimal("10.00"),
        )
        newer = make_rule(
            "Test Exclusive", rule_type="long_stay", sort_order=0, min_nights=5,
            adjustment_type="pct_decrease", adjustment_value=Decimal("40.00"),
        )
        # created_at is auto_now_add, so set it explicitly: two rules created
        # back-to-back can share a timestamp to the microsecond, which would
        # leave the age tiebreak nothing to break on.
        from datetime import timedelta

        from django.utils import timezone

        now = timezone.now()
        PricingRule.objects.filter(pk=older.pk).update(created_at=now - timedelta(minutes=1))
        PricingRule.objects.filter(pk=newer.pk).update(created_at=now)
        older.refresh_from_db()
        newer.refresh_from_db()
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(report_for(result, older)["status"], APPLIED)
        self.assertEqual(report_for(result, newer)["status"], OVERRIDDEN)
        self.assertEqual(result["total"], Decimal("315.00"))  # the older 10%

    def test_an_ineligible_first_rule_yields_to_the_next_one(self):
        make_rule(
            "Test Exclusive", rule_type="long_stay", sort_order=0, min_nights=28,
            adjustment_type="pct_decrease", adjustment_value=Decimal("50.00"),
        )
        make_rule(
            "Test Exclusive", rule_type="long_stay", sort_order=1, min_nights=7,
            adjustment_type="pct_decrease", adjustment_value=Decimal("15.00"),
        )
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(result["total"], Decimal("297.50"))  # 350 − 15%


class LockTests(TestCase):
    def test_locked_nights_are_immune_to_every_later_discount(self):
        prop = make_property(base_price_eur=Decimal("45.00"))
        make_rule(
            "Seasonal Pricing", rule_type="seasonal", application="per_night",
            start_date=day(32), end_date=day(36), is_final=True,
            adjustment_type="fixed_price", adjustment_value=Decimal("56.00"),
        )
        promo = make_rule(
            "Promotions", rule_type="promo", code="TEN",
            adjustment_type="pct_decrease", adjustment_value=Decimal("10.00"),
        )
        result = evaluate_stay(prop, day(30), day(37), promo_rule=promo)
        # 2 unlocked × 45 = 90 discountable, 5 locked × 56 = 280 protected.
        self.assertEqual(result["protected"], Decimal("280.00"))
        # Weekly tier 15% of 90 = 13.50 → 76.50, then promo 10% of 76.50 = 7.65.
        self.assertEqual(result["total"], Decimal("348.85"))

    def test_the_worked_example_from_the_spec(self):
        prop = make_property(base_price_eur=Decimal("45.00"))
        make_rule(
            "Seasonal Pricing", rule_type="seasonal", application="per_night",
            start_date=day(32), end_date=day(36), is_final=True,
            adjustment_type="fixed_price", adjustment_value=Decimal("56.00"),
        )
        result = evaluate_stay(prop, day(30), day(37))
        self.assertEqual(result["subtotal"], Decimal("370.00"))
        self.assertEqual(result["total"], Decimal("356.50"))

    def test_a_later_groups_per_night_rule_reports_itself_locked_out(self):
        # LOCKED_OUT is a pass-1 status: it means a per-night rule in a LATER
        # group found the night already locked. A whole-stay rule can never be
        # locked out — it is simply left with nothing to discount.
        prop = make_property(base_price_eur=Decimal("45.00"))
        make_rule(
            "Seasonal Pricing", rule_type="seasonal", application="per_night",
            start_date=day(30), end_date=day(34), is_final=True,
            adjustment_type="fixed_price", adjustment_value=Decimal("56.00"),
        )
        late = make_rule(
            "Promotions", rule_type="manual", application="per_night",
            start_date=day(30), end_date=day(34),
            adjustment_type="pct_decrease", adjustment_value=Decimal("25.00"),
        )
        result = evaluate_stay(prop, day(30), day(35), manual_rule_ids=[str(late.pk)])
        self.assertEqual(report_for(result, late)["status"], LOCKED_OUT)
        self.assertEqual(result["total"], Decimal("280.00"))  # 5 × 56, untouched

    def test_whole_stay_rules_have_nothing_to_discount_when_all_nights_lock(self):
        prop = make_property(base_price_eur=Decimal("45.00"))
        make_rule(
            "Seasonal Pricing", rule_type="seasonal", application="per_night",
            start_date=day(30), end_date=day(34), is_final=True,
            adjustment_type="fixed_price", adjustment_value=Decimal("56.00"),
        )
        tier = PricingRule.objects.get(rule_type="long_stay", min_nights=5, scope="all")
        result = evaluate_stay(prop, day(30), day(35))  # 5 nights, all locked
        self.assertEqual(result["discountable"], Decimal("0.00"))
        self.assertEqual(result["total"], Decimal("280.00"))
        self.assertEqual(report_for(result, tier)["amount"], Decimal("0"))
        self.assertIn("locked", report_for(result, tier)["reason"])


class EligibilityTests(TestCase):
    def setUp(self):
        self.prop = make_property(base_price_eur=Decimal("50.00"))

    def test_last_minute_applies_only_inside_its_window(self):
        make_rule(
            "Booking Discounts", rule_type="last_minute", days_before_checkin=3,
            adjustment_type="pct_decrease", adjustment_value=Decimal("10.00"),
        )
        near = evaluate_stay(self.prop, day(2), day(4))
        self.assertEqual(near["total"], Decimal("90.00"))
        far = evaluate_stay(self.prop, day(30), day(32))
        self.assertEqual(far["total"], Decimal("100.00"))

    def test_non_refundable_applies_only_when_requested(self):
        off = evaluate_stay(self.prop, day(30), day(32))
        on = evaluate_stay(self.prop, day(30), day(32), is_non_refundable=True)
        self.assertEqual(off["total"], Decimal("100.00"))
        self.assertEqual(on["total"], Decimal("90.00"))  # seeded 10%

    def test_promo_respects_min_subtotal_and_usage_limit(self):
        promo = make_rule(
            "Promotions", rule_type="promo", code="BIG",
            min_subtotal_eur=Decimal("200.00"),
            adjustment_type="pct_decrease", adjustment_value=Decimal("10.00"),
        )
        small = evaluate_stay(self.prop, day(30), day(32), promo_rule=promo)  # 100
        self.assertEqual(small["total"], Decimal("100.00"))
        self.assertIn("200", report_for(small, promo)["reason"])

        promo.usage_limit = 1
        promo.usage_count = 1
        promo.save()
        big = evaluate_stay(self.prop, day(30), day(35), promo_rule=promo)
        self.assertEqual(report_for(big, promo)["amount"], Decimal("0"))

    def test_manual_rules_apply_only_when_selected(self):
        manual = make_rule(
            "Promotions", rule_type="manual", name="Goodwill 20",
            adjustment_type="fixed_decrease", adjustment_value=Decimal("20.00"),
        )
        without = evaluate_stay(self.prop, day(30), day(32))
        self.assertEqual(without["total"], Decimal("100.00"))
        with_it = evaluate_stay(self.prop, day(30), day(32), manual_rule_ids=[str(manual.pk)])
        self.assertEqual(with_it["total"], Decimal("80.00"))

    def test_scope_limits_a_rule_to_its_property(self):
        other = make_property(name="Other", base_price_eur=Decimal("50.00"))
        make_rule(
            "Booking Discounts", rule_type="last_minute", scope="property",
            property=other, days_before_checkin=60,
            adjustment_type="pct_decrease", adjustment_value=Decimal("50.00"),
        )
        result = evaluate_stay(self.prop, day(30), day(32))
        self.assertEqual(result["total"], Decimal("100.00"))


class GroupOrderingTests(TestCase):
    """PricingGroup.sort_order has no unique constraint and the create
    endpoint defaults it to 0, so two groups can tie. _load_rules() used to
    order by (group__sort_order, sort_order, ...) with no group tiebreak, and
    evaluate_stay built its group list by adjacency — so a rule from an
    unrelated group landing between two same-group rules (by sort_order)
    split that group into fragments, each treated as an independent Exclusive
    group with its own winner."""

    def test_shared_group_sort_order_does_not_fragment_an_exclusive_group(self):
        prop = make_property(base_price_eur=Decimal("100.00"))
        # Same sort_order (0) as each other AND as every seeded group.
        interloper = PricingGroup.objects.create(
            name="Interloper", sort_order=0, behaviour="stack",
        )
        split_risk = PricingGroup.objects.create(
            name="Split Risk", sort_order=0, behaviour="exclusive",
        )

        # Always-eligible (no min_nights) long_stay rules so eligibility
        # never confounds the ordering assertion.
        winner = PricingRule.objects.create(
            group=split_risk, rule_type="long_stay", application="whole_stay",
            sort_order=0, scope="all", enabled=True,
            adjustment_type="pct_decrease", adjustment_value=Decimal("10.00"),
        )
        # This rule's own sort_order (1) sits BETWEEN the exclusive group's
        # two rules (0 and 2) — exactly the interleave that used to fragment
        # "Split Risk" into two single-rule groups.
        PricingRule.objects.create(
            group=interloper, rule_type="manual", application="whole_stay",
            sort_order=1, scope="all", enabled=True,
            adjustment_type="fixed_decrease", adjustment_value=Decimal("1.00"),
        )
        loser = PricingRule.objects.create(
            group=split_risk, rule_type="long_stay", application="whole_stay",
            sort_order=2, scope="all", enabled=True,
            adjustment_type="pct_decrease", adjustment_value=Decimal("40.00"),
        )

        result = evaluate_stay(prop, day(30), day(32))  # 2 nights x 100 = 200
        self.assertEqual(report_for(result, winner)["status"], APPLIED)
        self.assertEqual(report_for(result, loser)["status"], OVERRIDDEN)
        # Fragmented, "loser" would win its own one-rule fragment on top of
        # "winner" winning its fragment: 200 * 0.9 * 0.6 = 108.00 instead.
        self.assertEqual(result["total"], Decimal("180.00"))  # 200 - 10%, one winner only


class ClampTests(TestCase):
    def test_a_discount_larger_than_the_stay_floors_at_zero(self):
        prop = make_property(base_price_eur=Decimal("50.00"))
        manual = make_rule(
            "Promotions", rule_type="manual",
            adjustment_type="fixed_decrease", adjustment_value=Decimal("999.00"),
        )
        result = evaluate_stay(prop, day(30), day(32), manual_rule_ids=[str(manual.pk)])
        self.assertEqual(result["total"], Decimal("0.00"))
