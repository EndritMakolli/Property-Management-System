# Unified Pricing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded price-adjustment chain with ordered `PricingGroup`s of `PricingRule`s evaluated by one configurable two-pass engine, folding promo codes, the non-refundable discount and the hidden long-stay tiers into that model and moving minimum-nights out of it.

**Architecture:** `PricingGroup` (ordered, Stack or Exclusive) contains `PricingRule`s (ordered within the group). A pure module `views/_pricing_engine.py` evaluates a stay in two passes — per-night rates group by group, with `is_final` locking a night at its group's boundary, then whole-stay adjustments over the unlocked nights only. `calculate_price` in `views/_pricing.py` stays the single public entry point and formats the engine's result into the existing breakdown dict, so every caller and every stored breakdown blob keeps working. Non-price constraints live in a separate `StayConstraint` model.

**Tech Stack:** Django 5.2, Postgres, React 19 + TypeScript, Vite, lucide-react icons.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-20-unified-pricing-engine-design.md`. Read it before Task 3.
- Backend tests: `cd backend && .\.venv\Scripts\python.exe manage.py test pms`
- Frontend checks: `cd frontend && npx tsc -b --force && npm run build`
- Use the venv interpreter `backend\.venv\Scripts\python.exe`. The system `python` has no Django installed.
- **Shell:** the commands in this plan are written for **PowerShell**, which is this machine's primary shell — that is where the `.\.venv\Scripts\python.exe` form works. They are fenced as ```bash only for syntax highlighting. If you run them through a POSIX shell instead, convert the interpreter path to `./.venv/Scripts/python.exe` and replace `&&` chains that PowerShell 5.1 cannot parse. Never substitute a bare `python`.
- **Ordering vocabulary:** the only ordering field is `sort_order`, ascending. The numerically smallest `sort_order` is evaluated first and wins in an Exclusive group. Ties break by `created_at`, oldest first. The word "priority" must not appear in code, API field names, or UI copy.
- **Lock rule:** a night locked by an `is_final` rule is excluded from all per-night rules in later groups and from all whole-stay adjustments. No exceptions, including promo codes. Locking happens at the **end of the rule's group**, so later rules in the same Stack group still modify the rate.
- All pricing goes through `calculate_price` in `views/_pricing.py`. Never add a second price calculation.
- Every new endpoint starts with `require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])` as its first lines. There is no default-deny.
- Backend returns camelCase JSON; money as `str(Decimal)`. Frontend types live in `frontend/src/types/domain.ts`.
- Money is `Decimal`, quantized with `CENTS = Decimal("0.01")` and `ROUND_HALF_UP`. Never use `float`.
- Breakdown keys that must never be renamed or change format: `base_nightly`, `effective_nightly`, `has_seasonal`, `subtotal`, `long_stay_pct`, `long_stay_amount`, `last_minute_pct`, `last_minute_amount`, `non_refundable_pct`, `non_refundable_amount`, `promo_amount`, `total`, `first_night_price`, `nights`, `min_nights_required`, `errors`. Absent percentages serialize as the string `"0"`; `nights` and `min_nights_required` are `int`; everything else money-shaped is `str(Decimal)`.
- Model registration is a three-layer explicit chain: define in `pms/model_defs/booking.py`, re-export in `pms/model_defs/__init__.py` (import block **and** `__all__`), re-export again in `pms/models.py` (import block **and** `__all__`).
- View registration: define in `pms/views/_booking_pms.py`, export in `pms/views/__init__.py` (import block **and** `__all__`), route in `pms/urls.py`.
- Next migration number is **0027**. Convention: `NNNN_snake_case_description.py`.
- Commit after every task. Never `git push` — the user pushes.

## File Structure

**Created:**
- `backend/pms/views/_pricing_engine.py` — pure evaluation: eligibility, the two passes, rule reports. No HTTP, no `calculate_price` formatting, no queries except one optional loader.
- `backend/pms/views/_pricing_rules_api.py` — CRUD + reorder for `PricingGroup`, `PricingRule`, `StayConstraint`. Kept out of `_booking_pms.py`, which is already 700+ lines.
- `backend/pms/migrations/0027_pricing_groups.py` — additive schema.
- `backend/pms/migrations/0028_seed_pricing_groups.py` — data migration.
- `backend/pms/migrations/0029_drop_promocode.py` — destructive cleanup.
- `backend/pms/tests_pricing_engine.py` — engine unit tests.
- `backend/pms/tests_pricing_api.py` — endpoint + migration-outcome tests.
- `frontend/src/components/pricing/GroupSection.tsx` — one group's header + rule list.
- `frontend/src/components/pricing/RuleRow.tsx` — one rule, view + inline edit.

**Modified:**
- `backend/pms/model_defs/booking.py` — `PricingGroup`, `StayConstraint`, extended `PricingRule`, `PromoCode` deleted.
- `backend/pms/views/_pricing.py` — `calculate_price` delegates to the engine; `_seasonal_nightly`, `_long_stay_discount_pct`, `_last_minute_discount_pct`, `_promo_discount`, `_DEFAULT_LONG_STAY_TIERS` all deleted; `_min_nights_required` reads `StayConstraint`; `resolve_promo_rule` added.
- `backend/pms/views/_booking_public.py` — four promo blocks collapse to `resolve_promo_rule`; usage counting removed from request creation.
- `backend/pms/views/_booking_pms.py` — promo views deleted; approval increments usage.
- `frontend/src/pages/PricingRulesPage.tsx` — rebuilt group-centric.
- `frontend/src/pages/AvailabilityPage.tsx` — quoted prices + prefill.
- `frontend/src/components/client/ApartmentDetailModal.tsx` — price explainer.
- `frontend/src/pages/ReportsPage.tsx`, `frontend/src/features/reports/InsightCharts.tsx`, `frontend/src/features/reports/insightCalculations.ts` — chart removal (Task 1).

---

### Task 1: Remove the two unused Reports charts

Carried from the superseded plan. Independent of everything else — do it first to shrink the surface.

**Files:**
- Modify: `frontend/src/features/reports/InsightCharts.tsx` (delete `StayLengthChart`, `LeadTimeChart`)
- Modify: `frontend/src/features/reports/insightCalculations.ts` (delete `stayLengthDistribution`, `leadTimeDistribution`)
- Modify: `frontend/src/pages/ReportsPage.tsx` (delete the two render blocks and the now-unused imports)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Pure deletion.

- [ ] **Step 1: Find every reference**

```bash
cd frontend && rg -n "StayLengthChart|LeadTimeChart|stayLengthDistribution|leadTimeDistribution" src/
```

Expected: definitions in `InsightCharts.tsx` and `insightCalculations.ts`, imports and two render blocks in `ReportsPage.tsx`. If any other file appears, stop and report it.

- [ ] **Step 2: Delete the two chart components**

In `InsightCharts.tsx`, delete the `StayLengthChart` and `LeadTimeChart` component functions and their exports. Delete any import (recharts pieces, types) that becomes unused as a result — TypeScript will flag them in step 5.

- [ ] **Step 3: Delete the two calculators**

In `insightCalculations.ts`, delete the `stayLengthDistribution` and `leadTimeDistribution` functions and their exports, plus any helper used only by them.

- [ ] **Step 4: Delete the render blocks**

In `ReportsPage.tsx`, delete the two `<StayLengthChart .../>` and `<LeadTimeChart .../>` blocks including their surrounding card/wrapper elements, and remove the two names from the import statements at the top.

- [ ] **Step 5: Verify the build is clean**

```bash
cd frontend && npx tsc -b --force && npm run build
```

Expected: PASS with no unused-import or missing-export errors. Then open Reports in the dev server and confirm the remaining charts still render and the page has no gap where the deleted cards were.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "Remove unused stay-length and booking-lead-time charts"
```

---

### Task 2: One general location instead of per-apartment labels

Carried from the superseded plan. The per-property `location_label`, `latitude` and `longitude` columns **stay** — the map privacy circle needs coordinates. They simply stop being shown to guests.

**Files:**
- Modify: `frontend/src/components/client/ApartmentDetailModal.tsx:106` (location line)
- Modify: `frontend/src/pages/client/MapPage.tsx:95` (location line)

**Interfaces:**
- Consumes: `BookingSiteSettingsRecord.buildingName` / `.buildingAddress`, already returned by `GET /api/booking/settings/` and typed in `domain.ts`.
- Produces: nothing.

- [ ] **Step 1: Confirm the settings values reach both screens**

```bash
cd frontend && rg -n "buildingName|buildingAddress|locationLabel|fetchBookingSettings" src/
```

Note which of the two screens already has the settings object in hand. The scout found `ApartmentDetailModal` does **not** fetch booking settings — it receives a `property` prop. Rather than adding a fetch inside a modal, pass the location down from whichever parent already loads settings for the public site (the same parent that supplies `property`), as an optional `generalLocation?: string` prop. If no ancestor loads settings either, use the existing public `fetchBookingSettings` call from that page-level component — never a new API client function, and never a fetch inside the modal itself.

- [ ] **Step 2: Swap both display sites**

Replace the per-property `locationLabel` render with the building location, preferring the name and falling back to the address:

```tsx
const generalLocation = settings?.buildingName || settings?.buildingAddress || ''
```

Render `generalLocation`; when it is empty, render nothing at all (no empty label row, no placeholder).

- [ ] **Step 3: Verify**

```bash
cd frontend && npx tsc -b --force && npm run build
```

Then in the dev server: the guest modal and the map popup both show the building location; with `buildingName` and `buildingAddress` both blank in Admin Panel → Company profile, neither screen shows an empty line.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "Show one general building location instead of per-apartment labels"
```

---

### Task 3: PricingGroup, StayConstraint, and the extended PricingRule

Additive only. Nothing reads the new fields yet, so the whole suite must still pass unchanged at the end of this task.

**Files:**
- Modify: `backend/pms/model_defs/booking.py`
- Modify: `backend/pms/model_defs/__init__.py`, `backend/pms/models.py` (import blocks + `__all__`)
- Create: `backend/pms/migrations/0027_pricing_groups.py` (generated)
- Create: `backend/pms/tests_pricing_api.py` (first test)

**Interfaces:**
- Produces:
  - `PricingGroup(name, sort_order, behaviour)` with `Behaviour.STACK = "stack"`, `Behaviour.EXCLUSIVE = "exclusive"`; `Meta.ordering = ["sort_order", "id"]`.
  - `PricingRule` gains `name`, `group` (FK, nullable **for now**), `sort_order`, `application` (`Application.PER_NIGHT = "per_night"`, `Application.WHOLE_STAY = "whole_stay"`), `is_final`, `code`, `usage_limit`, `usage_count`, `min_subtotal_eur`; `RuleType` gains `NON_REFUNDABLE = "non_refundable"`, `PROMO = "promo"`, `MANUAL = "manual"`; `Meta.ordering` becomes `["sort_order", "created_at"]`.
  - `StayConstraint(kind, value, scope, property, bedroom_group, start_date, end_date, enabled)` with `Kind.MIN_NIGHTS = "min_nights"`.
  - `BookingRequest.promo_rule` — temporary nullable FK to `PricingRule`, `on_delete=SET_NULL`.

- [ ] **Step 1: Write the failing test**

Create `backend/pms/tests_pricing_api.py`:

```python
"""Tests for the unified pricing model, its migrations, and its endpoints."""

from datetime import date, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import Client, TestCase

from .models import PricingGroup, PricingRule, StayConstraint
from .tests import day, make_admin, make_property


class PricingModelTests(TestCase):
    def test_group_orders_by_sort_order(self):
        # sort_order values well above the seeded groups (0-3), and the query
        # is filtered to just these two. Asserting on the first two rows of
        # PricingGroup.objects.all() would start failing in Task 4, when the
        # data migration seeds four groups of its own.
        PricingGroup.objects.create(name="Zebra", sort_order=91)
        PricingGroup.objects.create(name="Alpha", sort_order=90)
        self.assertEqual(
            [g.name for g in PricingGroup.objects.filter(sort_order__gte=90)],
            ["Alpha", "Zebra"],
        )

    def test_rule_code_is_unique_only_when_present(self):
        group = PricingGroup.objects.create(name="Promotions X", sort_order=9)
        PricingRule.objects.create(group=group, rule_type=PricingRule.RuleType.SEASONAL)
        PricingRule.objects.create(group=group, rule_type=PricingRule.RuleType.SEASONAL)
        PricingRule.objects.create(
            group=group, rule_type=PricingRule.RuleType.PROMO, code="SUMMER25"
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PricingRule.objects.create(
                    group=group, rule_type=PricingRule.RuleType.PROMO, code="SUMMER25"
                )

    def test_stay_constraint_holds_min_nights(self):
        prop = make_property()
        constraint = StayConstraint.objects.create(
            kind=StayConstraint.Kind.MIN_NIGHTS,
            value=3,
            scope=StayConstraint.Scope.PROPERTY,
            property=prop,
        )
        self.assertEqual(constraint.value, 3)
        self.assertTrue(constraint.enabled)
```

Two rules with `code=None` must coexist — that is what the conditional unique constraint buys, and a plain `unique=True` would fail this test.

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_api -v 2
```

Expected: FAIL — `ImportError: cannot import name 'PricingGroup'`.

- [ ] **Step 3: Write the models**

In `backend/pms/model_defs/booking.py`, add above `PricingRule`:

```python
class PricingGroup(TimeStampedModel):
    """An ordered bucket of pricing rules sharing one interaction behaviour."""

    class Behaviour(models.TextChoices):
        STACK = "stack", "Stack — every eligible rule applies, in order"
        EXCLUSIVE = "exclusive", "Exclusive — the first eligible rule applies"

    name = models.CharField(max_length=80, unique=True)
    sort_order = models.PositiveIntegerField(default=0)
    behaviour = models.CharField(
        max_length=10, choices=Behaviour.choices, default=Behaviour.STACK
    )

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.name
```

Extend `PricingRule`. Add to `RuleType`:

```python
        NON_REFUNDABLE = "non_refundable", "Non-Refundable Discount"
        PROMO = "promo", "Promo Code"
        MANUAL = "manual", "Manual Discount"
