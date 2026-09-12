# Feature audit — what is incomplete, and what does not make sense

Audited 12 September 2026 against the running database and the code, not against
the docs. Every count below is real.

**Status: all findings addressed 12 September 2026.** Each section now carries
what was done. One finding (§6) was wrong and is corrected below.

Ordered by what I would fix first.

---

## 1. The booking email is required in the browser and optional on the server

`ClientBookingModal.tsx` refuses to submit without one:

```ts
if (!first || !last || !guestPhone || !guestEmail) {
  setError('Please enter your name, email address, and phone number.')
```

`booking_create_request` does not ask for one, and says so deliberately:

```python
if not guest_name:  errors["guestName"]  = "Name is required."
if not guest_phone: errors["guestPhone"] = "Phone number is required."
# Email is optional for booking requests: guests supply only name + phone.
```

The two layers state opposite policies. Worse, the **other** booking endpoint
(`booking_create_direct`) *does* require it — so the two creation paths disagree
with each other as well.

**This is the root of three dead features**, because everything guest-facing
hangs off that address:

| Depends on the email | State |
|---|---|
| Guest portal sign-in (`has_website_booking` matches on a lowercased email) | `GuestAccount` = **0 rows**, `GuestLoginLink` = **0 rows** — never used by anyone |
| `booking_approved` email | never had an address to send to |
| `booking_rejected` email | same (and separately broken until this week) |

Both `BookingRequest` rows in the database have `guest_email=''`.

**Fixed.** The server now requires it, validates it, and lowercases it on the
way in — `has_website_booking` matches on a lowercased address, so the capitals
a phone keyboard adds would have locked the guest out of the portal they had
just earned. `tests_audit_fixes.BookingRequestNeedsAnEmailTests`.

---

## 2. "To Fix" cannot be ticked off

`MaintenanceIssue` has no status, no resolved flag, no closed date:

```python
class MaintenanceIssue(TimeStampedModel):
    property, description, reporter_name, reported_at
```

The only way to close an issue is `DELETE` — permanently, from the UI's
`Delete this issue?` confirm. So:

- there is no record of what was ever fixed, when, or by whom;
- 22 issues sit open with no way to distinguish "not done" from "nobody has
  pressed delete yet";
- it contradicts the app's own rule everywhere else — a reservation archives, a
  client archives, only maintenance is destroyed.

**Fixed.** `is_resolved`, `resolved_at` and `resolved_by` on the model; a
Fixed / Reopen button on each issue and an Open / Fixed pair of views on the
page. The list still answers "what needs doing" by default. Delete survives for
a row entered by mistake and now says that resolving keeps the record.
`tests_maintenance_resolve.py`.

---

## 3. A booking endpoint that marks money as paid without taking any

`booking_create_direct` — public, CSRF-exempt, throttled 10/hour per IP, well
validated, race-guarded — and:

```python
"""POST — create a confirmed direct Reservation (online payment path).
Payment is stubbed: we accept the booking immediately."""
...
paid_amount = first_night if payment_type == "first_night" else total
payment_status = Reservation.OnlinePaymentStatus.FIRST_NIGHT | FULL
```

It writes a **confirmed** reservation recording money that was never taken.
Nothing in the frontend calls it.

Two consequences if it is ever reached: revenue figures become fiction, and
`cancellation_outcome` refunds `online_payment_amount` — a refund of money you
never received.

**Fixed.** Gated behind `ONLINE_PAYMENTS_ENABLED`, which defaults to off and
returns 503 with an explanation. The switch turns the feature off; it does not
delete it, so one setting brings the whole path back when there is a provider.
A deploy check warns if it is ever switched on.
`tests_audit_fixes.DirectBookingStaysOffTests`.

---

## 4. Built, complete, and wired to nothing

Four endpoints exist for a guest to manage their own booking by emailed token.
No frontend calls any of them:

- `GET  /api/booking/reservations/<token>/`
- `POST /api/booking/reservations/<token>/cancel/`
- `POST /api/booking/reservations/<token>/change-request/`
- `POST /api/booking/promo-codes/validate/`

Of these, **`booking_change_request` is a stub that lies**:

```python
"""POST — guest requests a date/apartment change (placeholder response for now)."""
return JsonResponse({"message": "Your change request has been received. We will contact you shortly."})
```

It stored nothing and told nobody. A guest reassured and an operator unaware is
worse than no feature at all.

**Fixed.** The endpoint is removed, along with its route and export. The other
three are correct code with no caller and are left alone — they act on a
reservation token, and with direct booking off there are no new tokens to act
on. If change requests are wanted they need somewhere to be recorded and a
staff surface to read, and then they can come back.
`tests_audit_fixes.NoLyingChangeRequestTests`.

---

## 5. Two expense models, one of them dead

| Model | Rows | Used by |
|---|---|---|
| `Expense` | **0** | nothing — no view queries it |
| `FinanceExpense` | 12 | the Finance page |
| `ExpensePayment` | 47 | FK points at **`FinanceExpense`** |

