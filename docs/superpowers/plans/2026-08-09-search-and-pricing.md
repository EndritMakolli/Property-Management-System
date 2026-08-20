# Search & Pricing Cleanup Implementation Plan

> **SUPERSEDED — do not execute.** The unified pricing engine
> (`docs/superpowers/specs/2026-08-20-unified-pricing-engine-design.md`)
> replaces tasks 3–9 of this plan, and its own plan re-includes tasks 1–2
> (chart removal, general location). Kept for the design history only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pricing rules apply per-night everywhere including staff search, show one building location instead of per-apartment ones, and delete two unused Reports charts.

**Architecture:** The pricing engine moves from one rate per stay to one rate per night. `_seasonal_nightly(property, check_in, check_out)` is replaced by `_nightly_rate(property, date)`, and `calculate_price` sums the nights. Nights set by a fixed-price rule are "protected" and excluded from automatic discounts; everything downstream still consumes `subtotal`, so the discount chain, promo handling and all callers are unchanged.

**Tech Stack:** Django 5.2, Postgres, React 19 + TypeScript, Vite, recharts.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-search-and-pricing-design.md`
- Backend tests: `cd backend && .\.venv\Scripts\python.exe manage.py test pms`
- Frontend checks: `cd frontend && npx tsc -b --force && npm run build`
- Use the venv interpreter `backend\.venv\Scripts\python.exe`. The system `python` has no Django.
- All pricing goes through `calculate_price` in `views/_pricing.py`. Never add a second price calculation.
- Every new endpoint starts with `require_roles(...)`. There is no default-deny.
- Backend returns camelCase JSON. Frontend types live in `frontend/src/types/domain.ts`.
- Money is `Decimal`, quantized with `CENTS` and `ROUND_HALF_UP`. Never use float.
- Commit after each task. Do not push.

## Spec coverage

| Spec section | Task |
|---|---|
| Feature 3 — remove two charts | Task 1 |
| Feature 2 — one general location | Task 2 |
| Feature 4 — rule ordering (`sort_order`) | Tasks 3, 6, 7 |
| Feature 4 — per-night rates | Task 4 |
| Feature 4 — protected vs discountable | Task 5 |
| Feature 4 — editable rules | Task 7 |
| Feature 4 — prices in staff search, prefilled booking form | Task 8 |
| Feature 4 — Airbnb-style price breakdown | Task 9 |

Tasks 1 and 2 are independent of everything else and can be done in any
order. Tasks 3 → 4 → 5 are strictly sequential. Tasks 6–9 all depend on 5.

---

### Task 1: Remove the stay-length and lead-time charts

**Files:**
- Modify: `frontend/src/pages/ReportsPage.tsx` (imports ~17,20; render blocks ~601-608)
- Modify: `frontend/src/features/reports/InsightCharts.tsx` (delete lines ~202-230)
- Modify: `frontend/src/features/reports/insightCalculations.ts` (delete `stayLengthDistribution` ~83, `leadTimeDistribution` ~101)

**Interfaces:**
- Consumes: nothing
- Produces: nothing. Deletion only; no later task depends on this.

- [ ] **Step 1: Confirm nothing else imports them**

```bash
cd "c:/Users/PC/Desktop/Personal Work/Projects/Django +React/PMS"
grep -rn "StayLengthChart\|LeadTimeChart\|stayLengthDistribution\|leadTimeDistribution" frontend/src
```

Expected: matches only in the three files above. If anything else appears, stop and report it.

- [ ] **Step 2: Delete the two render blocks in `ReportsPage.tsx`**

Remove exactly these two `<div>` blocks:

```tsx
              <div>
                <h4>Stay length (all reservations)</h4>
                <StayLengthChart reservations={includedAllReservations} />
              </div>
              <div>
                <h4>Booking lead time (booked → check-in)</h4>
                <LeadTimeChart reservations={includedAllReservations} />
              </div>
```

- [ ] **Step 3: Remove `LeadTimeChart` and `StayLengthChart` from the import block in `ReportsPage.tsx`**

Leave the other imports from `../features/reports/InsightCharts` intact.

- [ ] **Step 4: Delete the two components in `InsightCharts.tsx`**

Delete the section beginning with the comment `/* (c) Stay length + booking lead time */` through the end of `LeadTimeChart`. Then remove `leadTimeDistribution` and `stayLengthDistribution` from that file's import from `./insightCalculations`.

- [ ] **Step 5: Delete the two calculators in `insightCalculations.ts`**

Delete `stayLengthDistribution` and `leadTimeDistribution` in full.

- [ ] **Step 6: Verify the build is clean**

```bash
cd frontend && npx tsc -b --force && npm run build
```

Expected: no errors. TypeScript will flag any import you missed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "Remove unused stay-length and booking lead-time charts"
```

