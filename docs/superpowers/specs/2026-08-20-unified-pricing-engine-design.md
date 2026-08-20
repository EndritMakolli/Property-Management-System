# Unified pricing engine — design

**Date:** 2026-08-20
**Status:** Approved
**Supersedes:** the "Feature 4 — pricing that actually applies" section of
`2026-08-09-search-and-pricing-design.md` and tasks 3–9 of
`docs/superpowers/plans/2026-08-09-search-and-pricing.md`. Features 2–3 of
that spec (general location, chart removal) remain valid and are folded into
this spec's plan. `2026-08-09-guest-message-drafts-design.md` builds after
this lands.

## Problem

Every price adjustment lives in its own hardcoded slot. `calculate_price`
(`_pricing.py:170-244`) runs a fixed chain — seasonal → long-stay →
last-minute → non-refundable → promo — and nothing about that chain is
configurable:

- Only one seasonal rule can ever apply, and only if it spans the entire stay
  (`_pricing.py:45-50`).
- Long-stay tiers silently fall back to a hardcoded table
  (`_pricing.py:12-19`) that no screen shows.
- The non-refundable discount is a settings field with no UI and no tests.
- Promo codes are a separate model (`PromoCode`) with its own validation
  copy-pasted four times in `_booking_public.py` and a racy
  read-then-write `usage_count` increment.
- `MINIMUM_NIGHTS` — not a price at all — is wedged into `PricingRule`.
- Rules have no labels, no order, and no way to control how they interact.

Every new discount type means another hardcoded slot, another breakdown key,
and another interaction decision buried in Python.

## Solution

One model family, one engine:

```
PricingGroup (ordered, Stack | Exclusive)
  └── PricingRule (ordered within group, typed eligibility, one adjustment)
        ↓
Pass 1: nightly rates, group by group  →  is_final locks nights
Pass 2: whole-stay adjustments, group by group, on unlocked nights only
        ↓
breakdown: legacy keys + per-rule applied/overridden/locked-out/not-eligible
```

Seasonal pricing, fixed prices, long-stay tiers, last-minute, non-refundable,
promo codes, and manual discounts all become `PricingRule` rows. Adding a
future discount type means adding an eligibility check — never touching the
evaluation order, which the operator owns.

Non-price constraints (minimum nights today; maximum stay, closed-to-arrival
later) live **outside** pricing in `StayConstraint`. They gate whether a stay
is bookable; they never change its price.

## Priority vocabulary

To prevent the classic reversal bug, "priority" is banned from code and API.
The only ordering field is **`sort_order`**, ascending, on both groups and
rules:

> **The numerically smallest `sort_order` is evaluated first, and in an
> Exclusive group the eligible rule with the numerically smallest
> `sort_order` wins.** The highest number never wins anything. Ties break
> by `created_at`, oldest first, so evaluation order is always total and
> deterministic.