`Expense` is exported from `models.py` and `model_defs/__init__.py`, so it is
importable and autocompletes next to the real one. Two near-identically named
models where only one works is how something eventually gets written to the
wrong table.

**Fixed.** `Expense` is dropped in migration `0063`.

---

## 6. Four models reachable by nothing at all

> **Correction.** This section originally listed five and named `PropertyReview`
> among them. That was wrong: `PropertyReview` has create and delete endpoints in
> `views/_properties.py`, a frontend API, and it is shown on the public listing.
> It has 0 rows because nobody has written a review, which makes it §7 (a feature
> with no data), not a dead model. The error came from a `grep … | head -5` that
> truncated its real usages. It has been left in place.

`GuestStay`, `Inquiry`, `FinancialReport`, `ClaudeTask` — all **0 rows**, no
view, no endpoint, no frontend. Their only references outside the model
definitions were in `admin.py`, and **the Django admin is disabled**
(`DJANGO_ADMIN_ENABLED = False`).

`GuestStay` is the notable one: it duplicates guest/reservation/nights/amount
that `Reservation` already holds, for 818 reservations and 0 stays. If something
ever started writing it, you would have two answers to "how many nights has this
client stayed" — and the clients page already had that exact bug once.

**Fixed.** Dropped in migration `0063`, which refuses to run at all if any of
them has grown a row — "empty when I looked" is not "empty when this runs on
your server".

---

## 7. Features that work and have no data

| Feature | Data | Effect |
|---|---|---|
| Map (`MapPage`, `MapPicker`, leaflet — 160 kB of bundle) | **0 of 38** properties have coordinates | the map shows nothing |
| Amenity filter (`?amenities=` on availability) | **0** amenities, **0** property-amenities, and no filter in the guest UI | dead at both ends |
| House rules | **0** | nothing to show on a listing |
| Cancellation policy | **0** | `cancellation_outcome` falls through to *free cancellation, full refund* for every booking |
| Expense AI (receipt scanning) | `ANTHROPIC_API_KEY = ''` | returns "not configured"; the `anthropic` dependency ships anyway |

**Cancellation: fixed.** With no policy configured, `cancellation_outcome` now
declines to auto-cancel and asks the guest to get in touch, rather than
cancelling and refunding in full. Absence of a policy is not a generous policy.
This is a deliberate behaviour change; a characterisation test that documented
the old rule was updated to state the new one.

The rest are data entry, not code: coordinates, amenities and house rules need
filling in, and the expense AI needs a key. Each behaves correctly when empty.

---

## 8. Sync is switched off, and has been idle for two weeks

- `auto_sync_enabled` — **0 of 38** properties, though **all 38** have both iCal
  links configured.
- Last sync of any kind: **27 August**, 16 days ago.
- **12 unresolved sync conflicts**, oldest from **26 July** — seven weeks.

The timed-sync machinery (lock, retry, backoff, status) is correct and
completely inert until `auto_sync_enabled` is switched on somewhere **and**
something calls `manage.py sync_calendars` on a schedule.

**Left to you deliberately.** Switching auto-sync on for 38 properties starts
reconciling 818 reservations against live feeds, and clearing the 12 conflicts
means deciding, one at a time, whether each is a real double-booking. Neither is
mine to decide. The scheduling step is documented in `sync_calendars`' own
docstring.

---

## 9. Configuration that is still development values

```
GUEST_PORTAL_URL   'http://localhost:5173'     ← sign-in links point at localhost
DEBUG              True
DEFAULT_FROM_EMAIL '<a personal gmail.com address>' ← consumer Gmail, ~500/day, as transactional sender
```

**Fixed, as far as code can.** These live in a gitignored `.env`, so no commit
can correct them — but `manage.py check --deploy` now fails on them instead of
letting them ship silently: DEBUG on is an error, a localhost or unset
`GUEST_PORTAL_URL` is an error, a consumer mailbox as the sender is a warning,
and online payments being on is a warning. They are deploy-scoped checks, so
they do not fire during development. `pms/checks.py`, `tests_deploy_checks.py`.

**Still yours to do:** set the real values in the server's `.env` and run
`manage.py check --deploy` before releasing.

---

## What is in good shape

Worth saying, because most of the system is not on this list:

- Pricing — one engine, one entry point, well tested.
- Reservations, clients, reports — the revenue-by-night rule is consistent and
  pinned by tests.
- Sync safety — absence is a state, not a verdict; nothing deletes.
- Roles — deny by default, enforced per view, tested across the staff surface.
- Contracts and invoices — real documents, drafts now editable.
- 951 backend and 503 frontend tests, all green.

---

## What is left, and why

Everything that code can fix is fixed. Three things remain, all of them
decisions or data rather than defects:

| | What | Why it is not mine to do |
|---|---|---|
| §8 | Switch on `auto_sync_enabled`, schedule `sync_calendars`, clear 12 conflicts | Starts reconciling 818 live reservations; each conflict is a judgement about a possible double-booking |
| §9 | Set the real production `.env` values | Gitignored by design — but `check --deploy` now refuses to let them ship wrong |
| §7 | Coordinates, amenities, house rules | Your data. Each feature behaves correctly while empty |