---

### Task 2: Show one building location instead of per-apartment

**Files:**
- Modify: `frontend/src/components/client/ApartmentDetailModal.tsx:106`
- Modify: `frontend/src/pages/client/MapPage.tsx:95`
- Modify: `backend/pms/views/_booking_public.py` (`booking_settings`, add `buildingName`/`buildingAddress` if absent)

**Interfaces:**
- Consumes: `BookingSiteSettings.building_name`, `BookingSiteSettings.building_address` (existing model fields)
- Produces: `/api/booking/settings/` returns `buildingName` and `buildingAddress` strings. Task 8 does not depend on this.

- [ ] **Step 1: Confirm the settings endpoint already returns the building fields**

```bash
grep -n "buildingName\|buildingAddress" backend/pms/views/_booking_public.py
```

Expected: both present in `booking_settings`. If missing, add them to that JsonResponse alongside `whatsappNumber`.

- [ ] **Step 2: Make `ApartmentDetailModal` take the general location as a prop**

Add to its `Props`:

```tsx
  generalLocation?: string
```

Replace line 106:

```tsx
  const location = generalLocation?.trim() || property.locationLabel?.trim() || 'Prishtina, Kosovo'
```

The per-property fallback stays so nothing breaks if settings have not loaded.

- [ ] **Step 3: Pass it from both callers**

`ClientHomePage.tsx` and `MapPage.tsx` both render `ApartmentDetailModal`. `MapPage` already fetches `/api/booking/settings/`; store `buildingAddress` in state and pass it. In `ClientHomePage`, add the same fetch (mirror `MapPage.tsx:37-46`) and pass it.

- [ ] **Step 4: Use it on the map cards**

`MapPage.tsx:95` currently reads `property.locationLabel || 'Prishtina, Kosovo'`. Change to the building address with the same fallback chain.

- [ ] **Step 5: Verify**

```bash
cd frontend && npx tsc -b --force && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src backend/pms
git commit -m "Show the building location on guest pages instead of per-apartment labels"
```

---

### Task 3: Add `sort_order` to PricingRule

**Files:**
- Modify: `backend/pms/model_defs/booking.py` (`PricingRule`, after `enabled`)
- Create: `backend/pms/migrations/0027_pricingrule_sort_order.py` (generated)
- Modify: `backend/pms/views/_booking_pms.py` (`_serialize_pricing_rule`, `pricing_rule_list`)
- Test: `backend/pms/tests_pricing_rules.py` (new file)

**Interfaces:**
- Consumes: existing `PricingRule` model
- Produces: `PricingRule.sort_order` (int, default 0). `_serialize_pricing_rule` gains `"sortOrder": rule.sort_order`. `pricing_rule_list` orders by `("sort_order", "created_at")`. Tasks 4, 5 and 7 depend on this ordering.

- [ ] **Step 1: Write the failing test**

Create `backend/pms/tests_pricing_rules.py`:

```python
"""Tests for pricing rule ordering and editing."""

import json

from django.contrib.auth.models import Group, User
from django.core.cache import cache
from django.test import Client, TestCase

from .models import PricingRule
from .tests import make_property


def make_admin(client, username="ruleadmin"):
    group, _ = Group.objects.get_or_create(name="Admin")
    user = User.objects.create_user(username=username, password="corr3ct-horse-battery")
    user.groups.add(group)
    client.force_login(user)
    return user


class PricingRuleOrderingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        make_admin(self.client)
        self.prop = make_property()

    def _rule(self, value, order=0):
        return PricingRule.objects.create(
            rule_type=PricingRule.RuleType.SEASONAL,
            scope=PricingRule.Scope.ALL,
            adjustment_type=PricingRule.AdjustmentType.PCT_INCREASE,
            adjustment_value=value,
            enabled=True,
            sort_order=order,
        )

    def test_rules_are_listed_in_sort_order(self):
        self._rule(10, order=2)
        self._rule(20, order=1)
        rules = self.client.get("/api/pricing-rules/").json()["pricingRules"]
        self.assertEqual(
            [r["adjustmentValue"] for r in rules], ["20.00", "10.00"]
        )

    def test_serializer_exposes_sort_order(self):
        self._rule(10, order=3)
        rule = self.client.get("/api/pricing-rules/").json()["pricingRules"][0]
        self.assertEqual(rule["sortOrder"], 3)
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules -v 2
```

Expected: FAIL — `PricingRule() got unexpected keyword arguments: 'sort_order'`.

- [ ] **Step 3: Add the field**