```

Add a new choices class and the fields:

```python
    class Application(models.TextChoices):
        PER_NIGHT = "per_night", "Per night"
        WHOLE_STAY = "whole_stay", "Whole stay"

    name = models.CharField(max_length=120, blank=True)
    group = models.ForeignKey(
        PricingGroup, on_delete=models.PROTECT, related_name="rules",
        null=True, blank=True,
    )
    sort_order = models.PositiveIntegerField(default=0)
    application = models.CharField(
        max_length=12, choices=Application.choices, default=Application.WHOLE_STAY
    )
    # Per-night rules only: locks the night at the end of this rule's group, so
    # later groups and every whole-stay adjustment skip it entirely.
    is_final = models.BooleanField(default=False)

    # Promo rules only.
    code = models.CharField(max_length=50, null=True, blank=True)
    usage_limit = models.PositiveIntegerField(null=True, blank=True, help_text="Null means unlimited")
    usage_count = models.PositiveIntegerField(default=0)
    min_subtotal_eur = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
```

Replace `PricingRule.Meta` with:

```python
    class Meta:
        ordering = ["sort_order", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["code"],
                condition=models.Q(code__isnull=False),
                name="pricingrule_code_unique_when_set",
            )
        ]
```

`models.Q` needs no new import — `models` is already imported. Keep `discount_pct` for now; Task 8 drops it.

Add `StayConstraint` after `PricingRule`:

```python
class StayConstraint(TimeStampedModel):
    """Non-price booking limits. These gate whether a stay is bookable; they
    never change its price, which is why they are not PricingRules."""

    class Kind(models.TextChoices):
        MIN_NIGHTS = "min_nights", "Minimum nights"

    class Scope(models.TextChoices):
        ALL = "all", "All Properties"
        PROPERTY = "property", "Specific Property"
        BEDROOM_GROUP = "bedroom_group", "Bedroom Group"

    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.MIN_NIGHTS)
    value = models.PositiveIntegerField()
    scope = models.CharField(max_length=20, choices=Scope.choices, default=Scope.ALL)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, null=True, blank=True, related_name="stay_constraints"
    )
    bedroom_group = models.PositiveIntegerField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "scope"]

    def __str__(self):
        return f"{self.get_kind_display()} {self.value} ({self.scope})"
```

On `BookingRequest`, add beside the existing `promo_code` field:

```python
    # Temporary during the promo migration; renamed to promo_code in 0029.
    promo_rule = models.ForeignKey(
        PricingRule, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="booking_requests",
    )
```

- [ ] **Step 4: Re-export the new models**

In `pms/model_defs/__init__.py`, add `PricingGroup,` and `StayConstraint,` to the `from .booking import (...)` block and `"PricingGroup",` / `"StayConstraint",` to `__all__`. Do exactly the same in `pms/models.py`. Both files keep their existing alphabetical placement.

- [ ] **Step 5: Generate and inspect the migration**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py makemigrations pms --name pricing_groups
```

Open `pms/migrations/0027_pricing_groups.py` and confirm it is additive: `CreateModel` for `PricingGroup` and `StayConstraint`, `AddField` for the new columns, plus `AlterModelOptions` / `AddConstraint` for the changed `Meta` — those two are expected, since step 3 rewrites `PricingRule.Meta`. What must **not** appear is `RemoveField`, `DeleteModel`, or an `AlterField` making an existing column non-null. If any of those show up, stop and report.

- [ ] **Step 6: Run the tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms -v 2
```

Expected: PASS — the 3 new tests plus every pre-existing test, unchanged. This task must not move a single existing number.

- [ ] **Step 7: Commit**

```bash
git add backend/pms
git commit -m "Add PricingGroup, StayConstraint, and unified PricingRule fields"
```

---

### Task 4: Data migration — seed groups, convert rules, fold in promos

Still non-breaking: old columns stay populated and the old engine keeps reading them. This task only *adds* correctly shaped rows.

**Files:**
- Create: `backend/pms/migrations/0028_seed_pricing_groups.py`
- Modify: `backend/pms/tests_pricing_api.py` (add `SeededConfigTests`)

**Interfaces:**
- Produces: four groups named exactly `Seasonal Pricing` (0, stack), `Stay Discounts` (1, exclusive), `Booking Discounts` (2, stack), `Promotions` (3, stack). Every pre-existing `PricingRule` has a `group` and an `application`. Six long-stay tier rules exist. One `non_refundable` rule exists. Every `PromoCode` has a twin `promo` rule and every `BookingRequest.promo_rule` points at it. Every `MINIMUM_NIGHTS` rule has become a `StayConstraint` and is deleted.

- [ ] **Step 1: Write the failing test**

Append to `backend/pms/tests_pricing_api.py`:

```python
class SeededConfigTests(TestCase):
    """The 0028 data migration must leave a working default configuration."""

    def test_four_groups_exist_in_order(self):
        self.assertEqual(
            [(g.name, g.behaviour) for g in PricingGroup.objects.all()],
            [
                ("Seasonal Pricing", "stack"),
                ("Stay Discounts", "exclusive"),
                ("Booking Discounts", "stack"),
                ("Promotions", "stack"),
            ],
        )

    def test_default_long_stay_tiers_are_real_rules(self):
        group = PricingGroup.objects.get(name="Stay Discounts")
        tiers = list(
            group.rules.filter(rule_type=PricingRule.RuleType.LONG_STAY, enabled=True)
            .order_by("sort_order")
            .values_list("min_nights", "adjustment_value")
        )
        self.assertEqual(
            tiers,
            [
                (28, Decimal("50.00")),
                (21, Decimal("35.00")),
                (14, Decimal("25.00")),
                (10, Decimal("20.00")),
                (7, Decimal("15.00")),
                (5, Decimal("10.00")),
            ],
        )
        # Biggest tier first, so "lowest sort_order wins" reproduces
        # the old "highest applicable tier" behaviour.

    def test_tiers_are_percentage_decreases_applied_to_the_whole_stay(self):
        rule = PricingRule.objects.get(
            rule_type=PricingRule.RuleType.LONG_STAY, min_nights=7, scope="all"
        )
        self.assertEqual(rule.adjustment_type, PricingRule.AdjustmentType.PCT_DECREASE)
        self.assertEqual(rule.application, PricingRule.Application.WHOLE_STAY)

    def test_non_refundable_rule_carries_the_settings_value(self):
        rule = PricingRule.objects.get(rule_type=PricingRule.RuleType.NON_REFUNDABLE)
        self.assertEqual(rule.group.name, "Booking Discounts")
        self.assertEqual(rule.adjustment_type, PricingRule.AdjustmentType.PCT_DECREASE)
        self.assertEqual(rule.adjustment_value, Decimal("10.00"))
```

Django runs migrations before tests, so these assert against the migrated state directly. Promo conversion and min-nights extraction are covered by the migrator tests in step 5.

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_api.SeededConfigTests -v 2
```

Expected: FAIL — `PricingGroup.objects.all()` is empty, so the first assertion compares `[]`.

- [ ] **Step 3: Write the data migration**

Create `backend/pms/migrations/0028_seed_pricing_groups.py`:

```python
"""Fold every price adjustment into PricingGroup/PricingRule.

Irreversible by design: it merges three sources (PromoCode rows, the
non-refundable settings field, and the tier table that used to be hardcoded
in views/_pricing.py) into one model. Reversing would have to guess which
rules came from where.
"""

from decimal import Decimal

from django.db import migrations

GROUPS = [
    ("Seasonal Pricing", 0, "stack"),
    ("Stay Discounts", 1, "exclusive"),
    ("Booking Discounts", 2, "stack"),
    ("Promotions", 3, "stack"),
]

# Previously _DEFAULT_LONG_STAY_TIERS in views/_pricing.py — an invisible
# fallback that priced every property with no rules of its own. Seeding them
# as real rows keeps today's prices and makes the behaviour editable.
DEFAULT_TIERS = [
    (28, Decimal("50.00")),
    (21, Decimal("35.00")),
    (14, Decimal("25.00")),
    (10, Decimal("20.00")),
    (7, Decimal("15.00")),
    (5, Decimal("10.00")),
]

GROUP_FOR_TYPE = {
    "seasonal": "Seasonal Pricing",
    "long_stay": "Stay Discounts",
    "last_minute": "Booking Discounts",
}


def tidy(value):
    """Render a Decimal for display: 50.00 -> '50', 12.50 -> '12.5'.

    NOT Decimal.normalize(), which turns 50.00 into 5E+1 and would name a
    rule "5E+1%".
    """
    text = f"{value:f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def seed(apps, schema_editor):
    PricingGroup = apps.get_model("pms", "PricingGroup")
    PricingRule = apps.get_model("pms", "PricingRule")
    StayConstraint = apps.get_model("pms", "StayConstraint")
    PromoCode = apps.get_model("pms", "PromoCode")
    BookingRequest = apps.get_model("pms", "BookingRequest")
    BookingSiteSettings = apps.get_model("pms", "BookingSiteSettings")

    groups = {}
    for name, sort_order, behaviour in GROUPS:
        groups[name], _ = PricingGroup.objects.get_or_create(
            name=name, defaults={"sort_order": sort_order, "behaviour": behaviour}
        )

    # 1. Existing rules: assign a group, an application, and an order.
    #    discount_pct becomes a real percentage-decrease adjustment.
    for offset, rule in enumerate(PricingRule.objects.order_by("created_at")):
        if rule.rule_type == "minimum_nights":
            continue  # handled in step 5 below
        rule.group = groups[GROUP_FOR_TYPE.get(rule.rule_type, "Promotions")]
        rule.application = "per_night" if rule.rule_type == "seasonal" else "whole_stay"
        rule.sort_order = offset
        if rule.discount_pct is not None and rule.adjustment_type is None:
            rule.adjustment_type = "pct_decrease"
            rule.adjustment_value = rule.discount_pct
        rule.save()

    # 2. Default long-stay tiers, biggest first so the lowest sort_order is
    #    the tier that used to win.
    stay = groups["Stay Discounts"]
    for index, (min_nights, pct) in enumerate(DEFAULT_TIERS):
        exists = PricingRule.objects.filter(
            rule_type="long_stay", scope="all", enabled=True, min_nights=min_nights
        ).exists()
        if exists:
            continue
        PricingRule.objects.create(
            group=stay,
            name=f"{min_nights}+ nights − {tidy(pct)}%",
            rule_type="long_stay",
            scope="all",
            enabled=True,
            min_nights=min_nights,
            adjustment_type="pct_decrease",
            adjustment_value=pct,
            application="whole_stay",
            sort_order=index,
        )

    # 3. The non-refundable discount, previously a settings field with no UI.
    settings = BookingSiteSettings.objects.first()
    pct = settings.non_refundable_discount_pct if settings else Decimal("10.00")
    PricingRule.objects.create(
        group=groups["Booking Discounts"],
        name="Non-refundable rate",
        rule_type="non_refundable",
        scope="all",
        enabled=True,
        adjustment_type="pct_decrease",
        adjustment_value=pct,
        application="whole_stay",
        sort_order=100,
    )

    # 4. Promo codes become promo rules; booking requests follow their code.
    promotions = groups["Promotions"]
    for index, promo in enumerate(PromoCode.objects.order_by("created_at")):
        rule = PricingRule.objects.create(
            group=promotions,
            name=f"Promo {promo.code}",
            rule_type="promo",
            scope=promo.scope,
            property_id=promo.property_id,
            bedroom_group=promo.bedroom_group,
            enabled=promo.active,
            code=(promo.code or "").strip().upper() or None,
            usage_limit=promo.usage_limit,
            usage_count=promo.usage_count,
            adjustment_type=(
                "pct_decrease" if promo.discount_type == "percentage" else "fixed_decrease"
            ),
            adjustment_value=promo.discount_value,
            application="whole_stay",
            sort_order=index,
        )
        BookingRequest.objects.filter(promo_code_id=promo.pk).update(promo_rule_id=rule.pk)

    # 5. Minimum nights is not a price. Move it out of pricing entirely.
    for rule in PricingRule.objects.filter(rule_type="minimum_nights"):
        if rule.min_nights:
            StayConstraint.objects.create(
                kind="min_nights",
                value=rule.min_nights,
                scope=rule.scope,
                property_id=rule.property_id,
                bedroom_group=rule.bedroom_group,
                start_date=rule.start_date,
                end_date=rule.end_date,
                enabled=rule.enabled,
            )
        rule.delete()


def unseed(apps, schema_editor):
    """No-op: see the module docstring. Roll back with a database restore."""


class Migration(migrations.Migration):
    dependencies = [("pms", "0027_pricing_groups")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 4: Run the seeded-config tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_api -v 2
```

Expected: PASS.

- [ ] **Step 5: Test the migrator against real pre-migration data**

The tests above only see an empty database migrated forward. Add a test that runs the migration function against hand-built old-shaped rows. Append to `tests_pricing_api.py`:

```python
class PromoMigrationTests(TestCase):
    """The 0028 conversion must not lose a promo code or its booking link."""

    def test_promo_rows_convert_and_the_booking_link_follows(self):
        from django.apps import apps as global_apps

        from .migrations._0028_helpers import convert_promos
        from .models import BookingRequest, PromoCode

        prop = make_property()
        promo = PromoCode.objects.create(
            code="summer25",
            discount_type="percentage",
            discount_value=Decimal("25.00"),
            scope="all",
            usage_limit=5,
            usage_count=2,
            active=True,
        )
        req = BookingRequest.objects.create(
            property=prop,
            guest_name="Test Guest",
            guest_email="g@example.com",
            guest_phone="+355000000",
            check_in=day(10),
            check_out=day(12),
            promo_code=promo,
        )

        convert_promos(global_apps)

        rule = PricingRule.objects.get(code="SUMMER25")
        self.assertEqual(rule.rule_type, PricingRule.RuleType.PROMO)
        self.assertEqual(rule.group.name, "Promotions")
        self.assertEqual(rule.adjustment_type, PricingRule.AdjustmentType.PCT_DECREASE)
        self.assertEqual(rule.adjustment_value, Decimal("25.00"))
        self.assertEqual(rule.usage_count, 2)
        req.refresh_from_db()
        self.assertEqual(req.promo_rule_id, rule.pk)
```

