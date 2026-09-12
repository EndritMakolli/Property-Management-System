# Automated guest messages — audit

Audited 12 September 2026 against the live database, not against the code alone.

You asked about 23 scenarios. **Thirteen message surfaces exist.** The other ten
are points in the guest journey where the system sends nothing at all; they are
listed in "What is missing" below, so the gap is a decision rather than a
surprise.

One defect was found and fixed. It is the first section because it was live.

---

## 1. The defect: declining a booking sent the guest nothing

**Severity: high. Fixed in migration `0061_fix_rejection_segment`.**

`render_template` resolves **a line at a time**. An optional `[segment]` must
therefore open and close on the same line. The `booking_rejected` template
shipped with the segment spread over three lines, in **both** languages:

```
Unfortunately we cannot confirm this booking.[

(reason)]
```

Two consequences, both confirmed by rendering the real stored rows:

| Case | What the guest got |
|---|---|
| Staff typed a reason | The literal brackets: `…this booking.[` … `redecorated.]` |
| Staff typed **no** reason | **Nothing.** `(reason)` stayed unresolved, and `views/_guest_mail.py` refuses to send a message with a placeholder left in it. |

The second case is the common one — a decline is usually sent without an
explanation — so the most likely outcome of refusing a booking was that the
guest was never told.

**Fixed** by moving the segment onto one line (`[(reason)]`). Three things
changed so it cannot come back:

- `0061_fix_rejection_segment` repairs rows already in the database, and only
  where the body still matches the broken text exactly — an operator who has
  reworded their own decline message keeps it.
- `migrations/_0045_lifecycle.py`, the seed, is corrected, so a fresh install is
  right from the start.
- `tests_message_audit.py` fails if any template body ever again opens a
  segment it does not close on the same line.

Verified on the real database afterwards: both languages now resolve completely,
with and without a reason, and print no stray brackets.

---

## 2. What exists

### Emailed automatically to the guest

| # | Scenario | Source | Languages | Trigger | On failure |
|---|---|---|---|---|---|
| 1 | Booking approved | `MessageTemplate.booking_approved` | sq + en | Staff approve a website booking request | Fails **open** — a failed send never rolls back the booking |
| 2 | Booking declined | `MessageTemplate.booking_rejected` | sq + en | Staff decline a request | Fails **open**. Refuses to send with an unresolved placeholder |
| 3 | Guest sign-in link | Hardcoded, `views/_guest_auth.py` | **en only** | Guest asks for a sign-in link | Fails **open** — a lock-out is worse than a slow link |

These three are the **only** messages the system sends to a guest by itself.
Both `send_guest_email` call sites were checked; there are no others.

### Emailed to staff

| # | Scenario | Source | Languages | On failure |
|---|---|---|---|---|
| 4 | Two-factor login code | Hardcoded, `views/_two_factor.py` | en | Fails **closed** — password alone must never create a session |

Deliberately the opposite policy from the guest mail above. Don't copy one to
the other.

### Drafted for staff to copy (WhatsApp, not email)

Resolved by `views/_drafts.py`; an unfillable placeholder deliberately stays
visible, because a person reads it before sending.

| # | Scenario | Languages | Placeholders |
|---|---|---|---|
| 5 | Apartments available | sq + en | 10 |
| 6 | Split stay possible | sq + en | 10 |
| 7 | Free on nearby dates | sq + en | 10 |
| 8 | Fully booked | sq + en | 2 |

All four resolve cleanly. All four are written in both languages.

### Copied by hand from a page

| # | Scenario | Source | Languages |
|---|---|---|---|
| 9 | Arrival details (door code, wifi) | `features/codes/copyTemplates.ts` | none — one fixed format |
| 10 | Arrival message | `features/dashboard/dailyOverview.ts` | **en only** |
| 11 | Departure message | `features/dashboard/dailyOverview.ts` | **en only** |

10 and 11 are new on the Daily Overview page. They deliberately carry no door
code, wifi password or other apartment secret — a message drafted there is
pasted into WhatsApp before the guest has arrived. Access details are handed
over from the codes page (#9).

### Printed and signed

| # | Scenario | Source | Languages |
|---|---|---|---|
| 12 | Apartment rental contract | `ContractTemplate.apartment` | sq + en |
| 13 | Vehicle hire contract | `ContractTemplate.vehicle` | sq + en |

Both resolve cleanly. Both now support a saved, editable draft per reservation
and per language.

---

## 3. What is missing

None of these exists today. Nothing is sent at any of them.

**The guest hears nothing when:**

1. A booking request is received — no acknowledgement before staff decide
2. They cancel a booking themselves — `guest_cancel_booking` sends no confirmation
3. Their booking is cancelled by the operator
4. Their dates are changed
5. Payment is due
6. Payment is received
7. Their stay is approaching — no pre-arrival reminder
8. It is arrival day — the message exists but a person must send it (#10)
9. It is departure day — same (#11)
10. Their stay has ended — no thank-you, no review request

**Two observations, not requests:**

- **1 and 2 are the notable gaps.** Someone who books and hears nothing assumes
  it failed and books elsewhere; someone who cancels and gets no confirmation
  rings to check.
- **7, 8, 9 and 10 are the ones a scheduler would drive.** They are date-based
  rather than event-based, so they need the timed infrastructure — which now
  exists, in `views/_sync_schedule.py`, though it drives only calendar sync.

---

## 4. Standing constraints, confirmed still true

- **Reply wording is never hardcoded** for the six booking-reply scenarios. The
  guest sign-in email and the 2FA email are security mail and deliberately are
  hardcoded; that is the documented exception, not a drift.
- **Guest mail fails open, 2FA mail fails closed.** Still true in both
  directions.
- **The two emailed outcomes refuse to send with a placeholder left in.** Still
  true — and it was this rule that turned the template defect into silence
  rather than into a guest receiving `(reason)`. The rule is right; the template
  was wrong.
- **Every scenario is written in both languages.** True for all six message
  templates and both contracts; `tests_message_audit` now asserts it. The sign-in
  email and the two Daily Overview drafts are English only.

## 5. Where the guards live

`backend/pms/tests_message_audit.py` — 10 tests:

- no template opens a segment it does not close on the same line
- no placeholder name spans lines
- the decline email resolves completely with **and** without a reason, in both
  languages, and prints no stray brackets
- the approval email resolves completely from a booking
- every scenario is written in both languages
- all six scenarios exist

Counting brackets per line would be the obvious check for the second test and is
wrong: contract clauses are numbered `a)`, `b)`, `c)`, so an unbalanced
parenthesis is ordinary prose. What actually breaks is a placeholder whose
*name* spans lines, so that is what is tested.