In `backend/pms/model_defs/booking.py`, inside `PricingRule`, immediately after `enabled`:

```python
    # Display and application order. Decides the sequence rules compound in
    # and which fixed-price rule wins when two cover the same night. It does
    # not change which rules match.
    sort_order = models.PositiveIntegerField(default=0)
```

And set the default ordering in its `Meta`:

```python
        ordering = ["sort_order", "created_at"]
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd backend
.\.venv\Scripts\python.exe manage.py makemigrations pms
.\.venv\Scripts\python.exe manage.py migrate pms
```

- [ ] **Step 5: Expose it in the serializer**

In `backend/pms/views/_booking_pms.py`, add to `_serialize_pricing_rule`:

```python
        "sortOrder": rule.sort_order,
```

And in `pricing_rule_list`, order the queryset explicitly:

```python
    rules = PricingRule.objects.order_by("sort_order", "created_at")
```

- [ ] **Step 6: Run the tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules -v 2
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/pms
git commit -m "Add sort_order to PricingRule so rules apply in a chosen order"
```

---

### Task 4: Per-night rate resolution

**Files:**
- Modify: `backend/pms/views/_pricing.py` (replace `_seasonal_nightly` ~33-77)
- Test: `backend/pms/tests_pricing_rules.py`

**Interfaces:**
- Consumes: `PricingRule.sort_order` from Task 3
- Produces: `_nightly_rate(property_obj, day) -> (Decimal, bool)` returning the rate for that date and whether a fixed-price rule set it. Task 5 consumes this.

- [ ] **Step 1: Write the failing tests**

Append to `backend/pms/tests_pricing_rules.py`:

```python
from datetime import date
from decimal import Decimal

from .views._pricing import _nightly_rate


