# Integration Plans — TTLock, Airbnb Email, WhatsApp

Planning document. No implementation yet.

Written against the current codebase: Django (plain views, no DRF) + React/Vite,
Postgres, deployed on Render, background work done with management commands on a
cron schedule (see `pms/management/commands/sync_calendars.py`).

---

## 0. What already exists that these build on

Knowing this changes what has to be built from scratch.

| Existing thing | Where | Relevance |
|---|---|---|
| `Property.airbnb_listing_id` | `model_defs/properties.py:24` | Already a unique field — the listing↔property link has a home |
| `Property.airbnb_ical_url` | `model_defs/properties.py:26` | The iCal feed the email data will enrich |
| iCal import | `views/_ical.py` | Creates Airbnb reservations with placeholder name `"Airbnb"`, price `0.00` |
| `Reservation.platform_reservation_id` | `model_defs/reservations.py:39` | Unique per platform — the natural home for the Airbnb confirmation code |
| `Reservation.guest_phone` | `model_defs/reservations.py:33` | Source for the TTLock door code |
| `SyncLog` / `SyncConflict` | `model_defs/sync_log.py` | Established pattern for "integration ran" + "needs a human" |
| Needs Attention page | `pages/NeedsAttentionPage.tsx` | Existing home for human-review queues |
| `DoorCode` / `LockboxCode` | `model_defs/access.py` | Manual, per-property, old/new pair. **Not** what TTLock needs — see §2 |
| `Inquiry` | `model_defs/communication.py` | Has `whatsapp`/`airbnb` platform choices; partial overlap with Messages |
| `Guest.whatsapp_number` | `model_defs/guests.py:14` | WhatsApp number→guest matching |
| `ClaudeTask` | `model_defs/automation.py` | Has a `SEND_WHATSAPP` task type already scaffolded |
| No Celery / task queue | `settings.py` | **All async work must be a management command + Render cron** |

### One cheap win, worth doing before any of the three

`parse_ical_events` already captures every iCal field including `DESCRIPTION`,
but `import_ical_reservations` ignores it. Airbnb's **host** calendar export
typically puts this in `DESCRIPTION`:

```
Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABCD1234
Phone Number (Last 4 Digits): 1234
```

Verify this against one of your real feeds. If it's there, parsing it gives you,
for free:

- The **confirmation code** (`HMABCD1234`) → store in `platform_reservation_id`.
  This becomes the exact join key for the whole email integration (§3), turning
  fuzzy date-matching into an exact lookup.
- The **last 4 digits of the guest's phone** → which is literally the input the
  TTLock door code rule needs (§2), available before any email parsing exists.

This is a small change to one function and it de-risks both larger projects.
Do it first.

---

## 1. Cross-cutting foundations

Build these once; all three projects use them.

### 1.1 Credential storage

Static secrets (client IDs, app secrets) go in env vars via `python-decouple`,
matching the existing `ANTHROPIC_API_KEY` pattern.

**But rotating tokens cannot live in env vars.** TTLock access tokens and Gmail
OAuth refresh tokens rotate at runtime; on Render an env var can only change via
redeploy. Add a small model:

```
IntegrationCredential
  provider        ttlock | gmail | whatsapp
  access_token    encrypted
  refresh_token   encrypted
  expires_at
  scope / metadata JSON
```

Encrypt at rest (`cryptography.fernet` with a key from env). One row per
provider. Every API client reads/refreshes through it.

### 1.2 A shared outbound HTTP client

One helper with: timeout, retry with exponential backoff on 5xx/429, structured
logging of request/response (secrets redacted), and a per-provider rate limiter.
Three integrations against three flaky third parties will otherwise grow three
inconsistent copies of this.

### 1.3 Raw payload storage

For every inbound artifact — an Airbnb email, a WhatsApp webhook, a TTLock API
response — **store the raw payload before parsing it**, keyed by the provider's
own ID.

This is the single most important architectural decision across all three
projects. It means:

- Parser bugs are fixable by re-running over stored data, with no re-fetch and no
  data loss.
- Idempotency is free: seen ID → skip.
- Debugging a "why did it get this wrong" question is possible at all.

### 1.4 Scheduling

There is no queue. Follow the `sync_calendars` precedent: each integration gets
an idempotent management command, safe to run repeatedly, scheduled via Render
cron. Webhooks (WhatsApp only) store-and-return-200 immediately; the cron tick
does the actual processing.