The UI shows rules top-to-bottom in ascending `sort_order` and labels the
semantics ("evaluated top to bottom; in an Exclusive group the first
eligible rule wins").

## Data model

### PricingGroup (new)

```python
class PricingGroup(TimeStampedModel):
    class Behaviour(models.TextChoices):
        STACK = "stack", "Stack — every eligible rule applies, in order"
        EXCLUSIVE = "exclusive", "Exclusive — the first eligible rule (lowest sort_order) applies"

    name = models.CharField(max_length=80, unique=True)
    sort_order = models.PositiveIntegerField(default=0)
    behaviour = models.CharField(max_length=10, choices=Behaviour.choices,
                                 default=Behaviour.STACK)

    class Meta:
        ordering = ["sort_order", "id"]
```

Groups are deletable only when empty (`on_delete=PROTECT` from rules, plus a
view-level check returning a clear error). Seeded by data migration:

| sort_order | Group | Behaviour | Holds after migration |
|---|---|---|---|
| 0 | Seasonal Pricing | Stack | seasonal rules (fixed prices, % and € adjustments) |
| 1 | Stay Discounts | **Exclusive** | long-stay tiers |
| 2 | Booking Discounts | Stack | last-minute, non-refundable |
| 3 | Promotions | Stack | promo codes, manual discounts |

The base rate is `Property.base_price_eur` — the implicit group before all
others, not a rule.

### PricingRule (extended)

New fields:

| Field | Type | Purpose |
|---|---|---|
| `name` | `CharField(120, blank=True)` | Human label for the UI and breakdown. Blank rows display an auto-generated label ("Seasonal +50% (1–5 Aug)") computed at serialization, never stored. |
| `group` | `FK(PricingGroup, PROTECT, related_name="rules")` | Nullable during migration, `null=False` after. |
| `sort_order` | `PositiveIntegerField(default=0)` | Order within the group. |
| `application` | `CharField`: `per_night` \| `whole_stay` | How the adjustment lands. Defaults per type (below) but editable. |
| `is_final` | `BooleanField(default=False)` | Per-night rules only. Locks the night at the end of the rule's group. |
| `code` | `CharField(50, null=True, blank=True)` + `UniqueConstraint(fields=["code"], condition=Q(code__isnull=False))` | Promo rules only. Stored uppercase; matched case-insensitively. |
| `usage_limit` | `PositiveIntegerField(null=True)` | Promo. Null = unlimited. |
| `usage_count` | `PositiveIntegerField(default=0)` | Promo. Incremented with `F("usage_count") + 1` — never read-then-write. |
| `min_subtotal_eur` | `DecimalField(10, 2, null=True)` | Promo eligibility: minimum Pass-1 subtotal. |

`RuleType` becomes: `SEASONAL`, `LONG_STAY`, `LAST_MINUTE`,
`NON_REFUNDABLE` *(new)*, `PROMO` *(new)*, `MANUAL` *(new)*.
`MINIMUM_NIGHTS` is removed after its rows migrate to `StayConstraint`.

`discount_pct` is **dropped**: every rule expresses its effect through the
existing `adjustment_type` + `adjustment_value` pair (`FIXED_PRICE`,
`PCT_INCREASE`, `PCT_DECREASE`, `FIXED_INCREASE`, `FIXED_DECREASE`). The
migration converts `discount_pct=15` into
(`PCT_DECREASE`, `15`). One adjustment path, no parallel percentage field.

Unchanged: `scope`/`property`/`bedroom_group` (same `_match_scope`
semantics), `enabled`, `min_nights`, `days_before_checkin`,
`start_date`/`end_date`.

Default `application` per type: `seasonal` → `per_night`; everything else →
`whole_stay`.

### Eligibility per type

All types also require `enabled=True` and a scope match. Date windows:
**per-night rules** match night-by-night — night `d` is covered when
`start_date <= d <= end_date` (dates are nights, so `end_date` is the last
*night*, matching current seasonal semantics). **Whole-stay rules** with a
window require containment: `check_in >= start_date` and
`check_out <= end_date` (current `MINIMUM_NIGHTS` semantics).

| Type | Eligible when |
|---|---|
| `seasonal` | the night falls in the window |
| `long_stay` | `nights >= min_nights` |
| `last_minute` | `max(0, check_in − today) <= days_before_checkin` |
| `non_refundable` | the caller passed `is_non_refundable=True` |
| `promo` | code matches (case-insensitive), `usage_limit` not exhausted, `nights >= min_nights` if set, Pass-1 subtotal `>= min_subtotal_eur` if set, window contains the stay if set |
| `manual` | the rule's id is in `manual_rule_ids` passed explicitly by staff |

## Engine

```python
calculate_price(property_obj, check_in, check_out, *,
                is_non_refundable=False, promo_rule=None, manual_rule_ids=())
```

`promo_rule` is a resolved `PricingRule` (or `None`), produced by the single
new helper `resolve_promo_rule(code, property_obj, check_in, check_out)`
which replaces the four copy-pasted validation blocks in
`_booking_public.py:544-556,587-595,650-659,744-753`. The helper checks
everything knowable before pricing runs — code lookup, enabled, usage limit,
scope, date window, `min_nights` — and returns `(rule, error_message)`. The
two stay-dependent conditions the helper cannot know (`min_subtotal_eur`,
and nothing else today) are checked by the engine itself, which reports the
rule as `not_eligible` with a reason and takes no discount.

All enabled rules and groups load in one query pair per call; the engine does
no further queries.

### Pass 1 — nightly rates

For each night, walk the groups in `sort_order`:

1. A night that is **locked** skips every remaining group; each per-night
   rule it would have matched is recorded as `locked_out`.
2. Collect the group's per-night rules eligible for this night, in
   `sort_order`. In an **Exclusive** group, keep only the first; the rest
   are recorded as `overridden`. In a **Stack** group, keep all.
   Eligibility here means **both** the date window and the rule type's own
   condition — a per-night `manual` or `promo` rule must still be selected
   or entered before it applies, exactly as its whole-stay counterpart is.
   (`seasonal` is the one type whose eligibility *is* its date window.)
3. Apply each kept rule to the running rate: `FIXED_PRICE` replaces it;
   the other four adjust it, compounding in order; the rate clamps at 0.
4. **After the whole group is processed**, if any applied rule had
   `is_final`, the night becomes locked.

Step 4's timing is the approved lock semantics: **locking happens at the
end of the rule's group, never mid-group**. Rules in the same Stack group
that come after the final rule still modify the rate (fixed 56 with
`is_final`, then +50% in the same group → 84); the lock takes effect only
at the group boundary, against later groups.

> **Lock rule (document everywhere, including the UI help text):** once a
> night is locked, it is excluded from **all** per-night rules in later
> groups and from **all** whole-stay adjustments, with no exceptions. A
> locked night's value is exactly what its group produced.

### Pass 2 — whole-stay adjustments

```
discountable = sum(rates of unlocked nights)
protected    = sum(rates of locked nights)
```

Walk the groups in `sort_order` again, now taking only whole-stay rules.
Exclusive/Stack selection works as in Pass 1, per stay. Each applied rule
adjusts `discountable`: percentages compute on its running value, fixed
decreases clamp at `min(value, discountable)`, and it never goes below 0.

```
total = discountable + protected
```

Worked example (approved): 7 nights at base 45, the last 5 covered by a
seasonal `FIXED_PRICE 56` with `is_final`, weekly tier 15%:
`discountable = 2 × 45 = 90`, `protected = 5 × 56 = 280`, long-stay takes
`13.50` from 90 → **total 356.50**.

### Exclusive groups may not mix applications

In an Exclusive group, per-night rules compete per night and whole-stay
rules compete per stay — mixing the two in one group would make "the first
eligible rule wins" ambiguous. Validation therefore **rejects saving a rule
whose `application` differs from the others in its Exclusive group** (and
rejects flipping a group to Exclusive while it holds both kinds). Stack
groups mix freely.

### Validation — contradictions rejected at save time

- Exclusive group mixing `per_night` and `whole_stay` rules (above).
- `is_final=True` on a `whole_stay` rule.
- `FIXED_PRICE` on a `whole_stay` rule.
- `code`, `usage_limit`, or `min_subtotal_eur` on a non-promo rule; a promo
  rule without a `code`.
- `min_subtotal_eur` on a per-night rule. The minimum is measured against the
  Pass-1 subtotal, which does not exist yet while Pass 1 is running, so only
  a whole-stay rule can test it.
- `scope=property` without `property`; `scope=bedroom_group` without
  `bedroom_group`.
- An enabled rule with `adjustment_value=None` (legacy rows with null are
  skipped at evaluation and reported as `skipped_invalid`).

## Breakdown

Every legacy key survives with its exact current format (`str(Decimal)`
money, `"0"` for absent percentages, `int` nights) because the scout
confirmed they are load-bearing in the UI, pinned by tests
(`tests.py:38-126`), and stored verbatim in every existing
`BookingRequest.price_breakdown` / `Reservation.price_breakdown_json` blob:

| Legacy key | Now computed as |
|---|---|
| `base_nightly` | unchanged |
| `effective_nightly` | Pass-1 subtotal ÷ nights (identical when seasonal coverage is uniform) |
| `has_seasonal` | any seasonal rule applied to any night |
| `subtotal` | Pass-1 subtotal (discountable + protected) |
| `long_stay_pct` / `_amount` | from applied `long_stay` rules (amount summed; pct from the largest-amount rule, `"0"` if none) |
| `last_minute_pct` / `_amount`, `non_refundable_pct` / `_amount` | same pattern |
| `promo_amount` | total taken by promo rules |
| `total`, `nights`, `errors` | unchanged |
| `min_nights_required` | now read from `StayConstraint` |
| `first_night_price` | **deprecated alias** — equals `average_nightly_rate` |

New keys:

- `average_nightly_rate` — `total ÷ nights`, quantized `HALF_UP`
  (`"0"` when nights is 0). This is the real field; `first_night_price`
  merely mirrors it for old consumers and goes away in a later release. Its
  only consumer today is the direct-booking deposit endpoint, which no
  frontend code calls.
- `protected_total` — sum of locked nights.
- `nightly_breakdown` — `[{date, rate, locked, rule_ids}]` per night.
- `rules` — every enabled rule that was considered:
  `{id, name, type, group, application, status, reason, amount}` where
  `status` ∈ `applied | not_eligible | overridden | locked_out |
  skipped_invalid` and `reason` is a human sentence ("stay is 3 nights,
  rule needs 7").

Old stored blobs lack the new keys; the frontend treats them as optional.

## StayConstraint (new)

```python
class StayConstraint(TimeStampedModel):
    class Kind(models.TextChoices):
        MIN_NIGHTS = "min_nights", "Minimum nights"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    value = models.PositiveIntegerField()
    scope = models.CharField(...)      # same all/property/bedroom_group trio
    property = models.ForeignKey(Property, null=True, blank=True, ...)
    bedroom_group = models.PositiveIntegerField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    enabled = models.BooleanField(default=True)
```

Resolution is a straight port of `_min_nights_required`
(`_pricing.py:134-158`): most-specific scope wins, same date filtering — so
the availability page's synthetic one-night probes
(`_booking_public.py:315,348`) keep working unchanged. Only `min_nights`
exists now; the shape admits max-stay and closed-to-arrival later without
schema change, and none of that is built now.

## API

Roles: identical to the current pricing-rule endpoints (admin + management),
enforced by `require_roles` as the first lines of every new view.

| Endpoint | Change |
|---|---|
| `GET/POST /api/pricing-groups/` | new |
| `PATCH/DELETE /api/pricing-groups/<id>/` | new; DELETE only when empty |
| `PATCH /api/pricing-groups/reorder/` | new; `{"order": ["<id>", ...]}` |
| `GET/POST /api/pricing-rules/`, `PATCH/DELETE .../<id>/` | serializer gains `name`, `groupId`, `sortOrder`, `application`, `isFinal`, `code`, `usageLimit`, `usageCount` (read-only), `minSubtotalEur`; loses `discountPct`; every field editable |
| `PATCH /api/pricing-rules/reorder/` | new; `{"groupId": "...", "order": [...]}` |
| `GET/POST /api/stay-constraints/`, `PATCH/DELETE .../<id>/` | new |
| `/api/promo-codes/*` (staff CRUD) | **removed** — promo rules are managed through `/api/pricing-rules/` |
| `POST /api/booking/promo-codes/validate/` (public) | kept; reads promo rules via `resolve_promo_rule` |
| `POST /api/properties/quotes/` | new (carried from the old plan): `{checkIn, checkOut, propertyIds?}` → per-property breakdowns for staff search |

`BookingRequest.promo_code` keeps its name but repoints to `PricingRule`
(`SET_NULL` preserved) — call sites reading `.promo_code.code` keep working.
`Reservation` has no promo FK today and gains none.

### Promo usage counting

`usage_count` counts **confirmed bookings only**. It increments — always
via `F("usage_count") + 1`, inside the same `transaction.atomic()` block
that creates the reservation — at exactly two points:

| Site | Today | After |
|---|---|---|
| `booking_create_direct` (`_booking_public.py:776-777`) | increments (read-then-write) | increments via `F()` — a reservation really is created here |
| `booking_create_request` (`_booking_public.py:666-667`) | increments when a **pending** request is created | **no increment** — the request may expire or be rejected |
| `booking_request_approve` (`_booking_pms.py:242-267`) | never increments | increments via `F()` beside `reservation.save()` |

Validating a code, calculating a quote, and creating a booking request all
leave the count untouched. Rejected and expired requests therefore consume
nothing, which today they silently did. Cancelling a reservation does not
return a use (unchanged).

Deferring the count creates one edge case: two pending requests can both
carry a limit-1 code. **Approval always wins over the limit** — the guest
already holds a quoted price, and refusing the approval would leave staff
with no way to honour it except rejecting the booking. So the second
approval succeeds, `usage_count` is allowed to exceed `usage_limit`, and
the approval response carries a warning
(`"Promo SUMMER25 is now over its usage limit (2 of 1)."`) that the
requests screen surfaces. The rule stays true — the code stops being
*offered* once the count reaches the limit, because eligibility reads the
current count — while never blocking a booking a guest was already
promised.

Preserved quirks (deliberately): booking create paths silently drop an
invalid promo code while calculate/validate return an error; a promo at its
usage limit can still slightly overshoot when two commits race (the `F()`
fix removes lost updates, not the check-then-book window — same exposure as
today, now bounded at the commit point).

## Migrations (one release, three steps)

1. **Schema:** create `PricingGroup`, `StayConstraint`; add the new
   `PricingRule` fields (`group` nullable); add `BookingRequest.promo_rule`
   FK (temporary name).
2. **Data:**
   - Seed the four groups.
   - Assign every existing rule to its group; `sort_order` by `created_at`;
     `application` by type default; convert `discount_pct` →
     (`PCT_DECREASE`, value).
   - Seed the six default long-stay tiers (`_pricing.py:12-19`) as enabled
     scope-all rules in Stay Discounts, `sort_order` ascending from the
     28-night tier — so "first eligible wins" reproduces "highest applicable
     tier". A tier is skipped when an enabled scope-all long-stay rule
     already exists at that `min_nights`, whatever its percentage: a custom
     7-night rule means the operator has already decided what 7 nights are
     worth, and adding the default beside it would put two rules in the same
     Exclusive slot. Seeding is unconditional otherwise:
     today's out-of-box pricing depends on the hidden fallback, and this
     turns it into visible rows the operator can edit or delete.
   - Create one `NON_REFUNDABLE` rule in Booking Discounts from
     `BookingSiteSettings.non_refundable_discount_pct`.
   - Convert every `PromoCode` row to a `PROMO` rule in Promotions
     (`percentage` → `PCT_DECREASE`, `fixed_amount` → `FIXED_DECREASE`
     whole-stay; `active` → `enabled`; code uppercased), then repoint
     `BookingRequest.promo_rule` by matching the old FK.
   - Move `MINIMUM_NIGHTS` rows to `StayConstraint` and delete them.
3. **Cleanup schema:** drop the old `BookingRequest.promo_code`, rename
   `promo_rule` → `promo_code`; delete `PromoCode`; drop
   `BookingSiteSettings.non_refundable_discount_pct` and
   `PricingRule.discount_pct`; make `PricingRule.group` non-null; remove the
   `MINIMUM_NIGHTS` choice.

The data migration is irreversible (reverse is a no-op with a comment); the
export/import archive flow round-trips the new tables like any other model.

## Frontend

**PricingRulesPage — rebuilt group-centric.** Ordered group sections
(create, rename, Stack/Exclusive toggle, reorder via up/down buttons, delete
when empty). Rules listed inside their group in `sort_order` with up/down,
inline editing of every field, and per-type "add rule" forms; promo rules
expose code/limits/usage. A separate **Stay restrictions** section manages
`StayConstraint` rows (the old minimum-nights tab re-targeted). One help
line explains the model: *groups evaluate top to bottom; Stack applies every
matching rule, Exclusive applies the first; a final price locks its nights
against everything below.* The "Add default tiers" button
(`PricingRulesPage.tsx:230-233`), the frontend tier twin
(`PricingRulesPage.tsx:29-36`), and the promo tab's separate API disappear.

**Staff search** (carried from the old plan): `/availability` prices come
from `POST /api/properties/quotes/`; the booking modal prefills
`nightlyPrice` with `averageNightlyRate` instead of `'0.00'`; where nights
differ the card shows the average with an expandable per-night list.

**Guest breakdown** (`ApartmentDetailModal`): existing rows unchanged; a
collapsible "How this price was calculated" renders `rules[]` (applied rules
with names and amounts; skipped ones with reasons behind the toggle) and the
per-night list. Missing `rules`/`nightly_breakdown` (old stored blobs) hides
the section.

**Types:** `frontend/src/types/domain.ts` gains `PricingGroupRecord`,
`StayConstraintRecord`, the extended `PricingRuleRecord` (camelCase mirrors
of the serializer), `averageNightlyRate` on the breakdown; loses
`PromoCodeRecord` and `nonRefundableDiscountPct`.

## Error handling

| Case | Behaviour |
|---|---|
| No rule covers a night | Night stays at `base_price_eur`. |
| Two fixed-price rules cover one night in a Stack group | Later in `sort_order` wins (it replaces the running rate). |
| Enabled rule with `adjustment_value` null (legacy) | Skipped; reported as `skipped_invalid`. New saves are rejected. |
| Every night locked | `discountable` is 0; whole-stay rules apply with amount 0.00 and reason "all nights price-locked" — including promo (supersedes the old spec's "promo still applies": the lock rule has no exceptions). |
| Fixed decrease larger than remaining | Clamps to the remaining discountable amount. |
| Empty group | No effect on price; still listed in the UI. |
| Deleting a non-empty group | Rejected with a clear error naming the rule count. |
| Stay longer than 365 nights | Rejected by existing booking-window validation; the nightly loop is bounded by it. |
| Quote fails for one property during search | That property lists at base price with a warning instead of vanishing. |
| Promo invalid on booking create | Silently dropped (today's behaviour); calculate/validate endpoints return the error message. |
| Approving two pending requests that share a limit-1 promo | Both approvals succeed; `usage_count` exceeds `usage_limit`; the second response carries an over-limit warning. The code stops being offered to new guests. |

## Testing

- **Golden regression:** the existing pricing tests' pinned numbers
  (`tests.py:38-126`) must pass against the seeded default configuration.
  Any test whose expectation legitimately changes (partial-stay seasonal
  coverage now applies; `first_night_price` becomes the average) is updated
  with a recorded reason, never silently re-pinned.
- **Engine:** stack compounding is order-sensitive; exclusive picks the
  numerically smallest `sort_order` among eligible rules (asserted with a
  rule whose `sort_order` is larger *and* whose discount is larger, so a
  reversed comparison fails the test); ties break by `created_at`; the
  lock examples (56 → +50% → 84 same
  group; the 356.50 worked example; locked nights immune to promo);
  per-night vs whole-stay application; a rule covering part of a stay
  affects only those nights; every eligibility clause per type, including
  promo min-spend/min-stay/window/usage; manual rules apply only when their
  ids are passed.
- **Validation:** each rejected contradiction from the list above.
- **Migrations:** promo rows convert and the FK repoints; the six tiers
  seed (and skip when an identical rule exists); the non-refundable rule
  carries the settings value; `MINIMUM_NIGHTS` rows land in
  `StayConstraint`; `discount_pct` values convert.
- **Breakdown contract:** all legacy keys present with exact formats; a
  stored pre-migration blob still renders in the UI.
- **API:** role enforcement on every new endpoint; group delete blocked
  when non-empty; reorder persists; `/api/promo-codes/` staff routes are
  gone; the public validate endpoint works against promo rules;
  `usage_count` increments via `F()` only when a reservation is committed
  (direct booking, request approval) — not on validate, not on a quote,
  not on request creation — and rejected or expired requests consume
  nothing.
- **Frontend:** `npx tsc -b --force && npm run build`; search shows quoted
  prices; the modal prefills the average rate.

## Risks

**Prices move on the day this ships.** Partial-stay seasonal rules now
apply to the nights they cover — the point of the change. Existing
reservations are unaffected: they store their own totals and breakdowns.

**Custom long-stay rules may resolve differently.** The old picker mixed
scope rank with percentage size (`_pricing.py:97`); the new engine uses the
operator's explicit order. Databases holding hand-made long-stay rules
should review the Stay Discounts group order after migrating.

**The migration is irreversible.** `PromoCode` and `discount_pct` are gone
afterwards; rolling back requires a database restore.

## Out of scope

Fees and taxes as rules; `StayConstraint` kinds beyond minimum nights;
guest-side promo entry UI (the public validate endpoint exists, unused);
drag-and-drop ordering; currencies other than EUR; channel rate sync;
per-guest pricing; removing the deprecated `first_night_price` alias (a
later release).