class NightlyRateTests(TestCase):
    def setUp(self):
        cache.clear()
        self.prop = make_property(base_price_eur=Decimal("45.00"))

    def _seasonal(self, adj_type, value, start, end, order=0):
        return PricingRule.objects.create(
            rule_type=PricingRule.RuleType.SEASONAL,
            scope=PricingRule.Scope.ALL,
            adjustment_type=adj_type,
            adjustment_value=Decimal(str(value)),
            start_date=start,
            end_date=end,
            enabled=True,
            sort_order=order,
        )

    def test_no_rules_returns_base_price_unprotected(self):
        rate, protected = _nightly_rate(self.prop, date(2026, 8, 3))
        self.assertEqual(rate, Decimal("45.00"))
        self.assertFalse(protected)

    def test_fixed_price_sets_rate_and_protects(self):
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 56,
                       date(2026, 7, 10), date(2026, 8, 20))
        rate, protected = _nightly_rate(self.prop, date(2026, 8, 3))
        self.assertEqual(rate, Decimal("56.00"))
        self.assertTrue(protected)

    def test_increase_compounds_on_fixed_price(self):
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 56,
                       date(2026, 7, 10), date(2026, 8, 20), order=1)
        self._seasonal(PricingRule.AdjustmentType.PCT_INCREASE, 50,
                       date(2026, 8, 1), date(2026, 8, 5), order=2)
        rate, protected = _nightly_rate(self.prop, date(2026, 8, 3))
        self.assertEqual(rate, Decimal("84.00"))
        self.assertTrue(protected)

    def test_rule_outside_the_date_does_not_apply(self):
        self._seasonal(PricingRule.AdjustmentType.PCT_INCREASE, 50,
                       date(2026, 8, 1), date(2026, 8, 5))
        rate, _ = _nightly_rate(self.prop, date(2026, 8, 7))
        self.assertEqual(rate, Decimal("45.00"))

    def test_two_percentages_compound_in_sort_order(self):
        self._seasonal(PricingRule.AdjustmentType.PCT_INCREASE, 20,
                       date(2026, 8, 1), date(2026, 8, 31), order=1)
        self._seasonal(PricingRule.AdjustmentType.PCT_INCREASE, 10,
                       date(2026, 8, 1), date(2026, 8, 31), order=2)
        rate, _ = _nightly_rate(self.prop, date(2026, 8, 3))
        # 45 * 1.20 = 54.00, then * 1.10 = 59.40
        self.assertEqual(rate, Decimal("59.40"))

    def test_later_fixed_price_wins(self):
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 56,
                       date(2026, 8, 1), date(2026, 8, 31), order=1)
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 70,
                       date(2026, 8, 1), date(2026, 8, 31), order=2)
        rate, protected = _nightly_rate(self.prop, date(2026, 8, 3))
        self.assertEqual(rate, Decimal("70.00"))
        self.assertTrue(protected)

    def test_disabled_rule_is_ignored(self):
        rule = self._seasonal(PricingRule.AdjustmentType.PCT_INCREASE, 50,
                              date(2026, 8, 1), date(2026, 8, 31))
        PricingRule.objects.filter(pk=rule.pk).update(enabled=False)
        rate, _ = _nightly_rate(self.prop, date(2026, 8, 3))
        self.assertEqual(rate, Decimal("45.00"))
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules.NightlyRateTests -v 2
```

Expected: FAIL — `cannot import name '_nightly_rate'`.

- [ ] **Step 3: Implement `_nightly_rate`**

Replace `_seasonal_nightly` in `backend/pms/views/_pricing.py` with:

```python
def _nightly_rate(property_obj, day):
    """Return (rate, protected) for one night.

    Every enabled seasonal rule covering `day` and matching the property is
    applied in sort_order. A fixed-price rule replaces the running rate and
    marks the night protected, so automatic discounts leave it alone; later
    percentage rules still compound on top of it.

    Rules are matched per night rather than per stay: a rule covering part of
    a stay affects only the nights it covers.
    """
    rate = property_obj.base_price_eur
    protected = False

    rules = PricingRule.objects.filter(
        rule_type=PricingRule.RuleType.SEASONAL,
        enabled=True,
        start_date__lte=day,
        end_date__gte=day,
    ).select_related("property").order_by("sort_order", "created_at")

    for rule in rules:
        if not _match_scope(rule, property_obj):
            continue
        value = rule.adjustment_value
        if value is None:
            continue
        adj = rule.adjustment_type
        if adj == PricingRule.AdjustmentType.FIXED_PRICE:
            rate = value
            protected = True
        elif adj == PricingRule.AdjustmentType.PCT_INCREASE:
            rate = rate * (1 + value / 100)
        elif adj == PricingRule.AdjustmentType.PCT_DECREASE:
            rate = rate * (1 - value / 100)
        elif adj == PricingRule.AdjustmentType.FIXED_INCREASE:
            rate = rate + value
        elif adj == PricingRule.AdjustmentType.FIXED_DECREASE:
            rate = max(rate - value, Decimal("0"))

    return rate.quantize(CENTS, ROUND_HALF_UP), protected
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules.NightlyRateTests -v 2
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/pms
git commit -m "Price each night from the rules covering that date"
```

---

### Task 5: Sum nights in calculate_price and protect fixed nights

**Files:**
- Modify: `backend/pms/views/_pricing.py` (`calculate_price` ~170-244)
- Test: `backend/pms/tests_pricing_rules.py`

**Interfaces:**
- Consumes: `_nightly_rate(property_obj, day) -> (Decimal, bool)` from Task 4
- Produces: `calculate_price(...)` returns the same dict shape as before, with `effective_nightly` now the average. Adds `"protected_total"` (string Decimal). Tasks 8 and 9 consume `subtotal`, `total`, `effective_nightly`, `protected_total`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/pms/tests_pricing_rules.py`:

```python
from .views._pricing import calculate_price


class PerNightCalculatePriceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.prop = make_property(base_price_eur=Decimal("45.00"))

    def _seasonal(self, adj_type, value, start, end, order=0):
        return PricingRule.objects.create(
            rule_type=PricingRule.RuleType.SEASONAL,
            scope=PricingRule.Scope.ALL,
            adjustment_type=adj_type,
            adjustment_value=Decimal(str(value)),
            start_date=start, end_date=end, enabled=True, sort_order=order,
        )

    def test_subtotal_is_the_sum_of_nights_not_one_rate(self):
        # 3-8 Aug: fixed 56 all month, +50% only 1-5 Aug.
        # Nights 3,4,5 = 84 ; nights 6,7 = 56 -> 364
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 56,
                       date(2026, 7, 10), date(2026, 8, 20), order=1)
        self._seasonal(PricingRule.AdjustmentType.PCT_INCREASE, 50,
                       date(2026, 8, 1), date(2026, 8, 5), order=2)
        bd = calculate_price(self.prop, date(2026, 8, 3), date(2026, 8, 8))
        self.assertEqual(bd["nights"], 5)
        self.assertEqual(bd["subtotal"], "364.00")

    def test_fixed_nights_are_protected_from_the_weekly_discount(self):
        # 7 nights, last 5 fixed at 56, first 2 at base 45.
        # discountable 90, 15% long-stay -> 13.50 off. Total 356.50
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 56,
                       date(2026, 8, 3), date(2026, 8, 20))
        bd = calculate_price(self.prop, date(2026, 8, 1), date(2026, 8, 8))
        self.assertEqual(bd["subtotal"], "370.00")
        self.assertEqual(bd["protected_total"], "280.00")
        self.assertEqual(bd["long_stay_amount"], "13.50")
        self.assertEqual(bd["total"], "356.50")

    def test_all_nights_protected_means_no_automatic_discount(self):
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 56,
                       date(2026, 7, 1), date(2026, 9, 1))
        bd = calculate_price(self.prop, date(2026, 8, 1), date(2026, 8, 8))
        self.assertEqual(bd["long_stay_amount"], "0.00")
        self.assertEqual(bd["total"], "392.00")

    def test_effective_nightly_is_the_average(self):
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 56,
                       date(2026, 7, 10), date(2026, 8, 20), order=1)
        self._seasonal(PricingRule.AdjustmentType.PCT_INCREASE, 50,
                       date(2026, 8, 1), date(2026, 8, 5), order=2)
        bd = calculate_price(self.prop, date(2026, 8, 3), date(2026, 8, 8))
        self.assertEqual(bd["effective_nightly"], "72.80")   # 364 / 5
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules.PerNightCalculatePriceTests -v 2
```

