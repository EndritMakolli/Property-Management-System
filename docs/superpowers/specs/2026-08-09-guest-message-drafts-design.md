# Guest message drafts — design

**Date:** 2026-08-09
**Status:** Approved — implementing (see *Decisions confirmed 2026-08-21*)
**Scope:** Spec 1 of 2. Spec 2 (`search & pricing cleanup`) covers the general
location, removing the lead-time/stay-length charts, and the pricing rules work.

## Problem

Staff answer guest enquiries by hand. They search dates on `/availability`,
read the result, then retype the same message — dates, nights, apartment type,
capacity, nightly price, total, discount. It is slow and inconsistent, and the
awkward cases (fully booked, split stay, nearby dates) get answered worst
because they take the most typing.

## Solution

After a search, generate an editable draft reply that already contains the
answer. Staff edit if needed, copy, and paste into whatever channel the guest
used.

Modelled on Airbnb's *quick replies* — saved templates containing placeholders
that resolve from real booking data. Deliberately **not** Airbnb's *scheduled
messages*: scheduling requires automated sending, and delivery here is
copy-to-clipboard, so there is nothing to schedule.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Delivery | Copy to clipboard | Works with Airbnb, Booking.com, WhatsApp and email on day one, with no integration. Staff always review before sending. |
| Scenario choice | Auto-detect, one draft, switchable | Matches the "auto-generated" requirement; the switcher prevents a wrong guess trapping the user. |
| Template store | Fixed scenario slots | Four formulaic messages. Variants add machinery whose value only appears when sending is automated. |
| Languages | Albanian + English | Local staff, international guests. |
| Apartment identity | Type + price, never a specific flat | All apartments of a type share a price, so the guest is told the type. |
| Multiple options | One line per bedroom type when unfiltered; one when filtered | Stated requirement. |
| Scheduling | Out of scope | Incompatible with clipboard delivery. |

## Data model

```python
class MessageTemplate(TimeStampedModel):
    class Scenario(models.TextChoices):
        AVAILABLE         = "available",         "Apartments available"
        SPLIT_STAY        = "split_stay",        "Split stay possible"
        ALTERNATIVE_DATES = "alternative_dates", "Free on nearby dates"
        NO_AVAILABILITY   = "no_availability",   "Fully booked"

    scenario = models.CharField(max_length=32, choices=Scenario.choices, unique=True)
    body_en  = models.TextField(blank=True)
    body_sq  = models.TextField(blank=True)   # sq = Albanian
```

Exactly four rows, created by a data migration with starter text in both
languages so the feature works on deploy. `unique=True` makes the
scenario → template lookup unambiguous.

No message history is stored. Drafts are disposable.

## Scenario detection

The availability facts already exist **in the frontend**: `/availability`
computes `availableProperties`, the pinned split-stay plan
(`buildSplitStayRecommendation`) and the next-free-window insights
(`buildApartmentInsights`). Re-implementing that greedy walk in Python would
create a second copy of the same business logic, which this project explicitly
avoids for pricing and should avoid here too.

So the split is:

- **Frontend** sends the availability context it already computed — the free
  bedroom types, whether a split plan covers the dates, and the next free
  window per type.
- **Backend** owns everything the frontend must not decide: which scenario
  wins, all money (via `calculate_price`, never recomputed client-side), date
  formatting, and placeholder rendering.

This keeps one availability implementation and one pricing implementation, and
guarantees the draft cannot contradict what is on screen, because it is
rendered from the same numbers.

The draft endpoint is therefore a `POST` carrying that context, not a `GET`.

| Scenario | Condition |
|---|---|
| `available` | at least one apartment free for the whole stay |
| `split_stay` | none free, but a split-stay plan covers the requested dates |
| `alternative_dates` | none free, no split, but a window fitting the same number of nights exists within 60 days |
| `no_availability` | nothing within 60 days |

Priority order: **available → split_stay → alternative_dates → no_availability**.
Split stay outranks alternative dates because it preserves the guest's
requested dates and only moves them between apartments; changing dates is the
larger ask.

The forward scan looks **60 days** ahead. Beyond that, `no_availability` is
used and the template invites the guest to ask about later dates. The same scan
powers both "fully booked until X" and "nearest free date" — one computation,
not two.

## Placeholders

Syntax is parenthesised natural language, matched case-insensitively and
tolerant of internal whitespace: `(nightly price)`, `(Nightly Price)`.

| Group | Placeholders |
|---|---|
| Stay | `(check-in)` `(check-out)` `(nights)` `(guests)` |
| Apartment | `(bedrooms)` `(capacity)` `(beds)` `(bathrooms)` `(apartment type)` |
| Money | `(nightly price)` `(subtotal)` `(discount)` `(discount %)` `(total price)` |
| Alternatives | `(next free date)` `(unavailable until)` |
| Other | `(guest name)` `(location)` |

`(subtotal)` is nights × nightly before discount — it appears explicitly in the
staff's existing wording and already exists in `priceBreakdown`.

Dates render per language: `20.09.2026` (Albanian), `20 Sep 2026` (English).

### Optional segments

Square brackets mark a segment that disappears when the placeholders inside it
have no value:

```
= (subtotal)€[ − (discount)€ zbritje] = (total price)€
```

With no discount this becomes `= 90€ = 90€`. A line-level rule was rejected:
the real templates put the discount mid-sentence, so dropping the line would
delete the price with it.

### Repeating lines

A line repeats once per available bedroom type if it contains any per-apartment
placeholder (`bedrooms`, `capacity`, `beds`, `bathrooms`, `apartment type`,
`nightly price`, `subtotal`, `discount`, `total price`).

When the search filters bedrooms, there is one type and therefore one line.
No loop syntax: staff write one bullet in their own wording and get one per
type. Chosen over a system-formatted block so the wording stays theirs.