To make that importable, extract the promo loop from the migration into `backend/pms/migrations/_0028_helpers.py` and have the migration call it:

```python
# backend/pms/migrations/_0028_helpers.py
"""Extracted so the conversion can be unit-tested against real rows.
Leading underscore keeps Django's migration loader from treating it as one."""


def convert_promos(apps):
    PricingGroup = apps.get_model("pms", "PricingGroup")
    PricingRule = apps.get_model("pms", "PricingRule")
    PromoCode = apps.get_model("pms", "PromoCode")
    BookingRequest = apps.get_model("pms", "BookingRequest")

    promotions, _ = PricingGroup.objects.get_or_create(
        name="Promotions", defaults={"sort_order": 3, "behaviour": "stack"}
    )
    for index, promo in enumerate(PromoCode.objects.order_by("created_at")):
        rule = PricingRule.objects.create(
            group=promotions,
            name=f"Promo {promo.code}",
            rule_type="promo",
            scope=promo.scope,
            property_id=promo.property_id,
            bedroom_group=promo.bedroom_group,
            enabled=promo.active,
            code=(promo.code or "").strip().upper() or None,
            usage_limit=promo.usage_limit,
            usage_count=promo.usage_count,
            adjustment_type=(
                "pct_decrease" if promo.discount_type == "percentage" else "fixed_decrease"
            ),
            adjustment_value=promo.discount_value,
            application="whole_stay",
            sort_order=index,
        )
        BookingRequest.objects.filter(promo_code_id=promo.pk).update(promo_rule_id=rule.pk)
```

Replace section 4 of the migration with `convert_promos(apps)` and import it at the top with `from ._0028_helpers import convert_promos`.

- [ ] **Step 6: Run the whole suite**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms -v 2
```

Expected: PASS, every pre-existing test included. The old engine still reads `discount_pct` and the old `PromoCode` rows, so no number moves yet. If `PricingEngineTests` fails here, the migration changed live behaviour — stop and report which test.

- [ ] **Step 7: Commit**

```bash
git add backend/pms
git commit -m "Seed pricing groups and fold promos, tiers and non-refundable into rules"
```

---

### Task 5: Rule validation — reject contradictions at save time

A pure function, tested standalone, wired into the API in Task 9. Nothing calls it yet.

**Files:**
- Create: `backend/pms/views/_pricing_validation.py`
- Modify: `backend/pms/tests_pricing_api.py`

**Interfaces:**
- Produces: `validate_pricing_rule(rule) -> None`, raising `django.core.exceptions.ValidationError` with a single human-readable message. Callers catch `ValidationError` and return HTTP 400 with `{"error": str(e)}` — the pattern already used by `pricing_rule_list`.

- [ ] **Step 1: Write the failing test**

```python
class RuleValidationTests(TestCase):
    def setUp(self):
        self.stack = PricingGroup.objects.get(name="Seasonal Pricing")
        self.exclusive = PricingGroup.objects.get(name="Stay Discounts")

    def _rule(self, **kwargs):
        defaults = {
            "group": self.stack,
            "rule_type": PricingRule.RuleType.SEASONAL,
            "scope": "all",
            "application": PricingRule.Application.PER_NIGHT,
            "adjustment_type": PricingRule.AdjustmentType.PCT_INCREASE,
            "adjustment_value": Decimal("10.00"),
        }
        defaults.update(kwargs)
        return PricingRule(**defaults)

    def test_valid_rule_passes(self):
        validate_pricing_rule(self._rule())  # must not raise

    def test_is_final_requires_per_night(self):
        rule = self._rule(application=PricingRule.Application.WHOLE_STAY, is_final=True)
        with self.assertRaisesMessage(ValidationError, "per-night"):
            validate_pricing_rule(rule)

    def test_fixed_price_requires_per_night(self):
        rule = self._rule(
            application=PricingRule.Application.WHOLE_STAY,
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("56.00"),
        )
        with self.assertRaisesMessage(ValidationError, "whole stay"):
            validate_pricing_rule(rule)

    def test_exclusive_group_cannot_mix_applications(self):
        PricingRule.objects.create(
            group=self.exclusive,
            rule_type=PricingRule.RuleType.LONG_STAY,
            application=PricingRule.Application.WHOLE_STAY,
            min_nights=7,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("15.00"),
        )
        rule = self._rule(group=self.exclusive, application=PricingRule.Application.PER_NIGHT)
        with self.assertRaisesMessage(ValidationError, "Exclusive"):
            validate_pricing_rule(rule)

    def test_promo_needs_a_code_and_others_may_not_have_one(self):
        with self.assertRaisesMessage(ValidationError, "code"):
            validate_pricing_rule(self._rule(rule_type=PricingRule.RuleType.PROMO, code=None))
        with self.assertRaisesMessage(ValidationError, "code"):
            validate_pricing_rule(self._rule(code="NOTAPROMO"))

    def test_promo_only_fields_are_rejected_elsewhere(self):
        with self.assertRaisesMessage(ValidationError, "promo rules only"):
            validate_pricing_rule(self._rule(usage_limit=5))

    def test_minimum_spend_requires_whole_stay(self):
        rule = self._rule(
            rule_type=PricingRule.RuleType.PROMO,
            code="BIG",
            application=PricingRule.Application.PER_NIGHT,
            min_subtotal_eur=Decimal("200.00"),
        )
        with self.assertRaisesMessage(ValidationError, "whole-stay"):
            validate_pricing_rule(rule)

    def test_scoped_rule_needs_its_target(self):
        with self.assertRaisesMessage(ValidationError, "property"):
            validate_pricing_rule(self._rule(scope="property", property=None))
        with self.assertRaisesMessage(ValidationError, "bedroom"):
            validate_pricing_rule(self._rule(scope="bedroom_group", bedroom_group=None))

    def test_enabled_rule_needs_an_adjustment_value(self):
        with self.assertRaisesMessage(ValidationError, "amount"):
            validate_pricing_rule(self._rule(adjustment_value=None))
```

Add `from django.core.exceptions import ValidationError` and `from .views._pricing_validation import validate_pricing_rule` to the imports.

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_api.RuleValidationTests -v 2
```

Expected: FAIL — `ModuleNotFoundError: pms.views._pricing_validation`.

- [ ] **Step 3: Write the validator**

```python
"""Save-time checks that keep the rule set free of contradictions the engine
would otherwise have to guess its way through."""

from django.core.exceptions import ValidationError

from ..models import PricingRule


def validate_pricing_rule(rule):
    """Raise ValidationError if the rule cannot be evaluated unambiguously."""
    per_night = rule.application == PricingRule.Application.PER_NIGHT

    if rule.is_final and not per_night:
        raise ValidationError(
            "Only a per-night rule can set a final price. Whole-stay rules "
            "adjust the total and cannot lock individual nights."
        )

    if rule.adjustment_type == PricingRule.AdjustmentType.FIXED_PRICE and not per_night:
        raise ValidationError(
            "A fixed nightly price cannot be applied to the whole stay. "
            "Set this rule to per-night."
        )

    if rule.rule_type == PricingRule.RuleType.PROMO:
        if not (rule.code or "").strip():
            raise ValidationError("A promo rule needs a code.")
    else:
        if (rule.code or "").strip():
            raise ValidationError("Only a promo rule can have a code.")
        if rule.usage_limit is not None or rule.min_subtotal_eur is not None:
            raise ValidationError(
                "Usage limits and minimum spend belong to promo rules only."
            )

    if rule.min_subtotal_eur is not None and per_night:
        # The minimum is measured against the pass-1 subtotal, which does not
        # exist yet while per-night rules are being applied.
        raise ValidationError(
            "A minimum spend can only be set on a whole-stay rule."
        )

    if rule.scope == PricingRule.Scope.PROPERTY and not rule.property_id:
        raise ValidationError("Choose a property for a property-scoped rule.")
    if rule.scope == PricingRule.Scope.BEDROOM_GROUP and rule.bedroom_group is None:
        raise ValidationError("Choose a bedroom count for a bedroom-group rule.")

    if rule.enabled and rule.adjustment_value is None:
        raise ValidationError("Set an amount or percentage for this rule.")

    _validate_group_consistency(rule)


def _validate_group_consistency(rule):
    """In an Exclusive group, 'the first eligible rule wins' only has one
    meaning if every rule competes on the same footing — all per-night or all
    whole-stay. Stack groups may mix freely."""
    group = rule.group
    if group is None or group.behaviour != group.Behaviour.EXCLUSIVE:
        return

    others = group.rules.exclude(pk=rule.pk).values_list("application", flat=True)
    clashing = {a for a in others if a != rule.application}
    if clashing:
        raise ValidationError(
            f"The Exclusive group '{group.name}' already holds "
            f"{'whole-stay' if rule.application == PricingRule.Application.PER_NIGHT else 'per-night'} "
            "rules. An Exclusive group must hold only one kind, so the first "
            "eligible rule is unambiguous. Move this rule to another group or "
            "make the group Stack."
        )
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_api -v 2
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/pms
git commit -m "Add save-time validation for contradictory pricing rules"
```

---

### Task 6: The pricing engine

The heart of the plan: a pure module with no callers yet, so it can be tested exhaustively before anything depends on it.

**Files:**
- Create: `backend/pms/views/_pricing_engine.py`
- Create: `backend/pms/tests_pricing_engine.py`

**Interfaces:**
- Produces:
  - `evaluate_stay(property_obj, check_in, check_out, *, is_non_refundable=False, promo_rule=None, manual_rule_ids=(), today=None, rules=None) -> dict`
  - The returned dict: `{"nightly": [NightRow], "subtotal": Decimal, "protected": Decimal, "discountable": Decimal, "total": Decimal, "reports": [RuleReport], "amount_by_type": {str: Decimal}, "pct_by_type": {str: Decimal}, "has_seasonal": bool}`
  - `NightRow = {"date": date, "rate": Decimal, "locked": bool, "rule_ids": [str]}`
  - `RuleReport = {"id": str, "name": str, "type": str, "group": str, "application": str, "status": str, "reason": str, "amount": Decimal}`
  - Status constants `APPLIED`, `NOT_ELIGIBLE`, `OVERRIDDEN`, `LOCKED_OUT`, `SKIPPED_INVALID`.
- Consumes: `PricingGroup`, `PricingRule` from Task 3; the seeded config from Task 4.

- [ ] **Step 1: Write the failing tests**

Create `backend/pms/tests_pricing_engine.py`:

```python
"""Engine tests. Every number here is hand-computed in the assertion comment,
so a failure tells you which rule interaction broke, not just that a total moved."""

from decimal import Decimal

from django.test import TestCase

from .models import PricingGroup, PricingRule
from .tests import day, make_property
from .views._pricing_engine import APPLIED, LOCKED_OUT, OVERRIDDEN, evaluate_stay


def make_rule(group_name, **kwargs):
    group = PricingGroup.objects.get(name=group_name)
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
    def setUp(self):
        self.prop = make_property(base_price_eur=Decimal("50.00"))
        PricingRule.objects.filter(rule_type="long_stay").delete()

    def test_lowest_sort_order_wins_even_when_another_rule_discounts_more(self):
        winner = make_rule(
            "Stay Discounts", rule_type="long_stay", sort_order=1, min_nights=5,
            adjustment_type="pct_decrease", adjustment_value=Decimal("10.00"),
        )
        loser = make_rule(
            "Stay Discounts", rule_type="long_stay", sort_order=9, min_nights=5,
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
            "Stay Discounts", rule_type="long_stay", sort_order=0, min_nights=5,
            adjustment_type="pct_decrease", adjustment_value=Decimal("10.00"),
        )
        newer = make_rule(
            "Stay Discounts", rule_type="long_stay", sort_order=0, min_nights=5,
            adjustment_type="pct_decrease", adjustment_value=Decimal("40.00"),
        )
        result = evaluate_stay(self.prop, day(30), day(37))
        self.assertEqual(report_for(result, older)["status"], APPLIED)
        self.assertEqual(report_for(result, newer)["status"], OVERRIDDEN)
        self.assertEqual(result["total"], Decimal("315.00"))  # the older 10%

    def test_an_ineligible_first_rule_yields_to_the_next_one(self):
        make_rule(
            "Stay Discounts", rule_type="long_stay", sort_order=0, min_nights=28,
            adjustment_type="pct_decrease", adjustment_value=Decimal("50.00"),
        )
        make_rule(
            "Stay Discounts", rule_type="long_stay", sort_order=1, min_nights=7,
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


class ClampTests(TestCase):
    def test_a_discount_larger_than_the_stay_floors_at_zero(self):
        prop = make_property(base_price_eur=Decimal("50.00"))
        manual = make_rule(
            "Promotions", rule_type="manual",
            adjustment_type="fixed_decrease", adjustment_value=Decimal("999.00"),
        )
        result = evaluate_stay(prop, day(30), day(32), manual_rule_ids=[str(manual.pk)])
        self.assertEqual(result["total"], Decimal("0.00"))
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_engine -v 2
```

Expected: FAIL — `ModuleNotFoundError: pms.views._pricing_engine`.

- [ ] **Step 3: Write the engine**

Create `backend/pms/views/_pricing_engine.py`:

```python
"""Evaluate a stay against the configured pricing groups.

Two passes, both walking groups in ascending sort_order:

  Pass 1  per-night rules set each night's rate. A night touched by an
          is_final rule is locked once its group finishes.
  Pass 2  whole-stay rules adjust the sum of the UNLOCKED nights only.
          Locked nights rejoin the total untouched.

Ordering vocabulary: sort_order ascending. The numerically smallest value is
evaluated first and, in an Exclusive group, is the one that wins. There is no
"priority" field — do not introduce one.
"""

from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.utils.timezone import localdate

from ..models import PricingRule

CENTS = Decimal("0.01")
ZERO = Decimal("0")

APPLIED = "applied"
NOT_ELIGIBLE = "not_eligible"
OVERRIDDEN = "overridden"
LOCKED_OUT = "locked_out"
SKIPPED_INVALID = "skipped_invalid"


def _money(value):
    return Decimal(value).quantize(CENTS, ROUND_HALF_UP)


def _nights(check_in, check_out):
    return [check_in + timedelta(days=i) for i in range((check_out - check_in).days)]


def _match_scope(rule, property_obj):
    if rule.scope == PricingRule.Scope.ALL:
        return True
    if rule.scope == PricingRule.Scope.PROPERTY:
        return rule.property_id == property_obj.pk
    if rule.scope == PricingRule.Scope.BEDROOM_GROUP:
        return rule.bedroom_group == property_obj.bedrooms
    return False


def _covers_night(rule, night):
    if rule.start_date and night < rule.start_date:
        return False
    if rule.end_date and night > rule.end_date:
        return False
    return True


def apply_adjustment(rate, rule):
    """Return the rate after this rule's adjustment, floored at zero."""
    value = rule.adjustment_value
    kind = rule.adjustment_type
    A = PricingRule.AdjustmentType

    if kind == A.FIXED_PRICE:
        result = value
    elif kind == A.PCT_INCREASE:
        result = rate * (1 + value / 100)
    elif kind == A.PCT_DECREASE:
        result = rate * (1 - value / 100)
    elif kind == A.FIXED_INCREASE:
        result = rate + value
    elif kind == A.FIXED_DECREASE:
        result = rate - value
    else:
        result = rate

    return _money(max(result, ZERO))


def _stay_eligibility(rule, ctx):
    """Return (eligible, reason). Reason explains a refusal in plain words.

    Called by BOTH passes. Pass 1 calls it with ctx["subtotal"] set to None,
    because the subtotal is what pass 1 is computing; the only check that
    needs it is a promo's minimum spend, which validation restricts to
    whole-stay rules for exactly that reason.
    """
    T = PricingRule.RuleType

    # A whole-stay rule with a date window requires containment — the whole
    # stay must sit inside it. This applies to EVERY whole-stay type, not just
    # seasonal: a long-stay tier or last-minute rule configured for a season
    # must respect that season.
    if rule.application == PricingRule.Application.WHOLE_STAY:
        if rule.start_date and ctx["check_in"] < rule.start_date:
            return False, "stay starts before the rule's dates"
        if rule.end_date and ctx["check_out"] > rule.end_date:
            return False, "stay ends after the rule's dates"

    if rule.rule_type == T.SEASONAL:
        # A seasonal rule's eligibility IS its date window, and per-night rules
        # test that night by night. Applied to the whole stay it needs
        # containment instead, which the fallback at the end of this function
        # provides.
        if rule.application == PricingRule.Application.PER_NIGHT:
            return True, ""

    if rule.rule_type == T.LONG_STAY:
        if rule.min_nights and ctx["nights"] < rule.min_nights:
            return False, f"stay is {ctx['nights']} nights, rule needs {rule.min_nights}"
        return True, ""

    if rule.rule_type == T.LAST_MINUTE:
        if rule.days_before_checkin is None:
            return False, "no booking window set"
        if ctx["days_ahead"] > rule.days_before_checkin:
            return False, (
                f"check-in is {ctx['days_ahead']} days away, "
                f"rule needs {rule.days_before_checkin} or fewer"
            )
        return True, ""

    if rule.rule_type == T.NON_REFUNDABLE:
        return (True, "") if ctx["is_non_refundable"] else (False, "not a non-refundable booking")

    if rule.rule_type == T.MANUAL:
        return (
            (True, "") if str(rule.pk) in ctx["manual_rule_ids"] else (False, "not selected by staff")
        )

    if rule.rule_type == T.PROMO:
        if ctx["promo_rule_id"] != rule.pk:
            return False, "code not entered"
        if rule.usage_limit is not None and rule.usage_count >= rule.usage_limit:
            return False, f"used {rule.usage_count} of {rule.usage_limit} times"
        if rule.min_nights and ctx["nights"] < rule.min_nights:
            return False, f"stay is {ctx['nights']} nights, code needs {rule.min_nights}"
        if (
            rule.min_subtotal_eur is not None
            and ctx["subtotal"] is not None
            and ctx["subtotal"] < rule.min_subtotal_eur
        ):
            return False, f"subtotal is {ctx['subtotal']}, code needs {rule.min_subtotal_eur}"
        # A promo's validity dates need no check here: promo rules are always
        # whole-stay, so the containment check at the top already applied them.
        return True, ""

    return True, ""


def _report(rule, status, reason="", amount=ZERO):
    return {
        "id": str(rule.pk),
        "name": rule.name or _auto_name(rule),
        "type": rule.rule_type,
        "group": rule.group.name if rule.group_id else "",
        "application": rule.application,
        "status": status,
        "reason": reason,
        "amount": _money(amount),
    }


def _tidy(value):
    """Render a Decimal for display: 50.00 -> '50', 12.50 -> '12.5'.

    NOT Decimal.normalize(), which renders 50.00 as 5E+1.
    """
    text = f"{value:f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def _auto_name(rule):
    """Legacy rows have no name. Build a readable one; never store it."""
    label = rule.get_rule_type_display()
    value = rule.adjustment_value
    if value is None:
        return label
    if rule.adjustment_type == PricingRule.AdjustmentType.FIXED_PRICE:
        return f"{label} — {_tidy(value)}€ per night"
    if rule.adjustment_type in (
        PricingRule.AdjustmentType.PCT_DECREASE,
        PricingRule.AdjustmentType.PCT_INCREASE,
    ):
        sign = "−" if rule.adjustment_type == PricingRule.AdjustmentType.PCT_DECREASE else "+"
        return f"{label} {sign}{_tidy(value)}%"
    sign = "−" if rule.adjustment_type == PricingRule.AdjustmentType.FIXED_DECREASE else "+"
    return f"{label} {sign}{_tidy(value)}€"


def _load_rules():
    return list(
        PricingRule.objects.filter(enabled=True, group__isnull=False)
        .select_related("group", "property")
        .order_by("group__sort_order", "sort_order", "created_at")
    )


def evaluate_stay(
    property_obj,
    check_in,
    check_out,
    *,
    is_non_refundable=False,
    promo_rule=None,
    manual_rule_ids=(),
    today=None,
    rules=None,
):
    nights = _nights(check_in, check_out)
    night_count = len(nights)
    today = today or localdate()

    all_rules = _load_rules() if rules is None else list(rules)
    scoped = [r for r in all_rules if _match_scope(r, property_obj)]
    out_of_scope = [r for r in all_rules if r not in scoped]

    reports = {}
    for rule in out_of_scope:
        reports[rule.pk] = _report(rule, NOT_ELIGIBLE, "does not apply to this apartment")
    for rule in scoped:
        if rule.adjustment_value is None:
            reports[rule.pk] = _report(rule, SKIPPED_INVALID, "no amount set")

    groups = []
    for rule in scoped:
        if not groups or groups[-1][0].pk != rule.group_id:
            groups.append((rule.group, []))
        groups[-1][1].append(rule)

    # Built before pass 1 so per-night rules are eligibility-checked too: a
    # per-night manual or promo rule must not apply just because its dates
    # match. subtotal is unknown until pass 1 finishes, so it starts as None.
    ctx = {
        "nights": night_count,
        "days_ahead": max((check_in - today).days, 0),
        "is_non_refundable": is_non_refundable,
        "manual_rule_ids": {str(i) for i in manual_rule_ids},
        "promo_rule_id": promo_rule.pk if promo_rule else None,
        "subtotal": None,
        "check_in": check_in,
        "check_out": check_out,
    }

    # ── Pass 1: nightly rates ────────────────────────────────────────────
    base = property_obj.base_price_eur
    rows = [
        {"date": night, "rate": _money(base), "locked": False, "rule_ids": []}
        for night in nights
    ]
    has_seasonal = False

    for group, group_rules in groups:
        candidates = [
            r
            for r in group_rules
            if r.application == PricingRule.Application.PER_NIGHT
            and r.adjustment_value is not None
        ]
        per_night = []
        for rule in candidates:
            ok, reason = _stay_eligibility(rule, ctx)
            if ok:
                per_night.append(rule)
            else:
                reports[rule.pk] = _report(rule, NOT_ELIGIBLE, reason)
        if not per_night:
            continue

        newly_locked = set()
        for index, row in enumerate(rows):
            if row["locked"]:
                for rule in per_night:
                    if _covers_night(rule, row["date"]):
                        reports.setdefault(
                            rule.pk, _report(rule, LOCKED_OUT, "night already price-locked")
                        )
                continue

            eligible = [r for r in per_night if _covers_night(r, row["date"])]
            if not eligible:
                continue

            if group.behaviour == group.Behaviour.EXCLUSIVE:
                for rule in eligible[1:]:
                    reports.setdefault(
                        rule.pk,
                        _report(rule, OVERRIDDEN, f"'{eligible[0].name or _auto_name(eligible[0])}' won this night"),
                    )
                eligible = eligible[:1]

            before = row["rate"]
            for rule in eligible:
                row["rate"] = apply_adjustment(row["rate"], rule)
                row["rule_ids"].append(str(rule.pk))
                if rule.rule_type == PricingRule.RuleType.SEASONAL:
                    has_seasonal = True
                if rule.is_final:
                    newly_locked.add(index)
                previous = reports.get(rule.pk)
                amount = (previous["amount"] if previous and previous["status"] == APPLIED else ZERO)
                reports[rule.pk] = _report(rule, APPLIED, amount=amount + (row["rate"] - before))
                before = row["rate"]

        for index in newly_locked:
            rows[index]["locked"] = True

    subtotal = _money(sum(row["rate"] for row in rows))
    protected = _money(sum(row["rate"] for row in rows if row["locked"]))
    discountable = _money(subtotal - protected)

    # ── Pass 2: whole-stay adjustments ───────────────────────────────────
    ctx["subtotal"] = subtotal  # now known, so promo minimum-spend can be checked
    amount_by_type = {}
    pct_by_type = {}
    largest_by_type = {}

    for group, group_rules in groups:
        whole = [
            r
            for r in group_rules
            if r.application == PricingRule.Application.WHOLE_STAY
            and r.adjustment_value is not None
        ]
        if not whole:
            continue

        eligible = []
        for rule in whole:
            ok, reason = _stay_eligibility(rule, ctx)
            if ok:
                eligible.append(rule)
            else:
                reports[rule.pk] = _report(rule, NOT_ELIGIBLE, reason)

        if group.behaviour == group.Behaviour.EXCLUSIVE and eligible:
            for rule in eligible[1:]:
                reports[rule.pk] = _report(
                    rule, OVERRIDDEN, f"'{eligible[0].name or _auto_name(eligible[0])}' won"
                )
            eligible = eligible[:1]

        for rule in eligible:
            if discountable <= ZERO:
                reports[rule.pk] = _report(rule, APPLIED, "all nights price-locked", ZERO)
                continue
            before = discountable
            discountable = apply_adjustment(discountable, rule)
            taken = before - discountable
            reports[rule.pk] = _report(rule, APPLIED, amount=taken)
            amount_by_type[rule.rule_type] = amount_by_type.get(rule.rule_type, ZERO) + taken

            # The legacy breakdown carries one percentage per discount type.
            # When several rules of a type stack, report the percentage of the
            # one that moved the most money.
            if abs(taken) >= abs(largest_by_type.get(rule.rule_type, ZERO)):
                largest_by_type[rule.rule_type] = abs(taken)
                is_pct = rule.adjustment_type in (
                    PricingRule.AdjustmentType.PCT_DECREASE,
                    PricingRule.AdjustmentType.PCT_INCREASE,
                )
                pct_by_type[rule.rule_type] = _money(
                    rule.adjustment_value if is_pct else (taken / before * 100 if before else ZERO)
                )

    total = _money(max(discountable, ZERO) + protected)

    return {
        "nightly": rows,
        "subtotal": subtotal,
        "protected": protected,
        "discountable": _money(max(discountable, ZERO)),
        "total": total,
        "has_seasonal": has_seasonal,
        "amount_by_type": amount_by_type,
        "pct_by_type": pct_by_type,
        "reports": [reports[r.pk] for r in all_rules if r.pk in reports],
    }
```

- [ ] **Step 4: Run the engine tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_engine -v 2
```

Expected: PASS, all of them. When a total is off, print `result["reports"]` — each rule says what it did and why. Do not adjust an expected number to match the code: every expectation in step 1 is hand-computed from the spec.

- [ ] **Step 5: Confirm nothing else moved**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms -v 2
```

Expected: PASS. The engine still has no callers, so the old tests must be untouched.

- [ ] **Step 6: Commit**

```bash
git add backend/pms
git commit -m "Add the two-pass unified pricing engine"
```

---

### Task 7: Cutover — calculate_price, promo resolution, usage counting

The engine takes over. This is the task where prices change and existing tests move.

**Files:**
- Modify: `backend/pms/views/_pricing.py` (rewrite)
- Modify: `backend/pms/views/_booking_public.py` (four promo blocks, usage counting)
- Modify: `backend/pms/views/_booking_pms.py` (`booking_request_approve` increments usage)
- Modify: `backend/pms/tests.py` (`PricingEngineTests` rebuilt on the new model)
- Modify: `backend/pms/tests_features.py` (`MinNightsSurfacingTests` uses `StayConstraint`)