Expected: FAIL — `KeyError: 'protected_total'` or a wrong subtotal.

- [ ] **Step 3: Rewrite the top of `calculate_price`**

Replace the base-rate and subtotal section (currently steps 1–3 of the function) with:

```python
    # 1-3. Price every night from the rules covering that date.
    nightly = []
    for offset in range((check_out - check_in).days):
        day = check_in + timedelta(days=offset)
        nightly.append(_nightly_rate(property_obj, day))

    base_nightly = property_obj.base_price_eur
    subtotal = sum((rate for rate, _ in nightly), Decimal("0")).quantize(CENTS, ROUND_HALF_UP)
    protected_total = sum(
        (rate for rate, is_fixed in nightly if is_fixed), Decimal("0")
    ).quantize(CENTS, ROUND_HALF_UP)
    # A fixed price means that night is worth exactly what was set, so
    # automatic discounts apply only to the rest of the stay.
    discountable = subtotal - protected_total
    effective_nightly = (
        (subtotal / nights).quantize(CENTS, ROUND_HALF_UP) if nights else base_nightly
    )
    has_seasonal = any(rate != base_nightly for rate, _ in nightly)
```

Add `from datetime import timedelta` at the top of the file if absent.

- [ ] **Step 4: Point the discount chain at `discountable`**

Change the three automatic discounts to compute against `discountable` rather than `subtotal`, keeping the chain order:

```python
    long_stay_pct = _long_stay_discount_pct(property_obj, nights)
    long_stay_amount = (discountable * long_stay_pct / 100).quantize(CENTS, ROUND_HALF_UP)

    after_long_stay = discountable - long_stay_amount
    last_minute_pct = _last_minute_discount_pct(property_obj, check_in)
    last_minute_amount = (after_long_stay * last_minute_pct / 100).quantize(CENTS, ROUND_HALF_UP)

    settings = BookingSiteSettings.get()
    non_refundable_pct = settings.non_refundable_discount_pct if is_non_refundable else Decimal("0")
    after_discounts = after_long_stay - last_minute_amount
    non_refundable_amount = (after_discounts * non_refundable_pct / 100).quantize(CENTS, ROUND_HALF_UP)

    # Protected nights rejoin the total before the promo code, which is
    # guest-entered and must not be silently voided by operator pricing.
    after_non_refundable = (after_discounts - non_refundable_amount) + protected_total
    promo_amount = _promo_discount(promo_code_obj, after_non_refundable)
```

- [ ] **Step 5: Add `protected_total` to the returned dict**

Alongside `"subtotal"`:

```python
        "protected_total": str(protected_total),
```

- [ ] **Step 6: Run the new tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules -v 2
```

Expected: PASS.

- [ ] **Step 7: Run the whole suite and triage**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms
```

Some existing tests in `pms/tests.py` encode whole-stay behaviour and may fail. For each failure, decide and record in the commit message whether the new number is correct. Do **not** simply edit expected values to match output — confirm the arithmetic by hand first.

- [ ] **Step 8: Commit**

```bash
git add backend/pms
git commit -m "Sum per-night rates in calculate_price and protect fixed-price nights"
```

---

### Task 6: Reorder endpoint

**Files:**
- Modify: `backend/pms/views/_booking_pms.py` (add `pricing_rule_reorder`)
- Modify: `backend/pms/views/__init__.py`, `backend/pms/urls.py`
- Test: `backend/pms/tests_pricing_rules.py`

**Interfaces:**
- Consumes: `PricingRule.sort_order` from Task 3
- Produces: `PATCH /api/pricing-rules/reorder/` accepting `{"order": ["<uuid>", ...]}`, returning `{"pricingRules": [...]}`. Task 7 calls it.