### 1.5 Review queues

All three produce "I couldn't decide this, a human must" cases. Route them all
into the existing **Needs Attention** page rather than inventing three new
inboxes:

- Door code failed to issue / lock unreachable
- Unknown Airbnb listing needs a property match
- Email parsed but couldn't be matched to a reservation
- WhatsApp message from an unrecognised number

---

## 2. Project 1 — TTLock Integration

### 2.1 The blocking question, before anything else

TTLock has two fundamentally different modes, and **your requirements only work
in one of them**:

| | Cloud-generated passcode | Custom passcode |
|---|---|---|
| Endpoint | `/v3/keyboardPwd/get` | `/v3/keyboardPwd/add` |
| You choose the digits? | **No** — the cloud picks | **Yes** |
| Needs a gateway? | No (works offline, algorithmic) | **Yes** — WiFi gateway or WiFi lock |
| Can be deleted remotely? | Only with a gateway | Yes |

You want the code to be *the last four digits of the guest's phone*. That is a
custom passcode. **Therefore every lock must be paired with a TTLock WiFi gateway
(G2/G3) or be a WiFi-model lock.** Without a gateway you can only hand out codes
the cloud invents, and you cannot revoke them remotely — which also breaks
"expires automatically after check-out".

Before writing any code, confirm on one real lock:

1. **Gateway present and online** for every property you want automated.
2. **Minimum passcode length.** Many TTLock locks enforce a 6-digit minimum.
   Your spec says 4. If the hardware won't take 4 digits, the rule needs to
   change (e.g. last 4 digits + a 2-digit property suffix). Design the generator
   with length as a config value, not a hardcoded 4.
3. **The 1–7 keypad restriction.** No `0`, `8`, `9` is unusual — verify it's a
   real hardware limit and applies to all your locks, not just some.

Answering these three may change the spec. That's why it's step zero.

### 2.2 What you need to obtain

- A developer account at `open.ttlock.com` → `clientId` + `clientSecret`
  (approval takes a few days).
- A TTLock account that **owns** the locks. Locks held under a personal app
  account must be transferred or shared with admin rights to the account whose
  credentials the PMS uses.
- The `lockId` for each lock, plus each lock's timezone offset.
- The correct regional API host (`euapi.ttlock.com` for EU).

### 2.3 Code generation rule

Pure, self-contained logic — no network, fully unit-testable. This is the piece
worth getting exactly right.

```
1. Take reservation.guest_phone
2. Parse to the NATIONAL number, stripping the country code.
   Use the `phonenumbers` library (Google libphonenumber), not string slicing —
   "strip the prefix" is genuinely ambiguous across +383, +355, +389, +49, ...
   and hand-rolled slicing will silently produce wrong codes.
3. Take the last N digits (N = configurable, default 4).
4. Validate: every digit ∈ {1..7}.
      valid   → candidate code, source = "phone"
      invalid → generate random over the alphabet {1..7}, source = "random"
5. Uniqueness check: not equal to any other code active on THIS lock during an
   overlapping date window.
      collision → generate random, source = "backup"
      retry up to K times, then fail loudly into Needs Attention
```

**Note the collision space.** 4 digits over a 7-symbol alphabet is 7⁴ = 2,401
possible codes. That's fine for a handful of concurrent guests per lock, but it
is small — do not treat these codes as secrets, and do scope uniqueness per lock
rather than globally (two guests in different apartments sharing a code is
harmless and keeps the phone-derived rule working more often).

### 2.4 Validity window

```
valid_from = check_in  at (property check-in hour  − buffer)
valid_to   = check_out at (property check-out hour + buffer)
```

Add `checkin_hour`, `checkout_hour`, `code_buffer_minutes` to `Property`. TTLock
takes epoch **milliseconds** and the lock has its own timezone. Note that
`settings.TIME_ZONE` is `Europe/Budapest` while the properties are in Kosovo —
convert explicitly per property; do not rely on the Django default.

### 2.5 Data model

```
Property
  + ttlock_lock_id
  + ttlock_gateway_id
  + ttlock_timezone_offset
  + checkin_hour / checkout_hour / code_buffer_minutes

GuestAccessCode                     (new)
  reservation      FK
  property         FK
  code
  source           phone | random | backup
  ttlock_keyboard_pwd_id            ← returned by the API; needed to change/delete
  valid_from / valid_to
  status           pending | active | expired | revoked | failed
  attempts, last_error
  created_by, created_at
```