**Interfaces:**
- Produces:
  - `calculate_price(property_obj, check_in, check_out, is_non_refundable=False, promo_rule=None, manual_rule_ids=())` — same positional signature as today except the fifth argument is renamed from `promo_code_obj` to `promo_rule`. Returns the legacy breakdown dict plus `average_nightly_rate`, `protected_total`, `nightly_breakdown`, `rules`.
  - `resolve_promo_rule(code, property_obj, check_in, check_out) -> (rule_or_None, error_or_empty_string)`
  - `_min_nights_required(property_obj, check_in, check_out) -> int` — unchanged signature, now reads `StayConstraint`.
- Consumes: `evaluate_stay` from Task 6.

- [ ] **Step 1: Write the failing tests**

Replace `PricingEngineTests` in `backend/pms/tests.py` wholesale. The **numbers are deliberately unchanged** from today except where noted, which is what proves the migration preserved behaviour:

```python
class PricingEngineTests(TestCase):
    def setUp(self):
        self.prop = make_property()

    def _rule(self, group_name, **kwargs):
        group = PricingGroup.objects.get(name=group_name)
        defaults = {"scope": "all", "enabled": True, "application": "whole_stay"}
        defaults.update(kwargs)
        return PricingRule.objects.create(group=group, **defaults)

    def test_base_price_no_discounts(self):
        bd = calculate_price(self.prop, day(30), day(33))
        self.assertEqual(bd["nights"], 3)
        self.assertEqual(bd["subtotal"], "150.00")
        self.assertEqual(bd["total"], "150.00")
        self.assertEqual(bd["errors"], [])

    def test_default_long_stay_tier_applies(self):
        # The 15% tier is now a seeded rule rather than a hardcoded fallback;
        # the price is unchanged: 350 − 52.50 = 297.50.
        bd = calculate_price(self.prop, day(30), day(37))
        self.assertEqual(Decimal(bd["long_stay_pct"]), Decimal("15"))
        self.assertEqual(bd["long_stay_amount"], "52.50")
        self.assertEqual(bd["total"], "297.50")

    def test_custom_long_stay_rule_wins_on_sort_order(self):
        # Renamed from test_custom_long_stay_rule_overrides_default: a custom
        # rule no longer wins by being bigger, it wins by being ordered first.
        self._rule(
            "Stay Discounts", rule_type=PricingRule.RuleType.LONG_STAY,
            sort_order=0, min_nights=7,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("20"),
        )
        bd = calculate_price(self.prop, day(30), day(37))
        self.assertEqual(Decimal(bd["long_stay_pct"]), Decimal("20"))
        self.assertEqual(bd["total"], "280.00")

    def test_disabled_rule_is_ignored(self):
        self._rule(
            "Stay Discounts", rule_type=PricingRule.RuleType.LONG_STAY,
            enabled=False, sort_order=0, min_nights=2,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("90"),
        )
        bd = calculate_price(self.prop, day(30), day(33))
        self.assertEqual(bd["long_stay_pct"], "0")
        self.assertEqual(bd["total"], "150.00")

    def test_last_minute_discount(self):
        self._rule(
            "Booking Discounts", rule_type=PricingRule.RuleType.LAST_MINUTE,
            days_before_checkin=3,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("10"),
        )
        bd = calculate_price(self.prop, day(2), day(4))
        self.assertEqual(Decimal(bd["last_minute_pct"]), Decimal("10"))
        self.assertEqual(bd["total"], "90.00")

        far = calculate_price(self.prop, day(30), day(32))
        self.assertEqual(far["last_minute_pct"], "0")

    def test_seasonal_fixed_price(self):
        self._rule(
            "Seasonal Pricing", rule_type=PricingRule.RuleType.SEASONAL,
            application="per_night", start_date=day(20), end_date=day(60),
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("80.00"),
        )
        bd = calculate_price(self.prop, day(30), day(33))
        self.assertEqual(bd["effective_nightly"], "80.00")
        self.assertEqual(bd["total"], "240.00")
        self.assertTrue(bd["has_seasonal"])

    def test_seasonal_rule_covering_part_of_the_stay(self):
        # NEW behaviour. Before this change the rule matched nothing because it
        # did not span the whole stay, and all 3 nights cost 50.
        self._rule(
            "Seasonal Pricing", rule_type=PricingRule.RuleType.SEASONAL,
            application="per_night", start_date=day(31), end_date=day(31),
            adjustment_type=PricingRule.AdjustmentType.FIXED_PRICE,
            adjustment_value=Decimal("80.00"),
        )
        bd = calculate_price(self.prop, day(30), day(33))
        self.assertEqual(bd["subtotal"], "180.00")  # 50 + 80 + 50
        self.assertEqual(bd["total"], "180.00")

    def test_promo_percentage_stacks_last(self):
        promo = self._rule(
            "Promotions", rule_type=PricingRule.RuleType.PROMO, code="TEN",
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("10"),
        )
        bd = calculate_price(self.prop, day(30), day(33), promo_rule=promo)
        self.assertEqual(bd["promo_amount"], "15.00")
        self.assertEqual(bd["total"], "135.00")

    def test_minimum_nights_produces_error(self):
        StayConstraint.objects.create(
            kind=StayConstraint.Kind.MIN_NIGHTS, value=3, scope="all", enabled=True
        )
        bd = calculate_price(self.prop, day(30), day(32))
        self.assertEqual(bd["min_nights_required"], 3)
        self.assertIn("Minimum stay is 3 nights.", bd["errors"])

    def test_average_nightly_rate_replaces_first_night_price(self):
        bd = calculate_price(self.prop, day(30), day(37))  # 297.50 over 7 nights
        self.assertEqual(bd["average_nightly_rate"], "42.50")
        self.assertEqual(bd["first_night_price"], bd["average_nightly_rate"])

    def test_a_pre_migration_breakdown_blob_still_serves(self):
        # Every existing BookingRequest.price_breakdown was written by the old
        # engine and is re-served verbatim. It has none of the new keys, and
        # nothing in the read path may assume they are there.
        old_blob = {
            "base_nightly": "50.00", "effective_nightly": "50.00",
            "has_seasonal": False, "subtotal": "150.00", "long_stay_pct": "0",
            "long_stay_amount": "0.00", "last_minute_pct": "0",
            "last_minute_amount": "0.00", "non_refundable_pct": "0",
            "non_refundable_amount": "0.00", "promo_amount": "0.00",
            "total": "150.00", "first_night_price": "50.00", "nights": 3,
            "min_nights_required": 0, "errors": [],
        }
        req = BookingRequest.objects.create(
            property=self.prop,
            guest_name="Old Guest",
            guest_email="old@example.com",
            guest_phone="+355000000",
            check_in=day(30),
            check_out=day(33),
            total_price_eur=Decimal("150.00"),
            price_breakdown=old_blob,
        )
        client = Client()
        make_admin(client)
        listed = client.get("/api/booking-requests/").json()["bookingRequests"]
        match = next(r for r in listed if r["id"] == str(req.id))
        self.assertEqual(match["priceBreakdown"]["total"], "150.00")
        self.assertNotIn("rules", match["priceBreakdown"])

    def test_breakdown_keeps_every_legacy_key(self):
        bd = calculate_price(self.prop, day(30), day(33))
        for key in (
            "base_nightly", "effective_nightly", "has_seasonal", "subtotal",
            "long_stay_pct", "long_stay_amount", "last_minute_pct",
            "last_minute_amount", "non_refundable_pct", "non_refundable_amount",
            "promo_amount", "total", "first_night_price", "nights",
            "min_nights_required", "errors",
        ):
            self.assertIn(key, bd)
```

Update the imports at the top of `tests.py`:

```python
from .models import (
    BookingRequest,
    PricingGroup,
    PricingRule,
    Property,
    Reservation,
    StayConstraint,
)
```

`PromoCode` goes now rather than in Task 8: `PricingEngineTests` no longer builds one, and dropping it here keeps the file importable across both tasks. `BookingRequest` is new — the stored-blob test needs it.

In `tests_features.py`, `MinNightsSurfacingTests.setUp` swaps its `PricingRule` for:

```python
        StayConstraint.objects.create(
            kind=StayConstraint.Kind.MIN_NIGHTS,
            value=3,
            scope=StayConstraint.Scope.ALL,
            enabled=True,
        )
```

and `PublicListingPricingTests.setUp` adds `group=PricingGroup.objects.get(name="Seasonal Pricing"), application="per_night"` to its seasonal rule. Update that file's imports accordingly.

- [ ] **Step 2: Run them to make sure they fail**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests.PricingEngineTests -v 2
```

Expected: FAIL — `calculate_price() got an unexpected keyword argument 'promo_rule'`, plus failures on the new per-night and average-rate tests.

- [ ] **Step 3: Rewrite `_pricing.py`**

Replace the entire file:

```python
"""The single entry point for money. Everything about *which* rules apply and
*how* they interact lives in _pricing_engine; this module owns the public
signature, the minimum-stay check, and the breakdown's on-the-wire shape."""

from decimal import ROUND_HALF_UP, Decimal

from ..models import PricingRule, StayConstraint
from ._pricing_engine import CENTS, evaluate_stay

ZERO = Decimal("0")


def _money(value):
    return Decimal(value).quantize(CENTS, ROUND_HALF_UP)


def _min_nights_required(property_obj, check_in, check_out):
    """Return the applicable minimum-nights requirement (0 = no minimum).
    Most-specific scope wins, exactly as the old PricingRule version did."""
    scope_rank = {"property": 2, "bedroom_group": 1, "all": 0}
    best = 0
    best_rank = -1

    constraints = StayConstraint.objects.filter(
        kind=StayConstraint.Kind.MIN_NIGHTS, enabled=True
    ).select_related("property")

    for c in constraints:
        if c.scope == "property" and c.property_id != property_obj.pk:
            continue
        if c.scope == "bedroom_group" and c.bedroom_group != property_obj.bedrooms:
            continue
        if c.start_date and check_in < c.start_date:
            continue
        if c.end_date and check_out > c.end_date:
            continue
        rank = scope_rank.get(c.scope, 0)
        if c.value and (rank > best_rank or c.value > best):
            best = c.value
            best_rank = rank

    return best


def resolve_promo_rule(code, property_obj, check_in, check_out):
    """Look up a promo rule and check everything knowable before pricing.

    Returns (rule, error). The stay-dependent checks the engine owns — the
    minimum subtotal — are NOT done here; the engine reports those itself.
    """
    code = (code or "").strip().upper()
    if not code:
        return None, ""

    rule = (
        PricingRule.objects.filter(
            rule_type=PricingRule.RuleType.PROMO, enabled=True, code=code
        )
        .select_related("group", "property")
        .first()
    )
    if rule is None:
        return None, "That promo code is not valid."
    if rule.usage_limit is not None and rule.usage_count >= rule.usage_limit:
        return None, "That promo code has reached its usage limit."
    if rule.scope == PricingRule.Scope.PROPERTY and rule.property_id != property_obj.pk:
        return None, "That promo code does not apply to this apartment."
    if rule.scope == PricingRule.Scope.BEDROOM_GROUP and rule.bedroom_group != property_obj.bedrooms:
        return None, "That promo code does not apply to this apartment."
    if rule.start_date and check_in < rule.start_date:
        return None, "That promo code is not valid for these dates."
    if rule.end_date and check_out > rule.end_date:
        return None, "That promo code is not valid for these dates."
    if rule.min_nights and (check_out - check_in).days < rule.min_nights:
        return None, f"That promo code needs a stay of at least {rule.min_nights} nights."

    return rule, ""


def calculate_price(
    property_obj,
    check_in,
    check_out,
    is_non_refundable=False,
    promo_rule=None,
    manual_rule_ids=(),
):
    """Full price breakdown for a stay. Callers must check breakdown["errors"]
    before accepting a booking."""
    nights = (check_out - check_in).days
    result = evaluate_stay(
        property_obj,
        check_in,
        check_out,
        is_non_refundable=is_non_refundable,
        promo_rule=promo_rule,
        manual_rule_ids=manual_rule_ids,
    )

    errors = []
    min_nights = _min_nights_required(property_obj, check_in, check_out)
    if min_nights and nights < min_nights:
        errors.append(f"Minimum stay is {min_nights} nights.")

    amounts = result["amount_by_type"]
    pcts = result["pct_by_type"]
    T = PricingRule.RuleType

    def amount(rule_type):
        return str(_money(amounts.get(rule_type, ZERO)))

    def pct(rule_type):
        return str(pcts[rule_type]) if rule_type in pcts else "0"

    effective_nightly = _money(result["subtotal"] / nights) if nights else ZERO
    average_nightly = _money(result["total"] / nights) if nights else ZERO

    return {
        "base_nightly": str(property_obj.base_price_eur),
        "effective_nightly": str(effective_nightly),
        "has_seasonal": result["has_seasonal"],
        "subtotal": str(result["subtotal"]),
        "long_stay_pct": pct(T.LONG_STAY),
        "long_stay_amount": amount(T.LONG_STAY),
        "last_minute_pct": pct(T.LAST_MINUTE),
        "last_minute_amount": amount(T.LAST_MINUTE),
        "non_refundable_pct": pct(T.NON_REFUNDABLE),
        "non_refundable_amount": amount(T.NON_REFUNDABLE),
        "promo_amount": amount(T.PROMO),
        "total": str(result["total"]),
        # Deprecated: this was never the first night's price after the engine
        # became per-night. Read average_nightly_rate instead.
        "first_night_price": str(average_nightly),
        "average_nightly_rate": str(average_nightly),
        "protected_total": str(result["protected"]),
        "nights": nights,
        "min_nights_required": min_nights,
        "errors": errors,
        "nightly_breakdown": [
            {
                "date": row["date"].isoformat(),
                "rate": str(row["rate"]),
                "locked": row["locked"],
                "ruleIds": row["rule_ids"],
            }
            for row in result["nightly"]
        ],
        "rules": [
            {**report, "amount": str(report["amount"])} for report in result["reports"]
        ],
    }