- [ ] **Step 1: Write the failing test**

```python
class PricingRuleReorderTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        make_admin(self.client, username="reorderadmin")

    def _rule(self, value, order):
        return PricingRule.objects.create(
            rule_type=PricingRule.RuleType.SEASONAL,
            scope=PricingRule.Scope.ALL,
            adjustment_type=PricingRule.AdjustmentType.PCT_INCREASE,
            adjustment_value=Decimal(str(value)),
            enabled=True, sort_order=order,
        )

    def test_reorder_persists_new_positions(self):
        a = self._rule(10, 1)
        b = self._rule(20, 2)
        resp = self.client.patch(
            "/api/pricing-rules/reorder/",
            data=json.dumps({"order": [str(b.id), str(a.id)]}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual((b.sort_order, a.sort_order), (0, 1))

    def test_reorder_requires_authentication(self):
        self.client.logout()
        resp = self.client.patch(
            "/api/pricing-rules/reorder/",
            data=json.dumps({"order": []}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 401)
```

- [ ] **Step 2: Run and watch it fail (404)**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules.PricingRuleReorderTests -v 2
```

- [ ] **Step 3: Implement the view**

In `backend/pms/views/_booking_pms.py`, modelled on `property_photo_reorder`:

```python
def pricing_rule_reorder(request):
    """PATCH — persist the operator's rule order.

    Order decides how rules compound and which fixed price wins; it does not
    change which rules match.
    """
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        payload = json_payload(request)
        ids = payload.get("order") or []
        with transaction.atomic():
            for index, rule_id in enumerate(ids):
                PricingRule.objects.filter(pk=rule_id).update(sort_order=index)
    except (ValidationError, ValueError) as error:
        return JsonResponse({"error": str(error)}, status=400)

    rules = PricingRule.objects.order_by("sort_order", "created_at")
    return JsonResponse({"pricingRules": [_serialize_pricing_rule(r) for r in rules]})
```

- [ ] **Step 4: Wire it up**

Add `pricing_rule_reorder` to the `_booking_pms` import block in `backend/pms/views/__init__.py`, and add to `backend/pms/urls.py` **above** the `<uuid:rule_id>` route so `reorder` is not captured as an id:

```python
    path("pricing-rules/reorder/", views.pricing_rule_reorder, name="pricing-rule-reorder"),
```

- [ ] **Step 5: Run the tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules -v 2
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/pms
git commit -m "Add endpoint to persist pricing rule order"
```

---

### Task 7: Editable and reorderable rules in the UI

**Files:**
- Modify: `frontend/src/pages/PricingRulesPage.tsx`
- Modify: `frontend/src/api/bookingEngine.ts` (add `reorderPricingRules`)
- Modify: `frontend/src/types/domain.ts` (`PricingRuleRecord` gains `sortOrder: number`)

**Interfaces:**
- Consumes: `PATCH /api/pricing-rules/reorder/` from Task 6; `updatePricingRule` (already at `bookingEngine.ts:85`)
- Produces: no backend surface. Terminal UI task.

- [ ] **Step 1: Add `sortOrder` to the type**

In `frontend/src/types/domain.ts`, add to `PricingRuleRecord`:

```ts
  sortOrder: number
```

- [ ] **Step 2: Add the API call**

In `frontend/src/api/bookingEngine.ts`:

```ts
export async function reorderPricingRules(order: string[]) {
  const data = await apiSend<{ pricingRules: PricingRuleRecord[] }>(
    '/api/pricing-rules/reorder/', 'PATCH', { order },
  )
  return data.pricingRules
}
```

- [ ] **Step 3: Add up/down controls**

In `PricingRulesPage.tsx`, for each rule row add two buttons calling a `move(index, direction)` helper that swaps the entry with its neighbour, then calls `reorderPricingRules` with the new id list and stores the response. Disable Up on the first row and Down on the last. Use `ChevronUp` / `ChevronDown` from `lucide-react`, matching the icon usage already in the file.

- [ ] **Step 4: Make each rule editable**

Replace the read-only display of each rule's fields with inputs bound to a per-row draft (mirror the `drafts` pattern in `AdminPanelPage.tsx:47-60`): start date, end date, adjustment type select, adjustment value, scope, min nights, discount percent. Add a Save button per row calling `updatePricingRule(id, draft)`, enabled only when that row is dirty.

- [ ] **Step 5: Explain the ordering in the UI**

Add one line of help text above the list so the behaviour is not a secret:

```tsx
<p className="admin-backup-desc">
  Rules apply top to bottom. A fixed price replaces the rate and is protected
  from automatic discounts; increases below it compound on top.
</p>
```