`DoorCode` and `LockboxCode` stay as-is — they're a manual, per-property record
of the building's own code, which is a different concept from a per-guest,
time-boxed code. Don't try to overload them.

### 2.6 Workflow

| Trigger | Action |
|---|---|
| Reservation created / confirmed | Generate + `POST /v3/keyboardPwd/add`, store `keyboardPwdId` |
| Dates changed | `/v3/keyboardPwd/change` on the stored ID |
| Cancelled or archived | `/v3/keyboardPwd/delete`, mark revoked |
| Phone number added later | Regenerate if the current code was `random` and the phone-derived one is now available |
| Nightly reconciliation | List codes on the lock, compare with DB, repair drift |

Driven by a `sync_door_codes` management command on cron, issuing codes for
reservations starting within the next N days, plus a manual **"Issue code now"**
button on the Codes page. Failures never block a reservation save — they land in
Needs Attention.

### 2.7 Phasing

0. Hardware audit — gateway, min length, charset *(no code)*
1. Credentials + token refresh service + read-only calls (list locks) → map locks
   to properties in the UI
2. Code generator, pure logic, heavily unit-tested
3. Issue / change / revoke + model + cron command
4. Codes page UI + Needs Attention integration
5. Nightly reconciliation + audit trail

---

## 3. Project 2 — Airbnb Email Integration

### 3.1 Approach and why

Reading your own mailbox is deliberately chosen over scraping Airbnb's site,
which is against their ToS. This stays within bounds.

**Recommended: Gmail API with the `gmail.readonly` scope.**

The read-only scope is not just a preference — it makes your requirement
("never send replies or make changes") *structurally impossible to violate*. The
credential physically cannot send or modify. That is a much stronger guarantee
than a code review.

Setup: a Google Cloud project → OAuth consent screen → leave it in **Testing**
mode with your own account as the sole test user (no Google verification review
needed for personal use) → one-time browser consent → store the refresh token in
`IntegrationCredential` (§1.1).

Because read-only can't mark messages as read, keep your own cursor: Gmail's
`historyId`, plus a table of processed message IDs.

*Alternative:* IMAP with an app password. Simpler, provider-agnostic, no Google
Cloud project. Use `EXAMINE` (read-only) rather than `SELECT`. Weaker isolation
guarantee and no push notifications. Reasonable if the Gmail setup stalls —
**design the fetcher behind an interface so the source can swap without touching
the parsers.**

Restrict to Airbnb at the query level, so unrelated mail is never even fetched:

```
from:(automated@airbnb.com OR express@airbnb.com OR noreply@airbnb.com)
```

### 3.2 The actual hard part: parsing

Airbnb's emails are HTML, templated, localized, and **change without notice**.
This is where the effort and the risk are — not in the mailbox connection.

Layered strategy, cheapest and most reliable first:

**Layer 1 — Confirmation code extraction.** The single most valuable field.
It appears in subjects, bodies, and links (`/reservation/itinerary?code=HM…`,
`/hosting/reservations/details/HM…`). A regex for `\bHM[A-Z0-9]{8,}\b` plus URL
parameter extraction gets it reliably. **This is the join key for everything
else.**

**Layer 2 — Structured HTML extraction.** Per-template extractors using
BeautifulSoup against label/value table structures. Fast and free, but brittle
against redesigns.

**Layer 3 — LLM fallback.** When Layer 2 can't resolve fields, send the
plaintext-rendered email to Claude with a JSON schema and get structured output
back, stored with a confidence score. This is what makes the system survive
template drift instead of silently breaking. The `ClaudeTask` model already
exists to track these runs.

**Never** discard an email you couldn't parse. Store it raw (§1.3), flag it, and
move on.

### 3.3 Prerequisite you can start today, with zero code

**Collect a corpus.** Export 50–100 real Airbnb emails covering every type:
new reservation, cancellation, alteration, payout, guest message, inquiry. In
several languages if you receive them that way.

You cannot build or test the parsers without this, and gathering it is
independent of all development. Start now, in parallel with Project 1.

### 3.4 Email types to handle

| Type | Key fields |
|---|---|
| New reservation | code, guest name, listing, dates, guests, payout total |
| Cancellation | code, who cancelled, refund |
| Alteration | code, old → new dates/price |
| Payout | amount, date, which reservations it covers |
| Guest message | code, guest, message body, timestamp |
| Inquiry / request | listing, dates, message |