```

- [ ] **Step 4: Collapse the four promo blocks**

In `_booking_public.py`, replace each of the four blocks at roughly lines 546-556, 587-595, 650-659 and 744-753. The **validate** endpoint (587) and the **calculate** endpoint (546) surface the error; the two **create** paths keep today's silent-drop behaviour:

```python
# The two CREATE paths only (booking_create_request, booking_create_direct):
# an invalid code is silently dropped, exactly as today.
promo_rule, _ = resolve_promo_rule(promo_code_str, prop, check_in, check_out)

# booking_calculate — keeps its CURRENT contract: HTTP 200, the price computed
# WITHOUT the promo, and the reason reported alongside it. The existing
# response already carries `promoError` and `promoApplied`; both keep their
# meaning, so the local variable names below feed straight into them.
promo_rule, promo_error = resolve_promo_rule(promo_code_str, prop, check_in, check_out)
# ... then, unchanged: "promoError": promo_error, "promoApplied": promo_rule is not None

# booking_validate_promo — also HTTP 200, with a valid:false body. The guest
# form reads `valid` and shows `error` as a message.
promo_rule, promo_error = resolve_promo_rule(promo_code_str, prop, check_in, check_out)
if promo_error:
    return JsonResponse({"valid": False, "error": promo_error})
```

Note the three-way split, and preserve it exactly — check each of the four sites against this list rather than applying one pattern to all of them:

| Endpoint | On an invalid code |
|---|---|
| `booking_create_request`, `booking_create_direct` | drop it silently, price without it |
| `booking_calculate` | HTTP 200, price without it, reason in `promoError` |
| `booking_validate_promo` | HTTP 200, `{"valid": false, "error": ...}` |

None of these returns a 4xx for a bad promo code today, and none should start.

`resolve_promo_rule`'s messages differ slightly in wording from the current inline strings ("That promo code is not valid." vs "Invalid promo code."). That is fine — they are display text, not contracts — but keep them as sentences, since the guest sees them verbatim.

Update every `calculate_price(..., promo_code_obj=promo_obj)` call to `promo_rule=promo_rule`, then fix **both** import blocks at the top of the file:

- Drop `PromoCode,` from the `from ..models import (...)` block (line 22). Keep `PricingRule` — steps 4 and 5 both use it.
- Replace line 28 in full:

```python
# before
from ._pricing import calculate_price, _match_scope, _min_nights_required
# after
from ._pricing import calculate_price, _min_nights_required, resolve_promo_rule
```

`_match_scope` must go: step 3 deletes it from `_pricing.py` (the engine keeps its own private copy), and all four of its call sites — lines 552, 594, 656 and 750 — sit inside the promo blocks this step collapses. Leaving the import behind raises `ImportError` at module load, which takes down `pms/urls.py` and therefore every test in the suite, not just the pricing ones. `_min_nights_required` stays: lines 315 and 348 still probe it.

In `booking_create_request`, **delete** the `usage_count` update at line 666-667 entirely and set `promo_rule=promo_rule` on the `BookingRequest.objects.create(...)` call. In `booking_create_direct`, replace line 777 with:

```python
        if promo_rule:
            PricingRule.objects.filter(pk=promo_rule.pk).update(
                usage_count=F("usage_count") + 1
            )
```

adding `from django.db.models import F` to the imports. Also replace `Decimal(breakdown["first_night_price"])` at line 760 with `Decimal(breakdown["average_nightly_rate"])`.

- [ ] **Step 5: Move the increment to approval**

In `_booking_pms.py`, inside `booking_request_approve`'s `transaction.atomic()` block, after `reservation.save()`:

```python
        if req.promo_rule_id:
            PricingRule.objects.filter(pk=req.promo_rule_id).update(
                usage_count=F("usage_count") + 1
            )
```

Add a warning to the response when the code has now passed its limit — the approval itself must never be blocked, because the guest already holds a quoted price:

```python
    warning = ""
    if req.promo_rule_id:
        promo = PricingRule.objects.get(pk=req.promo_rule_id)
        if promo.usage_limit is not None and promo.usage_count > promo.usage_limit:
            warning = (
                f"Promo {promo.code} is now over its usage limit "
                f"({promo.usage_count} of {promo.usage_limit})."
            )
```

and include `"warning": warning` in the `JsonResponse`. Update `_serialize_booking_request_pms` line 149 to read `req.promo_rule.code if req.promo_rule else None`, and the two `select_related("property", "promo_code")` calls (lines 195, 225) to `select_related("property", "promo_rule")`.

- [ ] **Step 6: Write the usage-counting tests**

Append to `tests_pricing_api.py`:

```python
class PromoUsageCountingTests(TestCase):
    """A promo is spent when a booking is committed — never before."""

    def setUp(self):
        self.client = Client()
        self.prop = make_property()
        self.promo = PricingRule.objects.create(
            group=PricingGroup.objects.get(name="Promotions"),
            rule_type=PricingRule.RuleType.PROMO,
            code="TEN",
            scope="all",
            enabled=True,
            adjustment_type=PricingRule.AdjustmentType.PCT_DECREASE,
            adjustment_value=Decimal("10.00"),
        )

    def _create_request(self, prop=None, start=30):
        # Callers that approve more than one request must pass distinct dates
        # or a distinct property: approval refuses to create a reservation
        # that overlaps an existing one, so two identical requests would make
        # the second approval a 409 and prove nothing about promo counting.
        return self.client.post(
            "/api/booking/requests/",
            data=json.dumps({
                "propertyId": str((prop or self.prop).id),
                "checkIn": day(start).isoformat(),
                "checkOut": day(start + 3).isoformat(),
                "guestName": "Test Guest",
                "guestPhone": "+355000000",
                "promoCode": "TEN",
            }),
            content_type="application/json",
        )

    def test_validating_a_code_does_not_spend_it(self):
        self.client.post(
            "/api/booking/promo-codes/validate/",
            data=json.dumps({
                "propertyId": str(self.prop.id),
                "code": "TEN",
                "checkIn": day(30).isoformat(),
                "checkOut": day(33).isoformat(),
            }),
            content_type="application/json",
        )
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 0)

    def test_a_pending_request_does_not_spend_it(self):
        self.assertEqual(self._create_request().status_code, 201)
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 0)

    def test_approval_spends_it(self):
        self._create_request()
        req = BookingRequest.objects.get()
        make_admin(self.client)
        response = self.client.post(f"/api/booking-requests/{req.id}/approve/")
        self.assertEqual(response.status_code, 200)
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 1)

    def test_rejection_spends_nothing(self):
        self._create_request()
        req = BookingRequest.objects.get()
        make_admin(self.client)
        self.client.post(
            f"/api/booking-requests/{req.id}/reject/",
            data=json.dumps({"rejectionMessage": "no"}),
            content_type="application/json",
        )
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 0)

    def test_approval_never_blocks_on_the_limit_but_warns(self):
        self._create_request(start=30)
        self._create_request(start=60)  # non-overlapping, so neither approval 409s
        self.promo.usage_limit = 1
        self.promo.save()
        make_admin(self.client)
        for req in BookingRequest.objects.order_by("check_in"):
            response = self.client.post(f"/api/booking-requests/{req.id}/approve/")
            self.assertEqual(response.status_code, 200)
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.usage_count, 2)
        self.assertIn("over its usage limit", response.json()["warning"])
```

Add `import json` and `BookingRequest` to that file's imports. Check the real route names in `pms/urls.py` before running — use the paths that file actually declares.

- [ ] **Step 7: Run the whole suite**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms -v 2
```

Expected: PASS. If a pre-existing test outside `PricingEngineTests` fails, that is a real regression — fix the code, not the expectation. The only expectations allowed to change in this task are the ones rewritten in step 1, each with its reason in a comment.

- [ ] **Step 8: Commit**

```bash
git add backend/pms
git commit -m "Cut calculate_price over to the unified engine"
```

---

### Task 8: Cleanup migration and dead-code removal

**Files:**
- Create: `backend/pms/migrations/0029_drop_promocode.py`
- Modify: `backend/pms/model_defs/booking.py`, `model_defs/__init__.py`, `models.py`
- Modify: `backend/pms/views/_booking_pms.py`, `backend/pms/views/_booking_public.py`, `views/__init__.py`, `pms/urls.py`

**Interfaces:**
- Produces: `BookingRequest.promo_code` is now the FK to `PricingRule`; `PromoCode`, `PricingRule.discount_pct`, `BookingSiteSettings.non_refundable_discount_pct` and the `minimum_nights` choice no longer exist; `/api/promo-codes/` returns 404.

- [ ] **Step 1: Delete the model and fields**

In `model_defs/booking.py`:

- Delete the `PromoCode` class.
- Delete `PricingRule.discount_pct`.
- Delete `BookingSiteSettings.non_refundable_discount_pct`.
- Remove `MINIMUM_NIGHTS` from `RuleType`.
- Make `PricingRule.group` required — drop `null=True, blank=True` from the field. Leaving the model nullable while the migration makes the column non-null causes permanent migration drift: `makemigrations` would propose the same `AlterField` on every future run.
- On `BookingRequest`, delete the old `promo_code` field and rename `promo_rule` to `promo_code`, keeping `related_name="booking_requests"`.

Remove `PromoCode` from both re-export files (import block and `__all__`).

- [ ] **Step 2: Remove the last readers of the deleted settings field**

`BookingSiteSettings.non_refundable_discount_pct` is still read and written by two live call sites — the migration in Task 4 copied its value into a rule, but nothing removed the accessors:

- `_booking_pms.py:108` — `"nonRefundableDiscountPct": str(settings.non_refundable_discount_pct),` in `_serialize_booking_settings`. Delete the line.
- `_booking_pms.py:698` — the `nonRefundableDiscountPct` assignment in the settings PATCH handler. Delete that branch.

Both are dropped rather than repointed: the discount is a rule now, edited on the pricing page. Task 11 removes the matching frontend field.

- [ ] **Step 3: Write the migration by hand**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py makemigrations pms --name drop_promocode
```

**Do not trust the interactive rename prompt here.** The same migration removes a field called `promo_code` and renames `promo_rule` to `promo_code`; Django's autodetector may propose a `RemoveField` + `AddField` pair instead, which would silently drop every booking's promo link. Open the generated file and make sure the operations read exactly, in this order:

```python
    operations = [
        migrations.RemoveField(model_name="bookingrequest", name="promo_code"),
        migrations.RenameField(
            model_name="bookingrequest", old_name="promo_rule", new_name="promo_code"
        ),
        migrations.RemoveField(model_name="pricingrule", name="discount_pct"),
        migrations.RemoveField(
            model_name="bookingsitesettings", name="non_refundable_discount_pct"
        ),
        migrations.AlterField(
            model_name="pricingrule",
            name="group",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="rules",
                to="pms.pricinggroup",
            ),
        ),
        migrations.DeleteModel(name="PromoCode"),
    ]
```

Rewrite the file to match if it differs. Two orderings are load-bearing: `RemoveField(bookingrequest.promo_code)` must precede the rename, or the new name collides with the old column; and `DeleteModel(PromoCode)` must come last, after the FK pointing at it is gone, or Postgres refuses the drop.

Then confirm the model and the migrations agree:

```bash
cd backend && .\.venv\Scripts\python.exe manage.py makemigrations pms --check --dry-run
```

Expected: "No changes detected". Anything else means the model definitions in step 1 and the hand-written migration disagree.

- [ ] **Step 4: Point the Task 7 call sites back at `promo_code`**

Task 7 deliberately wrote every reference against the temporary field name, because that was the only name that existed then. Step 1's rename has just made `promo_rule` nonexistent, so revert all of them now — otherwise approving a booking raises `AttributeError` and the request list raises `FieldError` on `select_related`.

In `backend/pms/views/_booking_public.py`, in `booking_create_request`, change the `BookingRequest.objects.create(...)` keyword `promo_rule=promo_rule` to `promo_code=promo_rule`. The local variable and the `calculate_price(..., promo_rule=...)` argument keep their names — only the model field changed.

In `backend/pms/views/_booking_pms.py`:

- The increment in `booking_request_approve`: `req.promo_rule_id` → `req.promo_code_id` (both occurrences, in the `if` and in the `filter(pk=...)`).
- The warning block: `req.promo_rule_id` → `req.promo_code_id` (both occurrences).
- `_serialize_booking_request_pms`: `req.promo_rule.code if req.promo_rule else None` → `req.promo_code.code if req.promo_code else None`.
- Both `select_related("property", "promo_rule")` calls (lines 195, 225) → `select_related("property", "promo_code")`.

`BookingRequest.promo_code` is the FK to `PricingRule` now, so `.code` still resolves and the `promoCode` wire key is unchanged.

- [ ] **Step 5: Retire the promo-conversion test**

`PromoMigrationTests` in `tests_pricing_api.py` builds real `PromoCode` rows, so it cannot survive the model's deletion. Delete the whole class and leave this note in its place:

```python
# PromoMigrationTests lived here. It verified the 0028 promo conversion against
# real PromoCode rows and passed before 0029 deleted the model. The conversion
# is now covered by SeededConfigTests plus the real `migrate` run.
```

Keep `backend/pms/migrations/_0028_helpers.py` — migration 0028 still imports it, and deleting it would break any database replaying migrations from scratch.

- [ ] **Step 6: Delete the dead views and routes**

Delete `_serialize_promo_code` (lines 70-83), `promo_code_list` (396-414), `promo_code_detail` (417-440) and `_apply_promo_payload` (443-463) from `_booking_pms.py`, and drop `PromoCode,` from that file's `from ..models import (...)` block (line 17) — it is the last reference and the name no longer exists. Remove `promo_code_detail` and `promo_code_list` from `views/__init__.py` (import block **and** `__all__`). Delete lines 124-125 of `pms/urls.py`.

- [ ] **Step 7: Confirm nothing references the deleted names**

```bash
cd backend && rg -n "PromoCode|discount_pct|non_refundable_discount_pct|minimum_nights|_DEFAULT_LONG_STAY_TIERS" pms/ --glob '!migrations/*'
rg -n "req\.promo_rule|\.promo_rule_id|select_related\([^)]*promo_rule" pms/ --glob '!migrations/*'
```

Expected: no hits from either, outside `migrations/`. Migrations legitimately keep historical references — do not edit old migration files.

The second pattern is deliberately narrow. A bare `promo_rule` search would be useless: `resolve_promo_rule`, the local `promo_rule` variables, the `calculate_price`/`evaluate_stay` keyword argument and the engine's `ctx["promo_rule_id"]` key are all correct and must survive. Only model-field access is wrong now.

- [ ] **Step 8: Run the suite**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms -v 2
```

