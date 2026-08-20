# Search & pricing cleanup — design

**Date:** 2026-08-09
**Status:** Partially superseded — see
`2026-08-20-unified-pricing-engine-design.md`, which replaces all of
"Feature 4 — pricing that actually applies" (and tasks 3–9 of this spec's
plan) with a fully configurable group/rule engine. Features 2–3 below
(general location, chart removal) remain valid and are carried into the new
spec's plan.
**Scope:** Spec 2 of 2. Build **before**
`2026-08-09-guest-message-drafts-design.md`, which depends on staff search
quoting rule-adjusted prices.

## Problem

Three unrelated complaints about the same screens:

1. Every apartment carries its own location label, but they are all in one
   building — so guests see a per-apartment location that means nothing.
2. Two charts on Reports (stay length, booking lead time) are not used.
3. Pricing rules barely work. They do not reach staff search at all, only one
   seasonal rule can ever apply, a rule must span the entire stay to count,
   rules cannot be edited after creation, and the booking form prefills
   `0.00`.

Feature 3 is a deletion, feature 2 is a display change, feature 4 is the real
work.

## Feature 2 — one general location

All apartments share a building, so they share a location.

`locationLabel` is shown per-property at `ApartmentDetailModal.tsx:106` and
`MapPage.tsx:95`. Both switch to the building location already stored in
`BookingSiteSettings` (`building_name`, `building_address`).

The per-property `location_label`, `latitude` and `longitude` columns **stay**.
The map privacy circle needs per-apartment coordinates, and keeping the columns
makes this reversible without a data-losing migration. They simply stop being
displayed to guests.

Admins edit the general location in one place: Admin Panel → Company profile.

## Feature 3 — remove two charts

Delete, with no replacement:

- `StayLengthChart` and `LeadTimeChart` — `InsightCharts.tsx:204-230`
- `stayLengthDistribution` and `leadTimeDistribution` —
  `insightCalculations.ts:83,101`
- Their render blocks — `ReportsPage.tsx:601-608`
- The now-unused imports in `ReportsPage.tsx:17,20`

Nothing else references them. No migration, no API change.

## Feature 4 — pricing that actually applies

### Per-night rates

The engine computes one rate for the whole stay (`_pricing.py:187`), and a
seasonal rule only matches if it spans the entire stay (`_pricing.py:45-50`).
Together these make the intended setup impossible: *fixed 56€ for 10 Jul–20
Aug* plus *+50% for 1–5 Aug* cannot charge 84€ for the 3rd–5th and 56€ for the
6th–7th of a 3–8 August stay.

`_seasonal_nightly(property, check_in, check_out)` becomes
`_nightly_rate(property, date)`, and `calculate_price` sums the nights:

```python
rates    = [_nightly_rate(property_obj, d) for d in nights_in(check_in, check_out)]
subtotal = sum(rates)
effective_nightly = (subtotal / nights).quantize(CENTS, ROUND_HALF_UP)  # average, display only
```

Everything downstream keeps operating on `subtotal` unchanged. Rules no longer
need to span the stay — each night asks which rules cover it.

### Stacking

Per night, applying matching rules in the operator's manual order:

1. Start at `base_price_eur`.
2. A **fixed-price** rule replaces the running rate and marks that night
   *protected*. A later fixed-price rule replaces it again — the last one in
   the order wins, which is what manual ordering exists to control.
3. **Increase / decrease** rules apply on top, compounding, consistent with how
   discounts already chain at `_pricing.py:189-196`.

So base 45, fixed 56, then +50% gives 84 for that night.

### Protected vs discountable

A fixed price means that night is worth exactly what was set, so automatic
discounts must not reduce it. But nights *without* a fixed price should still
earn their discount:

```python
protected    = sum(rate for rate, is_fixed in nights if is_fixed)
discountable = subtotal - protected
```

Long-stay, last-minute and non-refundable discounts apply to `discountable`
only. `protected` passes through to the total untouched.