⚠️ **Known limitation:** some Airbnb message-notification emails truncate the
body ("Reply to see the full message"). Where that happens you will get partial
message text and there is no way around it via email. Accept it, and show the
truncation honestly in the UI rather than pretending the message is complete.

### 3.5 Listing → property matching

```
AirbnbListing                       (new)
  airbnb_listing_id   unique
  name
  photo_url
  property            FK, nullable   ← null = awaiting your decision
  status              unmatched | matched | ignored
  first_seen / last_seen
  sample_email        FK
```

A separate model rather than reusing `Property.airbnb_listing_id`, because it
must hold the *unmatched* state, the listing name and photo, and the case where
one property has had several listing IDs over time (relisting).

Flow: unknown listing appears → row created as `unmatched`, email parked →
surfaces in Needs Attention as a card with the listing name, photo, and a sample
reservation → you pick the property from a dropdown and confirm → **all parked
emails for that listing are reprocessed automatically**. Repeat until every
listing is matched; the queue then stays empty by itself.

### 3.6 Matching an email to an existing reservation

The iCal feed creates the reservation shell; the email fills it in. Match ladder,
strictest first:

1. `platform_reservation_id` == confirmation code → exact, done
2. Listing's property + exact date range
3. Listing's property + overlapping dates + guest first name
4. No confident match → Needs Attention

If §0 lands first, level 1 will handle almost everything.

Enrichment writes: guest name, phone, guest count, real prices, payout dates and
amounts — replacing the `"Airbnb"` placeholder and `0.00` the iCal import leaves
behind. **Never overwrite a field a human has edited** — track field provenance
so manual corrections survive the next sync.

### 3.7 Messages tab

Build the Messages data model here, shared with Project 3 from day one:

```
MessageThread
  guest FK, property FK, reservation FK, channel, last_message_at, unread_count

GuestMessage
  thread FK
  source        airbnb_email | whatsapp
  direction     inbound | outbound
  body, sent_at, external_id, is_read
  raw           FK to stored payload
  is_truncated  ← for the Airbnb case above
```

Airbnb messages are read-only in the UI, as specified. One tab, filterable by
source, so adding WhatsApp later is a new row type rather than a new screen.

### 3.8 Phasing

0. Corpus collection *(no code — start now)*
1. Mailbox connection + raw ingestion + storage, no parsing at all
2. Email type classifier + confirmation code extraction
3. Per-type field extractors + LLM fallback
4. Listing→property matching UI
5. Reservation matching + enrichment writes
6. Payouts
7. Messages tab

---

## 4. Project 3 — WhatsApp Integration (Meta Cloud API)

### 4.1 What you need to obtain

- Meta Business Account with **business verification** completed (this takes the
  longest — start early).
- WhatsApp Business Platform (Cloud API) app in the Meta developer console.
- A phone number **not currently registered** on the WhatsApp consumer or
  Business app. Migrating an existing number means losing it in the app.
- A permanent System User access token (not the 24-hour dev token).
- Display name approval for the business profile.
- A public HTTPS webhook endpoint — your Render backend already qualifies.

### 4.2 The cost model — worth understanding before designing around it

Your instinct to avoid API-initiated conversations is broadly right, but the
detail matters and it may relax your constraints:

- **Replies within the 24-hour customer service window are free.** When a guest
  messages you first, you can reply free-form, unlimited, at no charge, for 24
  hours. This covers the majority of real guest support.
- **Outside that window** you must use a pre-approved template and pay per
  message. Utility templates (booking-related, e.g. check-in instructions) are
  the cheap category; marketing is the expensive one.

So: incoming-driven support is essentially free, and scheduled check-in
instructions are a low-cost *utility* template — not the expensive case you may
be picturing.

Your manual copy-paste design avoids API cost entirely, but the messages then
live outside the PMS with no thread, no delivery receipt, and no audit trail.
**Recommendation:** build the manual copy-paste flow exactly as you specified,
*and* leave room to promote check-in/check-out messages to API-sent utility
templates later once you can see the real volume and cost. Don't design that door
shut.

Practical UI detail: show a **24-hour window countdown** on each thread, so it's
obvious at a glance whether a free-form reply is still possible or a template is
now required.

### 4.3 Data model