- [ ] **Step 6: Verify**

```bash
cd frontend && npx tsc -b --force && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "Make pricing rules editable and reorderable"
```

---

### Task 8: Use computed prices in staff search

**Files:**
- Modify: `backend/pms/views/_properties.py` (add `property_quote`)
- Modify: `backend/pms/views/__init__.py`, `backend/pms/urls.py`
- Modify: `frontend/src/pages/AvailabilityPage.tsx` (~262 price display, `openBookModal` ~182-189)
- Modify: `frontend/src/api/properties.ts`
- Test: `backend/pms/tests_pricing_rules.py`

**Interfaces:**
- Consumes: `calculate_price` from Task 5
- Produces: `GET /api/properties/quotes/?check_in=&check_out=` returning `{"quotes": {"<property id>": {"nightly": "72.80", "subtotal": "364.00", "total": "356.50"}}}`. Task 9 consumes it.

- [ ] **Step 1: Write the failing test**

```python
class PropertyQuoteTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        make_admin(self.client, username="quoteadmin")
        self.prop = make_property(base_price_eur=Decimal("45.00"))

    def test_quotes_return_computed_prices(self):
        resp = self.client.get("/api/properties/quotes/", {
            "check_in": "2026-08-03", "check_out": "2026-08-06",
        })
        self.assertEqual(resp.status_code, 200, resp.content)
        quote = resp.json()["quotes"][str(self.prop.id)]
        self.assertEqual(quote["subtotal"], "135.00")   # 3 x 45
        self.assertEqual(quote["nightly"], "45.00")

    def test_quotes_require_authentication(self):
        self.client.logout()
        self.assertEqual(
            self.client.get("/api/properties/quotes/").status_code, 401
        )
```

- [ ] **Step 2: Run and watch it fail (404)**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules.PropertyQuoteTests -v 2
```

- [ ] **Step 3: Implement the view**

In `backend/pms/views/_properties.py`:

```python
def property_quote(request):
    """GET — rule-adjusted prices for every active property over a date range.

    Staff search shows what a guest would be quoted, so the same
    calculate_price the booking flow uses is the only source of these numbers.
    """
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied

    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    try:
        check_in = date.fromisoformat(request.GET.get("check_in") or "")
        check_out = date.fromisoformat(request.GET.get("check_out") or "")
    except ValueError:
        return JsonResponse({"error": "Provide check_in and check_out as YYYY-MM-DD."}, status=400)

    if check_out <= check_in:
        return JsonResponse({"error": "Check-out must be after check-in."}, status=400)

    quotes = {}
    for prop in Property.objects.filter(active=True):
        breakdown = calculate_price(prop, check_in, check_out)
        quotes[str(prop.id)] = {
            "nightly": breakdown["effective_nightly"],
            "subtotal": breakdown["subtotal"],
            "total": breakdown["total"],
        }
    return JsonResponse({"quotes": quotes})
```

Add `from datetime import date` and `from ._pricing import calculate_price` to that module's imports.

- [ ] **Step 4: Wire it up**

Export `property_quote` in `backend/pms/views/__init__.py`, and register in `urls.py` **above** the `<uuid:property_id>` routes:

```python
    path("properties/quotes/", views.property_quote, name="property-quotes"),
```

- [ ] **Step 5: Run the tests**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules -v 2
```

- [ ] **Step 6: Fetch quotes on the search page**

In `frontend/src/api/properties.ts`:

```ts
export type PropertyQuote = { nightly: string; subtotal: string; total: string }

export async function fetchPropertyQuotes(checkIn: string, checkOut: string) {
  const params = new URLSearchParams({ check_in: checkIn, check_out: checkOut })
  const data = await apiGet<{ quotes: Record<string, PropertyQuote> }>(
    `/api/properties/quotes/?${params}`,
  )
  return data.quotes
}
```

In `AvailabilityPage.tsx`, add `quotes` state and fetch it whenever `checkIn`/`checkOut` change and `nights > 0`.

- [ ] **Step 7: Display the computed price**

Replace the card price (currently `Number(property.basePriceEur)`):

```tsx
<small>
  {quotes[property.id]
    ? `${Number(quotes[property.id].nightly).toFixed(0)} EUR per night · ${Number(quotes[property.id].total).toFixed(0)} EUR total`
    : `${Number(property.basePriceEur || 0).toFixed(0)} EUR per night`}
</small>
```

- [ ] **Step 8: Prefill the booking modal**

In `openBookModal`, replace `nightlyPrice: '0.00'` with the computed rate:

```tsx
      nightlyPrice: quotes[property.id]?.nightly ?? '0.00',
```

Do the same for the two other `setBookModal` calls (insights row and split-stay segments), using that property's quote.

- [ ] **Step 9: Verify**

```bash
cd frontend && npx tsc -b --force && npm run build
```

- [ ] **Step 10: Commit**

```bash
git add backend/pms frontend/src
git commit -m "Show rule-adjusted prices in staff search and prefill the booking form"
```

---

### Task 9: Per-night breakdown for guests

**Files:**
- Modify: `backend/pms/views/_pricing.py` (add `nightly_breakdown` to the returned dict)
- Modify: `frontend/src/api/bookingApi.ts` (`PublicPriceBreakdown`)
- Modify: `frontend/src/components/client/ApartmentDetailModal.tsx` (breakdown section ~236-256)
- Test: `backend/pms/tests_pricing_rules.py`

**Interfaces:**
- Consumes: `calculate_price` from Task 5
- Produces: `calculate_price(...)["nightly_breakdown"]` — a list of `{"date": "2026-08-03", "rate": "84.00"}`. Terminal task.

- [ ] **Step 1: Write the failing test**

```python
    def test_breakdown_lists_every_night(self):
        self._seasonal(PricingRule.AdjustmentType.FIXED_PRICE, 56,
                       date(2026, 7, 10), date(2026, 8, 20), order=1)
        self._seasonal(PricingRule.AdjustmentType.PCT_INCREASE, 50,
                       date(2026, 8, 1), date(2026, 8, 5), order=2)
        bd = calculate_price(self.prop, date(2026, 8, 3), date(2026, 8, 6))
        self.assertEqual(
            bd["nightly_breakdown"],
            [
                {"date": "2026-08-03", "rate": "84.00"},
                {"date": "2026-08-04", "rate": "84.00"},
                {"date": "2026-08-05", "rate": "84.00"},
            ],
        )
```

Add it to `PerNightCalculatePriceTests`.

- [ ] **Step 2: Run and watch it fail**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules.PerNightCalculatePriceTests -v 2
```

- [ ] **Step 3: Build the list while pricing**

In Task 5's loop, record the date alongside the rate, then add to the returned dict:

```python
        "nightly_breakdown": [
            {"date": (check_in + timedelta(days=i)).isoformat(), "rate": str(rate)}
            for i, (rate, _) in enumerate(nightly)
        ],
```

- [ ] **Step 4: Run the test**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms.tests_pricing_rules -v 2
```

- [ ] **Step 5: Type it on the frontend**

In `frontend/src/api/bookingApi.ts`, add to `PublicPriceBreakdown`:

```ts
  nightly_breakdown?: { date: string; rate: string }[]
```

- [ ] **Step 6: Show it when nights differ**

In `ApartmentDetailModal.tsx`, inside the existing breakdown block, replace the single `€{nightly} × {n} nights` row with an expandable one when rates vary:

```tsx
{(() => {
  const perNight = bd?.nightly_breakdown ?? []
  const varies = perNight.length > 1 && new Set(perNight.map((x) => x.rate)).size > 1
  if (!varies) {
    return (
      <div className={styles.bdRow}>
        <span className={styles.bdLabel}>€{nightly} × {n} {n === 1 ? 'night' : 'nights'}</span>
        <span>€{subtotal}</span>
      </div>
    )
  }
  return (
    <details>
      <summary className={styles.bdRow}>
        <span className={styles.bdLabel}>€{nightly} avg × {n} nights</span>
        <span>€{subtotal}</span>
      </summary>
      {perNight.map((x) => (
        <div className={styles.bdRow} key={x.date}>
          <span className={styles.bdLabel}>{x.date}</span>
          <span>€{Math.round(Number(x.rate))}</span>
        </div>
      ))}
    </details>
  )
})()}
```

- [ ] **Step 7: Verify everything**

```bash
cd backend && .\.venv\Scripts\python.exe manage.py test pms
cd ../frontend && npx tsc -b --force && npm run build
```

Expected: all backend tests pass, frontend builds clean.

- [ ] **Step 8: Commit**

```bash
git add backend/pms frontend/src
git commit -m "Show a per-night price breakdown when nightly rates differ"
```

---

## Done when

- Pricing rules apply per night, stack in the operator's order, and reach staff search.
- Fixed-price nights are protected from automatic discounts; other nights still earn them.
- Rules are editable and reorderable.
- The booking form prefills the computed rate.
- Guests see a per-night breakdown when rates vary.
- One building location shows on guest pages.
- The stay-length and lead-time charts are gone.
- `manage.py test pms` passes; `tsc -b` and `npm run build` are clean.