### Unresolved placeholders

Anything still unresolved is left visible as its literal `(token)`, and the
draft panel shows a warning chip (`2 placeholders couldn't be filled`). Since
staff always edit before copying, a visible gap is safer than a silent deletion.

## Components

### Backend

- `pms/model_defs/messaging.py` — `MessageTemplate`.
- `pms/views/_messaging.py` — template CRUD (`GET`/`PATCH`, no create/delete;
  the four rows are fixed) and the draft endpoint.
- `pms/views/_drafts.py` — scenario detection, the 60-day scan, and the
  placeholder renderer. Pure functions, no HTTP, so they are directly testable.
- `GET /api/message-templates/` — the four templates.
- `PATCH /api/message-templates/<scenario>/` — update one.
- `POST /api/message-drafts/` — body carries the search (`checkIn`, `checkOut`,
  `guests`, `bedrooms`), the `language`, an optional `scenario` override, and
  the availability context computed by the page (`freeTypes`, `splitCovers`,
  `nextFreeByType`). Returns `{scenario, detected, language, body, unresolved}`.

Role: admin + management, consistent with the rest of the PMS.

### Frontend

- `pages/MessageTemplatesPage.tsx` — route `/message-templates`, sidebar entry
  under Pricing Rules. Four cards, each with the scenario name, when it fires,
  two side-by-side textareas (Shqip / English), a clickable placeholder
  reference that inserts at the cursor, per-card Save, and a
  "Preview with sample data" toggle.
- `features/availability/GuestReplyPanel.tsx` — rendered on `/availability`
  under the results once a search has run. Language toggle, scenario dropdown
  (auto-detected preselected), editable textarea, Copy button, character count,
  unresolved-placeholder chip.
- Language toggle on the search bar sets the panel's default language.
- `api/messaging.ts` — the three calls above.

Edits are local and disposable: changing search, scenario or language
regenerates the draft.

## Error handling

| Case | Behaviour |
|---|---|
| Template body empty for the chosen language | Panel shows "No template yet for this scenario in Albanian" with a link to the template window. No draft. |
| Placeholder has no value | Left visible as `(token)`; warning chip lists the count. |
| Optional segment has no value | Segment removed. |
| Search returns nothing and the 60-day scan finds nothing | `no_availability` scenario. |
| Draft endpoint fails | Panel shows an inline error; the results above are unaffected. |
| Availability context missing/stale | Backend falls back to `no_availability` rather than inventing an answer. |
| Clipboard API unavailable | Fall back to selecting the textarea contents and prompting Ctrl+C. |

## Testing

Backend:
- Scenario detection for each of the four cases, including the priority order
  when more than one applies.
- The 60-day scan: finds the first window fitting the requested nights; returns
  nothing past the horizon.
- Placeholder resolution: every placeholder; optional segments with and without
  values; line repetition filtered and unfiltered; unresolved tokens reported.
- Date formatting per language.
- Role enforcement on all three endpoints.

Frontend:
- Draft regenerates when search, scenario or language changes.
- Copy writes the edited text, not the generated text.
- Empty-template state renders.

## Dependency on Spec 2

`/availability` currently displays `basePriceEur`, not the rule-adjusted
rate — pricing rules do not yet reach staff search. Until Spec 2 lands, the
draft's money placeholders come from `calculate_price` on the backend, so
the **draft may quote a different price than the card above it**.

Spec 2 makes the search itself use `calculate_price`, at which point the two
agree. Either ship Spec 2 first, or accept the mismatch during the gap.
Sequencing Spec 2 first is preferred.

## Out of scope

Scheduled and automated sending; message history; per-guest personalisation
beyond `(guest name)`; channel integrations; template variants beyond the four
scenarios; languages beyond Albanian and English.

---

## Decisions confirmed 2026-08-21

Re-confirmed with the operator before implementation. This spec governs; a
competing 2026-08-21 draft was discarded in favour of it.

- **One line per bedroom type**, as specified above — not one per apartment.
  The reason is now stronger than when written: base prices became per bedroom
  group, so all 17 two-bedroom apartments quote the same €35/night. One line
  per apartment would emit 17 identical bullets.
- **Both languages** shipped together, Albanian and English.
- **Spec 2 has landed.** `/availability` prices through `calculate_price`, so
  the price-mismatch gap described under *Dependency on Spec 2* is closed.
- The split-stay and next-free-window logic is reused from the existing
  `buildSplitStayRecommendation` and `buildApartmentInsights` on
  `AvailabilityPage`. It is NOT reimplemented in Python.

### Agreed Albanian body — `available`

Supplied by the operator, kept in their own orthography (no `ë`/`ç`):

```
Pershendetje,

Faleminderit per kerkesen e rezervimit. Per datat qe keni kerkuar, nga
(check-in) deri me (check-out) (check-out), rezervimi juaj perfshine
(nights) nate dhe kemi te lire banese me (bedrooms) dhoma gjumi.

- [ ] Banesa me (bedrooms) dhoma gjumi ka kapacitet deri ne (capacity)
      persona dhe cmimi eshte (nightly price)€ per nate, pra (nights) nate
      × (nightly price)€ = (subtotal)€[ − (discount)€ zbritje] =
      (total price)€ cmimi total i qendrimit.

Parkingu eshte i perfshire ne cmim,
- 2 kat me parkingje ne garazh
- 2 lifta afer parkingjeve

Nese keni ndonje pyetje shtese ose deshironi te vazhdojme me rezervimin,
ju lutem na kontaktoni lirisht.

Me respekt,
```

The bullet repeats per free bedroom type because it contains per-apartment
placeholders. The discount clause sits in square brackets so it disappears on
stays with no discount.