```
MessageTemplate
  name, category, language
  body with {placeholders}
  meta_template_name        ← if registered/approved with Meta
  status

ScheduledCommunication            ← the daily reminder list
  reservation FK
  kind        checkin_instructions | checkout_instructions | welcome | review_request | custom
  due_date
  rendered_body               ← placeholders already filled in
  phone
  status      pending | reviewed | sent | skipped
  reviewed_by, reviewed_at
```

Generated nightly by a management command from upcoming reservations (check-in
tomorrow → check-in instructions due today). Reuses `GuestMessage` /
`MessageThread` from §3.7.

### 4.4 Messages tab behaviour

**Daily reminders panel** — exactly as you described: guests due check-in
instructions, guests due check-out instructions, other scheduled comms; each row
with a checkbox to mark reviewed/done, the guest's phone number, and the prepared
message with a copy button.

**Incoming messages** — display the message, suggest a response (rule-based
keyword→template first; LLM ranking as a later refinement), let you edit it
freely, and require an explicit Send press.

### 4.5 The never-auto-send guarantee

You asked for this as a rule; make it an architectural property rather than a
convention:

- Exactly **one** function can send: `send_whatsapp_message(...)`, and it
  **requires an authenticated `User` argument**. There is no default.
- No scheduler, cron command, signal handler, or webhook handler may call it.
  Enforce with a test that greps the call graph.
- Every send writes an audit row recording which user pressed the button.

That way "no automatic replies" is enforced by the type signature, not by
everyone remembering.

### 4.6 Webhook handling

Meta retries aggressively and expects a fast 200.

- Validate `X-Hub-Signature-256` HMAC on every request. Reject unsigned.
- Store the raw payload, return 200 immediately, process on the next cron tick.
- Deduplicate on the Meta message ID — retries *will* deliver duplicates.
- **Media** (guests send passport photos, ID scans): the media URL is
  short-lived and needs the access token to fetch. Download and store promptly or
  it's lost. Ties into the existing `model_defs/attachments.py`.

### 4.7 Number → guest matching

Normalize everything to E.164, then match against `Guest.whatsapp_number`,
`Guest.phone`, `Reservation.guest_phone`. No match → an "Unlinked" bucket with a
manual link action.

Expect a meaningful unlinked rate at first: Airbnb masks guest phone numbers
until close to check-in, so Project 2's enrichment directly improves this hit
rate. Another reason for the ordering below.

### 4.8 Phasing

1. Meta account + business verification *(start immediately — longest lead time)*
2. Webhook receiver, signature validation, raw storage, no processing
3. Inbound messages into the Messages tab, threading, number matching
4. Templates + `ScheduledCommunication` generator + daily reminders panel
5. Manual send with confirmation + audit
6. Suggested replies

---

## 5. Recommended order

**Do Project 1 (TTLock) first.** Smallest scope, clearest specification, no
parsing or ML risk, and the highest daily operational value. It's also the best
shakedown for the shared foundations in §1.

**Project 2 (Airbnb email) second** — biggest payoff, but the longest tail of
parser maintenance. Its Messages tab work is a prerequisite for Project 3.

**Project 3 (WhatsApp) third** — depends on reliable guest phone numbers, which
Projects 1 and 2 both improve, and on the Messages tab built in Project 2.

Three things run in parallel from day one because they're waiting on other
people, not on you:

- TTLock developer account approval
- Meta business verification
- Airbnb email corpus collection

Start all three now regardless of which project you code first.

---

## 6. Open questions

**TTLock**

1. Does every lock have a WiFi gateway? *(If no → the phone-derived code rule is
   not achievable on those locks.)*
2. Do the locks accept 4-digit codes, or is there a 6-digit minimum?
3. Is the 1–7 keypad restriction confirmed across all locks?
4. What happens on an early checkout — revoke immediately, or let it expire?

**Airbnb email**

5. Is the mailbox Gmail? *(Determines Gmail API vs IMAP.)*
6. Do your Airbnb emails arrive in one language or several?
7. Does your iCal `DESCRIPTION` contain the reservation URL and phone last-4?
   *(§0 — check this first.)*
8. Should payout data write into the existing finance models, or stay on the
   reservation?

**WhatsApp**

9. Do you have a spare phone number for the API, or does an existing one need
   migrating?
10. Is the business already verified with Meta?
11. Should the Messages tab be admin-only, or visible to the management role too?