Worked example — base 45€, 7 nights, last 5 fixed at 56€, 15% weekly tier
(`_pricing.py:16`):

| | |
|---|---|
| 2 nights × 45 | 90€ (discountable) |
| 5 nights × 56 | 280€ (protected) |
| Subtotal | 370€ |
| Long-stay 15% of 90 | −13.50€ |
| **Total** | **356.50€** |

An all-or-nothing rule was rejected: it would have charged 370€, penalising two
nights that had no fixed price.

**Promo codes still apply to the full remaining amount.** They are entered by
the guest, not set by the operator, and silently voiding one would look broken.

### Rule ordering

`PricingRule` gains `sort_order = PositiveIntegerField(default=0)`, with a
migration seeding existing rows by `created_at`.

Order is **display and application order** — it does not change which rules
match. It decides the sequence they compound in, and which fixed-price rule
wins when two cover the same night.

Reordering uses up/down buttons and `PATCH /api/pricing-rules/reorder/`
(`{"order": ["<id>", "<id>", ...]}`). Not drag-and-drop: fiddlier to build and
worse on touch.

### Editable rules

`PricingRulesPage` currently only toggles `enabled` (line 138). Every field
becomes editable in place — dates, adjustment type, adjustment value, scope,
min nights, discount percent — via `updatePricingRule`, which already exists in
`bookingEngine.ts:85` and is otherwise unused.

Percentage seasonal adjustments already work (`PCT_INCREASE` / `PCT_DECREASE`,
`_pricing.py:67-71`); they were simply not reachable from the UI. No engine work
is needed for them, only the form.

### Prices in staff search

`/availability` shows `basePriceEur`. It changes to call `calculate_price` per
property for the searched dates, so staff see the price a guest would be
quoted.

`openBookModal` prefills `nightlyPrice` with the computed average instead of
`'0.00'` — the "price pre-filled unless changed" requirement. Staff can still
overwrite it; the field stays editable.

### Price breakdown

Where nights differ, show the average nightly with an expandable per-night
list, following the existing `bdRow` / `bdTotal` markup in
`ApartmentDetailModal`.

## Error handling

| Case | Behaviour |
|---|---|
| No rule covers a night | That night is `base_price_eur`. |
| Two fixed-price rules cover one night | Last in the operator's order wins. |
| Rule with `adjustment_value` null | Skipped; the night keeps its running rate. |
| Every night protected | `discountable` is 0, so automatic discounts are 0. Promo still applies. |
| Stay longer than 365 nights | Rejected by existing booking-window validation; the loop is bounded by that. |
| `calculate_price` errors during search | Property is listed at base price with a warning, rather than vanishing from results. |

## Testing

- `_nightly_rate`: base with no rules; fixed price; percentage increase and
  decrease; fixed increase and decrease; two rules compounding in order; two
  fixed rules where the later wins.
- `calculate_price`: subtotal is the sum of nights, not one rate × nights; the
  worked example above returns exactly 356.50€; all-protected suppresses
  automatic discounts but not promo; a rule covering part of the stay affects
  only those nights.
- Ordering: `sort_order` changes the compounding sequence and therefore the
  price; the reorder endpoint persists it; role enforcement.
- Regression: the existing pricing tests must still pass, or be updated with a
  recorded reason where per-night pricing legitimately changes the answer.
- Frontend: search shows computed prices; booking modal prefills the computed
  rate; the two removed charts are gone and Reports still renders.

## Risks

**Quoted prices will move on the day this ships.** A rule that previously did
not match — because it did not span the whole stay — now applies to the nights
it covers. This is the point of the change, but it should not be a surprise.
Existing reservations are unaffected: they store their own `total_price_eur`.

**The existing pricing tests encode whole-stay behaviour.** Some will fail by
design. Each change must be justified rather than fixed by editing the
expected number.

## Out of scope

Per-guest pricing; length-of-stay pricing beyond the existing tiers; channel
rate parity; currencies other than EUR; drag-and-drop reordering; automatic
migration of existing rules into a new order beyond seeding by `created_at`.