Expected: PASS.

- [ ] **Step 9: Verify migrations apply cleanly from an existing database**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py migrate pms
```

Expected: 0027, 0028 and 0029 apply against the real development database with no error. Then `.\.venv\Scripts\python.exe manage.py showmigrations pms` to confirm all three are ticked.

- [ ] **Step 10: Commit**

```bash
git add backend/pms
git commit -m "Drop PromoCode, discount_pct and the non-refundable setting"
```

---

### Task 9: Pricing group, rule and constraint endpoints

**Files:**
- Create: `backend/pms/views/_pricing_rules_api.py`
- Modify: `backend/pms/views/_booking_pms.py` (move the rule views out), `views/__init__.py`, `pms/urls.py`
- Modify: `backend/pms/tests_pricing_api.py`

**Interfaces:**
- Produces these routes, all `require_roles([ROLE_ADMIN, ROLE_MANAGEMENT])`:
  - `GET/POST /api/pricing-groups/`, `PATCH/DELETE /api/pricing-groups/<uuid:group_id>/`, `PATCH /api/pricing-groups/reorder/`
  - `GET/POST /api/pricing-rules/`, `PATCH/DELETE /api/pricing-rules/<uuid:rule_id>/`, `PATCH /api/pricing-rules/reorder/`
  - `GET/POST /api/stay-constraints/`, `PATCH/DELETE /api/stay-constraints/<uuid:constraint_id>/`
- Serializer keys — `pricingGroup`: `{id, name, sortOrder, behaviour, ruleCount}`. `pricingRule`: the existing keys minus `discountPct`, plus `{name, groupId, sortOrder, application, isFinal, code, usageLimit, usageCount, minSubtotalEur}`. `stayConstraint`: `{id, kind, value, scope, propertyId, bedroomGroup, startDate, endDate, enabled, createdAt}`.

- [ ] **Step 1: Write the failing tests**

```python
class PricingGroupApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_requires_a_role(self):
        anon = Client()
        self.assertIn(anon.get("/api/pricing-groups/").status_code, (401, 403))

    def test_lists_the_seeded_groups_in_order(self):
        data = self.client.get("/api/pricing-groups/").json()["pricingGroups"]
        self.assertEqual([g["name"] for g in data][0], "Seasonal Pricing")
        self.assertEqual(data[1]["behaviour"], "exclusive")

    def test_reorder_persists(self):
        groups = self.client.get("/api/pricing-groups/").json()["pricingGroups"]
        reversed_ids = [g["id"] for g in reversed(groups)]
        response = self.client.patch(
            "/api/pricing-groups/reorder/",
            data=json.dumps({"order": reversed_ids}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        after = self.client.get("/api/pricing-groups/").json()["pricingGroups"]
        self.assertEqual([g["id"] for g in after], reversed_ids)

    def test_a_group_with_rules_cannot_be_deleted(self):
        group = PricingGroup.objects.get(name="Stay Discounts")
        response = self.client.delete(f"/api/pricing-groups/{group.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("rule", response.json()["error"].lower())

    def test_an_empty_group_can_be_deleted(self):
        group = PricingGroup.objects.create(name="Temp", sort_order=50)
        self.assertEqual(self.client.delete(f"/api/pricing-groups/{group.id}/").status_code, 204)


class PricingRuleApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.group = PricingGroup.objects.get(name="Seasonal Pricing")

    def test_create_rejects_a_contradiction(self):
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(self.group.id),
                "ruleType": "seasonal",
                "application": "whole_stay",
                "isFinal": True,
                "adjustmentType": "pct_increase",
                "adjustmentValue": "10",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("per-night", response.json()["error"])

    def test_every_field_is_patchable(self):
        rule = PricingRule.objects.create(
            group=self.group, rule_type="seasonal", application="per_night",
            adjustment_type="pct_increase", adjustment_value=Decimal("10.00"),
        )
        response = self.client.patch(
            f"/api/pricing-rules/{rule.id}/",
            data=json.dumps({
                "name": "August peak",
                "adjustmentValue": "25",
                "startDate": day(30).isoformat(),
                "isFinal": True,
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        rule.refresh_from_db()
        self.assertEqual(rule.name, "August peak")
        self.assertEqual(rule.adjustment_value, Decimal("25"))
        self.assertTrue(rule.is_final)

    def test_reorder_within_a_group(self):
        first = PricingRule.objects.create(group=self.group, rule_type="seasonal", sort_order=0)
        second = PricingRule.objects.create(group=self.group, rule_type="seasonal", sort_order=1)
        self.client.patch(
            "/api/pricing-rules/reorder/",
            data=json.dumps({"groupId": str(self.group.id), "order": [str(second.id), str(first.id)]}),
            content_type="application/json",
        )
        second.refresh_from_db()
        self.assertEqual(second.sort_order, 0)

    def test_promo_endpoints_are_gone(self):
        self.assertEqual(self.client.get("/api/promo-codes/").status_code, 404)

    def test_a_promo_code_is_stored_uppercase(self):
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(PricingGroup.objects.get(name="Promotions").id),
                "ruleType": "promo",
                "code": " summer25 ",
                "adjustmentType": "pct_decrease",
                "adjustmentValue": "10",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["pricingRule"]["code"], "SUMMER25")

    def test_a_new_seasonal_rule_defaults_to_per_night(self):
        response = self.client.post(
            "/api/pricing-rules/",
            data=json.dumps({
                "groupId": str(self.group.id),
                "ruleType": "seasonal",
                "adjustmentType": "pct_increase",
                "adjustmentValue": "50",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.json()["pricingRule"]["application"], "per_night")

    def test_a_group_cannot_become_exclusive_while_it_mixes_applications(self):
        PricingRule.objects.create(
            group=self.group, rule_type="seasonal", application="per_night",
            adjustment_type="pct_increase", adjustment_value=Decimal("10.00"),
        )
        PricingRule.objects.create(
            group=self.group, rule_type="manual", application="whole_stay",
            adjustment_type="fixed_decrease", adjustment_value=Decimal("5.00"),
        )
        response = self.client.patch(
            f"/api/pricing-groups/{self.group.id}/",
            data=json.dumps({"behaviour": "exclusive"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Exclusive", response.json()["error"])


class StayConstraintApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)

    def test_requires_a_role(self):
        self.assertIn(Client().get("/api/stay-constraints/").status_code, (401, 403))

    def test_create_list_and_delete(self):
        created = self.client.post(
            "/api/stay-constraints/",
            data=json.dumps({"kind": "min_nights", "value": 3, "scope": "all"}),
            content_type="application/json",
        )
        self.assertEqual(created.status_code, 201)
        constraint_id = created.json()["stayConstraint"]["id"]

        listed = self.client.get("/api/stay-constraints/").json()["stayConstraints"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["value"], 3)

        self.assertEqual(
            self.client.delete(f"/api/stay-constraints/{constraint_id}/").status_code, 204
        )

    def test_a_property_scoped_constraint_needs_a_property(self):
        response = self.client.post(
            "/api/stay-constraints/",
            data=json.dumps({"kind": "min_nights", "value": 3, "scope": "property"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_it_reaches_the_price_breakdown(self):
        prop = make_property()
        self.client.post(
            "/api/stay-constraints/",
            data=json.dumps({"kind": "min_nights", "value": 4, "scope": "all"}),
            content_type="application/json",
        )
        from .views._pricing import calculate_price

        bd = calculate_price(prop, day(30), day(32))
        self.assertEqual(bd["min_nights_required"], 4)
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_api -v 2
```

Expected: FAIL — 404 on `/api/pricing-groups/`.

- [ ] **Step 3: Write the views**

Create `backend/pms/views/_pricing_rules_api.py` following the exact conventions of `_booking_pms.py`: `require_roles` first, `json_payload(request)` for the body, `JsonResponse`, 201 on create, 204 on delete, 400 on `ValidationError`/`ValueError`, 405 on a wrong method. Move `_serialize_pricing_rule`, `pricing_rule_list`, `pricing_rule_detail` and `_apply_pricing_rule_payload` here from `_booking_pms.py`, extend the serializer and payload applier with the new fields, and call `validate_pricing_rule(rule)` immediately before every `rule.save()`.

Three behaviours the payload applier owes that the old one did not:

```python
    if "code" in payload:
        # Codes are matched case-insensitively by being stored uppercase, the
        # same contract _apply_promo_payload had. Blank becomes NULL so the
        # conditional unique constraint ignores non-promo rules.
        rule.code = (payload.get("code") or "").strip().upper() or None
    if "groupId" in payload:
        rule.group_id = payload["groupId"]
    if "application" in payload:
        rule.application = payload["application"]
    elif not rule.pk and "ruleType" in payload:
        # Per-type default, per the spec: seasonal prices nights, everything
        # else adjusts the stay. Only on create — a PATCH must never silently
        # re-derive a value the operator set by hand.
        rule.application = (
            PricingRule.Application.PER_NIGHT
            if payload["ruleType"] == PricingRule.RuleType.SEASONAL
            else PricingRule.Application.WHOLE_STAY
        )
```

Handle `name`, `sortOrder`, `isFinal`, `usageLimit` and `minSubtotalEur` with the same `if "key" in payload` shape as the existing fields. `usageCount` is read-only — never applied from a payload.

The group PATCH handler validates a behaviour change before saving it:

```python
    if "behaviour" in payload and payload["behaviour"] == PricingGroup.Behaviour.EXCLUSIVE:
        applications = set(group.rules.values_list("application", flat=True))
        if len(applications) > 1:
            return JsonResponse(
                {"error": (
                    f"'{group.name}' holds both per-night and whole-stay rules. An "
                    "Exclusive group must hold only one kind, so the first eligible "
                    "rule is unambiguous. Split them before switching."
                )},
                status=400,
            )
```

This is the group-side half of the check `validate_pricing_rule` performs rule-side; without it, flipping the group is a back door around that validation.

**Stay constraints** get their own trio in the same file — `_serialize_stay_constraint`, `stay_constraint_list`, `stay_constraint_detail` — following the identical shape. The serializer emits `{id, kind, value, scope, propertyId, bedroomGroup, startDate, endDate, enabled, createdAt}`; the payload applier mirrors it; `value` must be a positive integer and a `scope` of `property`/`bedroom_group` requires its target, both rejected with 400. No shared validator module — the rules are short and specific to this model.

Reorder handlers assign `sort_order` by list position:

```python
def pricing_group_reorder(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    payload = json_payload(request)
    order = payload.get("order") or []
    with transaction.atomic():
        for position, group_id in enumerate(order):
            PricingGroup.objects.filter(pk=group_id).update(sort_order=position)
    return JsonResponse({"pricingGroups": [_serialize_pricing_group(g) for g in PricingGroup.objects.all()]})
```

Group delete refuses while rules remain:

```python
    if request.method == "DELETE":
        count = group.rules.count()
        if count:
            return JsonResponse(
                {"error": f"This group still holds {count} rule(s). Move or delete them first."},
                status=400,
            )
        group.delete()
        return JsonResponse({}, status=204)
```

- [ ] **Step 4: Register the views and routes**

Add the new view names to `views/__init__.py` (import block **and** `__all__`), and to `pms/urls.py` beside the existing pricing routes. Place the literal `reorder/` paths **before** the `<uuid:...>` paths so they are not swallowed by the UUID converter.

- [ ] **Step 5: Run the suite**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms -v 2
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/pms
git commit -m "Add pricing group, rule and stay-constraint endpoints"
```

---

### Task 10: Staff quotes endpoint

**Files:**
- Modify: `backend/pms/views/_pricing_rules_api.py`, `views/__init__.py`, `pms/urls.py`
- Modify: `backend/pms/tests_pricing_api.py`

**Interfaces:**
- Produces: `POST /api/properties/quotes/` with body `{checkIn, checkOut, propertyIds?}` returning `{"quotes": {"<propertyId>": <breakdown dict>}}`. A property whose quote raises is returned with `{"error": "...", "total": str(base × nights)}` rather than omitted.

- [ ] **Step 1: Write the failing test**

```python
class QuotesEndpointTests(TestCase):
    def setUp(self):
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property()

    def test_returns_a_breakdown_per_property(self):
        response = self.client.post(
            "/api/properties/quotes/",
            data=json.dumps({
                "checkIn": day(30).isoformat(),
                "checkOut": day(37).isoformat(),
                "propertyIds": [str(self.prop.id)],
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        quote = response.json()["quotes"][str(self.prop.id)]
        self.assertEqual(quote["total"], "297.50")
        self.assertEqual(quote["averageNightlyRate"], "42.50")

    def test_requires_a_role(self):
        self.assertIn(Client().post("/api/properties/quotes/").status_code, (401, 403))
```

Note the response uses **camelCase** `averageNightlyRate` — the quotes endpoint is a staff API and follows the project's camelCase convention, unlike the public breakdown blob whose snake_case keys are frozen by stored data. Convert with an explicit mapping in the view, not a generic transformer.

- [ ] **Step 2: Run it to make sure it fails, then implement**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_api.QuotesEndpointTests -v 2
```

Implement: `require_roles` first; parse dates with the same `_parse_date` helper the booking views use; default `propertyIds` to every active AirStay property; wrap each `calculate_price` call in `try/except Exception` and fall back to `{"error": str(exc), "total": str(prop.base_price_eur * nights)}`.

- [ ] **Step 3: Run the suite and commit**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms -v 2
git add backend/pms
git commit -m "Add staff quotes endpoint for rule-adjusted search prices"
```

---

### Task 11: Frontend types and API client

**Files:**
- Modify: `frontend/src/types/domain.ts`
- Modify: `frontend/src/api/bookingEngine.ts`
- Modify: `frontend/src/api/bookingApi.ts` (breakdown type)

**Interfaces:**
- Produces: `PricingGroupRecord`, `StayConstraintRecord`, extended `PricingRuleRecord`, `PricingRulePayload`, `StayConstraintPayload`, `QuoteRecord`; and the API functions `fetchPricingGroups`, `createPricingGroup`, `updatePricingGroup`, `deletePricingGroup`, `reorderPricingGroups`, `reorderPricingRules`, `fetchStayConstraints`, `createStayConstraint`, `updateStayConstraint`, `deleteStayConstraint`, `fetchQuotes`. `PromoCodeRecord`, `PromoCodePayload`, `fetchPromoCodes`, `createPromoCode`, `updatePromoCode`, `deletePromoCode` and `BookingSiteSettingsRecord.nonRefundableDiscountPct` are deleted.

- [ ] **Step 1: Update the types**

In `domain.ts`, replace `PricingRuleRecord` (lines 387-402) and delete `PromoCodeRecord` (404-416):

```ts
export type PricingGroupRecord = {
  id: string
  name: string
  sortOrder: number
  behaviour: 'stack' | 'exclusive'
  ruleCount: number
}

export type PricingRuleRecord = {
  id: string
  name: string
  groupId: string
  ruleType: 'long_stay' | 'seasonal' | 'last_minute' | 'non_refundable' | 'promo' | 'manual'
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  enabled: boolean
  sortOrder: number
  application: 'per_night' | 'whole_stay'
  isFinal: boolean
  minNights: number | null
  daysBeforeCheckin: number | null
  startDate: string | null
  endDate: string | null
  adjustmentType: '' | 'fixed_price' | 'pct_increase' | 'pct_decrease' | 'fixed_increase' | 'fixed_decrease'
  adjustmentValue: string | null
  code: string | null
  usageLimit: number | null
  usageCount: number
  minSubtotalEur: string | null
  createdAt: string
}

export type StayConstraintRecord = {
  id: string
  kind: 'min_nights'
  value: number
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  startDate: string | null
  endDate: string | null
  enabled: boolean
  createdAt: string
}
```

Delete `nonRefundableDiscountPct` from `BookingSiteSettingsRecord` (line 437).

In `bookingApi.ts`, extend `PublicPriceBreakdown` (lines 5-11) with the new **optional** snake_case keys — optional because pre-migration stored blobs lack them:

```ts
export interface PublicPriceBreakdown {
  total: string
  nights: number
  effective_nightly: string
  errors: string[]
  average_nightly_rate?: string
  protected_total?: string
  nightly_breakdown?: { date: string; rate: string; locked: boolean; ruleIds: string[] }[]
  rules?: {
    id: string
    name: string
    type: string
    group: string
    application: string
    status: 'applied' | 'not_eligible' | 'overridden' | 'locked_out' | 'skipped_invalid'
    reason: string
    amount: string
  }[]
  [key: string]: unknown
}
```

- [ ] **Step 2: Update the API client**

In `bookingEngine.ts`, delete the four promo functions (lines 96-113) and `PromoCodePayload` (lines 31-40), replace `PricingRulePayload` to match the new record, and add the new functions following the existing shape exactly — each one `await`s the shared request helper the file already uses and returns the unwrapped payload key.

- [ ] **Step 3: Verify the type errors point only where expected**

```bash
cd frontend && npx tsc -b --force
```

Expected: FAIL, with errors confined to `PricingRulesPage.tsx` (uses the deleted promo functions) and to the settings screen if it reads `nonRefundableDiscountPct`. Any error in a third file means something else consumed these types — report it before continuing.

- [ ] **Step 4: Remove the non-refundable field from the settings screen**

Task 8 dropped `nonRefundableDiscountPct` from the API. Find its editor and delete the form control and its state:

```bash
cd frontend && rg -n "nonRefundableDiscountPct" src/
```

If the only hit is the (now deleted) type definition, there is no editor to remove — the scout found none — and this step is a no-op. Record which it was.

- [ ] **Step 5: Commit — but not broken**

This task deliberately leaves `PricingRulesPage.tsx` uncompilable, and committing a tree that fails `tsc` breaks bisect and blocks anyone else pulling. Two options, both acceptable:

- **Preferred:** do not commit yet. Carry the change into Task 12, which repairs the page, and make one commit there covering both.
- If you must commit now (e.g. to hand off), stub the page: replace the promo tab's body with `return null` and comment `// rebuilt in Task 12`, so the build passes.

State in the commit message which you chose:

```bash
cd frontend && npx tsc -b --force && npm run build   # must pass before committing
git add frontend/src
git commit -m "Update frontend types and API client for unified pricing"
```

---

### Task 12: Rebuild PricingRulesPage around groups

**Files:**
- Rewrite: `frontend/src/pages/PricingRulesPage.tsx`
- Create: `frontend/src/components/pricing/GroupSection.tsx`, `frontend/src/components/pricing/RuleRow.tsx`
- Modify: `frontend/src/styles/pricing-rules.css`

**Interfaces:**
- Consumes: everything from Task 11.
- Produces: `GroupSection` props `{group, rules, properties, onMoveGroup, onEditGroup, onDeleteGroup, onSaveRule, onDeleteRule, onMoveRule, onAddRule}`; `RuleRow` props `{rule, properties, onSave, onDelete, onMove, isFirst, isLast}`.

- [ ] **Step 1: Delete what the model replaced**

Remove `DEFAULT_LONG_STAY_TIERS` (lines 29-36), `handleAddDefaultTiers` (103-120), the "Add default tiers" button (227-235) and the `default-tiers-note` block (242-246). The six tiers are seeded rows now; a button that re-creates them would produce duplicates.

- [ ] **Step 2: Replace tabs with ordered group sections**

The page becomes: a header, a one-line explainer, then `groups.map(group => <GroupSection .../>)`, then a "Stay restrictions" section for `StayConstraint` rows. Keep the existing global class names (`pricing-page`, `pricing-panel`, `pricing-rule-row`, `pricing-form`, `btn btn-sm btn-outline`) so the stylesheet keeps working; add new ones only for the group header and the drag-free reorder controls.

The explainer text, verbatim:

```tsx
<p className="pricing-help">
  Groups are evaluated top to bottom. A <strong>Stack</strong> group applies every
  matching rule in order; an <strong>Exclusive</strong> group applies only the first
  matching rule. A rule marked <strong>final price</strong> locks the nights it covers,
  so no later group and no whole-stay discount can change them.
</p>
```

- [ ] **Step 3: Make every rule field editable**

`RuleRow` renders a read-only summary plus an Edit button that swaps in a form with: name, enabled, application, `isFinal` (disabled unless per-night, with the title "Only per-night rules can set a final price"), adjustment type and value, date range, min nights, days before check-in, scope with its property/bedroom target, and for promo rules the code, usage limit, read-only usage count and minimum subtotal. Save calls `updatePricingRule(rule.id, patch)` and surfaces a 400's `error` string inline above the form — that is where the validator's messages land.

- [ ] **Step 4: Wire the reorder controls**

Up/down buttons on each group and each rule. Moving builds the new id order locally, calls `reorderPricingGroups(ids)` or `reorderPricingRules(groupId, ids)`, then reloads. Disable the up button on the first item and the down button on the last.

- [ ] **Step 5: Surface the over-limit approval warning**

Task 7 made `POST /api/booking-requests/<id>/approve/` return a `warning` string when a promo has just passed its usage limit. Nothing displays it yet, so the operator never learns. In `frontend/src/pages/BookingRequestsPage.tsx`, where the approve call's response is handled, show `response.warning` when present using whatever inline notice the page already uses for messages. Add `warning?: string` to the approve call's return type in the API client.

- [ ] **Step 6: Verify**

```bash
cd frontend && npx tsc -b --force && npm run build
```

Then in the dev server, confirm by hand: the four seeded groups appear in order with Stay Discounts marked Exclusive; the six long-stay tiers are listed under it and are editable; editing a rule's percentage and reloading shows the new value; setting `isFinal` on a whole-stay rule shows the validator's error instead of saving; deleting a non-empty group shows the rule-count error; the Stay restrictions section creates and deletes a minimum-nights row.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "Rebuild the pricing rules page around ordered groups"
```

---

### Task 13: Quoted prices in staff search

**Files:**
- Modify: `frontend/src/pages/AvailabilityPage.tsx`

**Interfaces:**
- Consumes: `fetchQuotes` from Task 11.

- [ ] **Step 1: Fetch quotes alongside availability**

After a search returns, call `fetchQuotes(checkIn, checkOut, ids)` for the listed properties and hold the result in state keyed by property id.

- [ ] **Step 2: Show the quoted price**

Replace line 313's `basePriceEur` render with the quote's `averageNightlyRate`, falling back to `basePriceEur` while the quote is in flight or if it carried an `error`. When `quote.total` differs from `averageNightlyRate × nights`, show the total underneath as `Total €X for N nights`.

- [ ] **Step 3: Prefill the booking modal**

At **all four** `nightlyPrice: '0.00'` sites (around lines 238, 381, 428, 591 — grep `nightlyPrice: '0.00'` rather than trusting the numbers), use `quote?.averageNightlyRate ?? property.basePriceEur`. The field stays editable — staff can still overwrite it.

- [ ] **Step 4: Verify**

```bash
cd frontend && npx tsc -b --force && npm run build
```

By hand: search dates covered by a seasonal rule and confirm the card shows the adjusted rate, not the base price; open the book modal from each of the four entry points and confirm the price is prefilled and editable.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "Quote rule-adjusted prices in staff search and prefill the booking form"
```

---

### Task 14: "How this price was calculated" for guests

**Files:**
- Modify: `frontend/src/components/client/ApartmentDetailModal.tsx`
- Modify: `frontend/src/components/client/ApartmentDetailModal.module.css`

- [ ] **Step 1: Keep the existing rows exactly as they are**

Lines 267-287 stay untouched. The explainer is additive, below `bdTotal`.

- [ ] **Step 2: Add the collapsible explainer**

Render only when `bd?.rules?.length` — old stored blobs have no `rules` and must show nothing rather than an empty box:

```tsx
{applied.length > 0 && (
  <details className={styles.priceExplainer}>
    <summary>How this price was calculated</summary>
    {nightly.map(n => (
      <div key={n.date} className={styles.bdRow}>
        <span className={styles.bdLabel}>{formatDate(n.date)}</span>
        <span>€{Math.round(Number(n.rate))}</span>
      </div>
    ))}
    {applied.map(r => (
      <div key={r.id} className={styles.bdRow}>
        <span className={styles.bdLabel}>{r.name}</span>
        <span>{Number(r.amount) < 0 ? '−' : ''}€{Math.abs(Math.round(Number(r.amount)))}</span>
      </div>
    ))}
  </details>
)}
```

where `applied = (bd?.rules ?? []).filter(r => r.status === 'applied' && Number(r.amount) !== 0)`. Skipped rules and their reasons are **not** shown to guests — that detail is for staff, and a guest reading "you did not qualify for the weekly discount" is a worse experience than silence.

- [ ] **Step 3: Style it**

Add `.priceExplainer` to the CSS module matching the existing palette (`var(--c-ink)`, `var(--c-divider)`), with `summary { cursor: pointer; }` and the same 0.9rem body size as `.bdRow`.

- [ ] **Step 4: Verify**

```bash
cd frontend && npx tsc -b --force && npm run build
```

By hand: pick dates where a seasonal rule and a long-stay tier both apply, open the modal, expand the explainer, and check the per-night rates sum to the subtotal shown above. Then open a booking request created **before** this release from the requests screen and confirm its stored breakdown still renders with no explainer and no crash.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "Show guests how their price was calculated"
```

---

### Task 15: Full verification

- [ ] **Step 1: Backend**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms -v 2
```

Expected: PASS, with the count higher than the 84 tests present before this work. Paste the real output — never assert it passed without it.

- [ ] **Step 2: Frontend**

```bash
cd frontend && npx tsc -b --force && npm run build
```

Expected: PASS with no errors.

- [ ] **Step 3: Migrations apply forward from a real database**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py migrate pms && .\.venv\Scripts\python.exe manage.py showmigrations pms
```

Expected: 0027, 0028, 0029 all ticked, no error.

- [ ] **Step 4: Check for stragglers**

```bash
cd backend && rg -n "promo_code_obj|_seasonal_nightly|_long_stay_discount_pct|_last_minute_discount_pct|_promo_discount" pms/ --glob '!migrations/*'
rg -n "req\.promo_rule|\.promo_rule_id|select_related\([^)]*promo_rule" pms/ --glob '!migrations/*'
cd ../frontend && rg -n "promoCode|nonRefundableDiscountPct" src/
```

Expected backend: no hits. Expected frontend: only `BookingRequestRecord.promoCode` and its render in `BookingRequestsPage.tsx:150`, which are still correct — the field now carries the promo rule's code.

- [ ] **Step 5: Update the documented test count**

`CLAUDE.md:38` says `# 80 tests`. It was already stale at 84 before this work. Set it to the real number from step 1.

- [ ] **Step 6: Manual smoke test of the money paths**

With the dev servers running: quote a stay on the guest site and confirm the total matches the explainer; enter a promo code and confirm it applies; create a booking request with that code and confirm `usageCount` is still 0 on the pricing page; approve it and confirm `usageCount` is 1; reject a second one and confirm it stays at 1.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "Update the documented test count"
```
