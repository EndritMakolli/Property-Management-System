# PMS — working agreements

Django + React property management system. Backend `backend/pms` (views split
under `views/`, models under `model_defs/`), frontend `frontend/src`.

## Always use these tools

**graphify — before exploring the codebase.**
`graphify-out/graph.json` holds a knowledge graph of this project (1,836 nodes,
4,440 edges, 130 communities). For any question about architecture, "what calls
X", "where does Y live", or how subsystems connect, query the graph FIRST
instead of grepping blind:

    graphify query "how does the booking flow work"
    graphify path "BookingRequest" "Reservation"
    graphify explain "calculate_price"

Rebuild after significant changes: `/graphify . --update` (incremental) or
`/graphify .` (full). Outputs are gitignored.

**superpowers — before writing code.**
Invoke the relevant superpowers skill BEFORE responding or acting, per its
`using-superpowers` rule. In particular:

- New feature or "let's build X" → `brainstorming` first, then `writing-plans`.
- A bug, or anything failing → `systematic-debugging`. Do not guess-and-patch.
- Implementing → `test-driven-development`.
- Before saying work is done → `verification-before-completion`.
- Multi-step or parallelisable work → `dispatching-parallel-agents`,
  `subagent-driven-development`.

Announce which skill is being used and follow it exactly.

## Verification (never skip)

This project has real tests. Before claiming anything works:

    cd backend && .\.venv\Scripts\python.exe manage.py test pms     # 988 tests
    cd frontend && npx tsc -b --force && npm run build && npm test    # 508 tests
    cd backend && .\.venv\Scripts\python.exe manage.py check --deploy  # before releasing

Use the venv interpreter `backend\.venv\Scripts\python.exe` — the system
`python` on this machine has no Django installed.

## Security invariants — do not regress these

The app is publicly hosted and holds guest PII (passport/ID scans) and
financial records. A pre-hosting audit fixed these; keep them true:

- **Password alone must never create a session** when 2FA is on. The login
  endpoint returns a challenge; only `/api/auth/login/verify/` logs a user in.
  Email failure must fail CLOSED, never fall back to password-only.
- **ID documents are never served from `/media/`.** They go through the
  role-checked `guest_document_download` view. `backend/urls.py` blocks the
  `guests/` media prefix outright.
- **Every new endpoint needs `require_roles(...)`** as its first lines. There is
  no default-deny; protection is per-view and hand-written.
- **Every upload path calls `_validate_upload`** (extension-based — `.svg` and
  `.html` execute as script when served back). The property **cover** photo was
  the one path that did not, on both create and edit, so an `.svg` could be
  stored and served from `/media/` as an apartment's cover; `tests_property_cover.py`
  now holds that door shut. Count call sites per *path*, not per file — the
  cover was missed by counting imports.
- **The declared Content-Type is not a security control.** It is the client's
  claim about its own file, so an attacker just sets one that passes. It is
  read from the uploading machine's registry, which is why Windows sends
  `application/octet-stream` for `.webp` and `.avif` and got honest photos
  refused. `_validate_upload` accepts an unknown type once the *extension*
  passes, and the extension list stays strict.
- **`SECURE_CONTENT_TYPE_NOSNIFF` stays on, so a served file's declared type is
  the only thing the browser will act on.** Django takes that from Python's
  `mimetypes`, which on Windows reads the registry and knows neither `.avif`
  nor `.webp` — both came back as `application/octet-stream` and rendered as
  broken images. `settings.py` registers them with `mimetypes.add_type`. Adding
  an image format to the allow-list means registering it there too, and
  checking the production web server's own `mime.types` knows it.
- **Accepted image formats live in two places that must agree:**
  `ALLOWED_EXTENSIONS` in `views/_expense_ai.py` and `ACCEPTED_PHOTO_EXTENSIONS`
  in `features/properties/photoUploads.ts`. A picker offering more than the
  server takes is how twelve uploads failed with no reason shown.
- **A contract carries no ID document and no property secret.** It is printed
  and handed to the guest. `(guest id number)` is a number written in by hand -
  there is no such field on `Guest`, and it must never be wired to
  `id_document_url`, which links to a passport scan behind the role-checked
  download view. `tests_contracts.ContractNeverLeaksIdDocumentsTests` greps the
  raw response for the document URL, the wifi password and the coordinates.
- **Sync never cancels on one missed fetch, and never deletes.** A feed is an
  unreliable narrator - truncated mid-transfer, served stale, or simply
  omitting a booking. `import_ical_reservations` therefore reconciles only when
  three guards hold: the feed produced a valid event, it *ended* with
  `END:VCALENDAR` (`feed_looks_complete` - three of forty arriving must not
  read as thirty-seven cancellations), and the row carries `created_by_sync`.
  Absence is then recorded as `missing_from_sync_since` and left on the
  calendar; only after `MISSING_GRACE` does it archive. A booking a person
  typed in is never the feed's to cancel, even after adoption gave it the
  channel's UID. `tests_sync_safety.py` holds all of this.
- **Two calendar imports must never overlap.** Both reconcile the same
  apartment against two different snapshots of the same feed, and the slower
  fetch wins - so the calendar reflects a race, not a decision. `SyncRun` is a
  database lock, not a process one, because the importer is started from a
  scheduler, from the web process and from a terminal, which share nothing but
  the database. A run that stops beating for `STALE_RUN_AFTER` has died holding
  the lock and may be taken over; one that is merely slow has not.
  `views/_sync_schedule.py` owns all of this and writes no reservations.
- **A feed that cannot be reached is retried on a backoff, never hammered and
  never left for its whole interval.** `ChannelSyncState` carries the clock:
  five minutes doubling to four hours, cleared by a success. It is also what
  lets the page say *why* a feed is behind instead of showing a stale timestamp
  with no explanation.
- **Listing the archive must never delete.** It used to purge every row
  archived over 30 days ago - a GET that destroyed data, and the second half of
  "sync deleted my reservation": sync archives it, a month later someone opens
  the tab and it is gone. 14 live rows were one page-view from deletion.
- **The Django admin stays disabled** (`DJANGO_ADMIN_ENABLED`). It bypasses 2FA
  and its session is trusted by the whole API.
- **Public booking endpoints never leak** exact coordinates, door codes, wifi
  passwords, or financials.
- **A booking request needs a reachable email, and the server is what enforces
  it.** The browser demanded one and `booking_create_request` did not, so a
  request could be stored with nobody to send anything to - which is why both
  stored requests had `guest_email=''`, no `GuestAccount` has ever existed, and
  neither the approval nor the decline email ever had an address. It is
  lowercased on the way in, because `has_website_booking` matches on a
  lowercased address and a phone keyboard's capitals would lock the guest out of
  the portal they just earned.
- **`booking_create_direct` stays off** (`ONLINE_PAYMENTS_ENABLED`, default
  False). Its payment step is a stub: it writes a *confirmed* reservation
  recording `payment_status = FIRST_NIGHT` or `FULL` with no provider behind it,
  so the money is fiction - revenue includes it, and `cancellation_outcome`
  would refund `online_payment_amount`, money never received. The switch turns
  the feature off; it does not delete it.
- **No cancellation policy configured means "get in touch", not "have it all
  back".** An empty `CancellationPolicy` table used to auto-cancel and refund in
  full - a commercial term nobody had agreed to, applied because nothing was
  set up. Absence of a policy is not a generous policy.
- **An endpoint must not tell a guest something happened when nothing did.**
  `booking_change_request` answered "we will contact you shortly" and stored
  nothing; it is gone. A feature that needs a record needs somewhere to put it
  and a staff surface to read it.
- **Production config is checked, not hoped for.** `pms/checks.py` fails
  `manage.py check --deploy` on DEBUG, on a localhost or unset
  `GUEST_PORTAL_URL`, and warns on a consumer mailbox as sender or online
  payments being on. They are **deploy-scoped** deliberately: the test runner
  forces DEBUG=False, so an ordinary check would fire on the dev config and
  abort every test run.
- **A guest is never a Django user.** `GuestAccount` has its own session key and
  its own `require_guest`. `request.user` stays anonymous for a guest, which is
  why every `require_roles` endpoint already rejects them. Never put a guest in
  a Group; `tests_guest_isolation` asserts 401 across the staff surface.
- **`user_role()` denies by default.** A user with no group resolves to `""`,
  not `ROLE_CLEANING` — cleaning can read every door code in the building.
- **`views/_guest_ownership.py` is the entire ownership rule.** Never filter a
  guest's bookings anywhere else. Only website bookings, matched on a lowercased
  email, and only a `Reservation` a `BookingRequest` points at — so nothing
  staff typed in and nothing a channel imported can surface in a portal.
- **Only `guest/auth/request-link/` and `guest/auth/verify/` are `@csrf_exempt`.**
  Everything reading or mutating guest data keeps Django's protection. The guest
  serializer is an allow-list: no address until the booking is confirmed, and
  never a door code, lockbox code, wifi password, coordinate or `GuestDocument`.

## Conventions

- **Revenue is attributed to the month its nights fall in**, never to the month
  a stay began. `revenueInsideMonth` in `features/reports/reportCalculations.ts`
  is the only place that decides this: `totalPaid / totalNights x nightsInMonth`.
  It divides by the stored `totalNights`, which is safe only because
  `Reservation.save()` recomputes `nights` from the dates on every write — keep
  it that way, and never bulk-`update()` a check-in or check-out around it.
  The reservation *list* endpoint must keep its overlap filter
  (`check_in__lte=month_end, check_out__gt=month_start`); a containment filter
  would drop boundary-spanning stays before the proration ever saw them.
  `reportCalculations.test.ts` pins all of this.
- **Monthly rent is no exception — it prorates by night too.** Rent is
  *collected* per anniversary period (`buildDueRows`, unchanged: a started
  period is owed in full, and `paymentPeriods.test.ts` holds that), but a report
  answers a different question. Crediting the whole instalment to the month the
  period began put all 31 nights of a 23 Aug → 23 Sep tenancy into August —
  overstating it by the 22 nights that are September's and leaving September
  with occupied nights worth nothing. Collection is cash, reporting is accrual;
  never let a change to one drag the other with it.
- **Every statistic on the Reports page reconciles to the same month total.**
  `revenueInsideMonth` is the only revenue rule; "Reservations by nights"
  (`nightsBuckets.ts`) buckets by whole-stay length but credits only the
  month's nights, so its cards sum to the turnover figure exactly. If a new
  panel sums `totalPaid` directly, it is wrong.
- **Never filter guests through `reservations__...` on `annotated_guests()`.**
  It joins the reservation table a second time and every `Sum` is counted once
  per join - one client went from 1092 nights to 2184 and 22,602 EUR to 45,204.
  `Count(distinct=True)` survives it; `Sum` does not. Select ids through a
  subquery (`pk__in=Reservation.objects.filter(...).values(guest_id)`), as
  `stayed_within` does. `tests_clients.AggregatesSurviveFilteringTests` fails
  the moment the join comes back.
- **A maintenance issue is resolved, not deleted.** It had no state at all, so
  the only way to clear one was DELETE - the list could say what was outstanding
  and never what had been dealt with, and it was the one place in the app that
  destroyed rather than archived. `is_resolved`/`resolved_at`/`resolved_by`, the
  list shows open by default, and Delete survives only for a row entered by
  mistake.
- **A client is archived, not deleted.** `Guest.is_archived` hides them from the
  directory and keeps their history; permanent delete is reachable only from the
  Archive tab. The iCal import invents a client named after the channel
  (`Airbnb`, 42 stays), so `without_channel_placeholders` hides rows named after
  a `ReservationType` that carry no phone and no email - hidden, never deleted,
  because reservations still point at them.
- **"Today" is a dashboard popup, not a page, and holds two groups.** Arrivals
  and departures only: nobody greets a guest who is mid-stay and nobody cleans
  for them, so they are dropped by `splitDay` even though the server's `?day=`
  filter returns them - that filter answers a more general question. The cards
  are the reservation cards, photo and all, because staff already read those.
- **The arrival message carries the access details, built by the codes page's
  own function.** `buildArrivalMessage` composes greeting + dates +
  `buildDoorCopyText`, never a second copy of that wording. A field the
  apartment has not recorded contributes no line: "Wi-Fi Password: —" is worse
  than nothing in a message somebody receives. The departure message carries
  none of it.
- **A guest is "currently hosting" from the day they arrive until the day they
  leave, and not on the day they leave** — `check_in <= today < check_out`.
  Server side that is `?hosting=1` on the reservation list; client side it is
  `currentlyHosting` in `features/clients/hostingView.ts`. Both exist because
  the list must stay right as midnight passes without a reload.
- **The garage card is one boolean on the *reservation*, not the guest.** It is
  issued on arrival and taken back on departure, so a returning guest starts
  unticked and the list answers "who holds one right now". It has no
  who/when columns: `TRACKED_FIELDS` in `views/_reservations.py` already writes
  a `ReservationAuditLog` row for every field it lists.
- **The privacy switch hides money only.** `PrivacyProvider` sets
  `data-privacy="on"` on the document root and one CSS rule in `shared.css`
  blurs `.money` and `.money-chart`. Counts, occupancy, names and apartments
  stay readable so the PMS is still usable. A new currency figure needs the
  `money` class; `Metric` and `ComparePanel` decide for themselves via
  `looksLikeMoney`, because they are handed "EUR 26,544" and "94%" alike. The
  guest-facing site is deliberately unmarked — the switch is a PMS thing.
- **A contract is a document, not a block of text.** The template holds the
  *terms only*; the logo, both parties, the stay summary and the signature
  block are laid out by `ContractModal` from structured data, reusing the
  invoice's `.inv-doc*` classes so the two look like one company. Never put
  the company address back into a template body - it is already on
  `CompanyProfile`.
- **A contract can be edited, put down and picked up again.**
  `ReservationContract` holds one saved draft per reservation *per language* -
  the Albanian and English contracts are two documents, and editing one must not
  overwrite the other. A reservation with no row still renders from
  `ContractTemplate`, so nothing changed for a contract nobody has touched. A
  saved draft is returned **exactly as typed and never re-rendered**: running it
  back through the engine would resolve placeholders the operator deliberately
  left in, and a draft that quietly refreshes itself has thrown the edit away.
  Resetting is a DELETE of the row; the reservation is not the contract's to
  delete. `tests_contract_drafts.py` holds all of it, including that a stored
  draft carries no passport scan and no wifi password.
- **An optional `[segment]` opens and closes on one line.** `render_template`
  resolves a line at a time, so a segment split over two never matches: the
  brackets print literally and the placeholder inside is reported unresolved.
  `booking_rejected` shipped that way in both languages, and because the two
  emailed outcomes refuse to send with a placeholder left in, declining a
  booking *without typing a reason* sent the guest nothing at all. Migration
  0061 repaired the stored rows, `_0045_lifecycle.py` fixes the seed, and
  `tests_message_audit.py` fails if it ever comes back. Do not "fix" this by
  counting brackets per line - contract clauses are numbered `a)`, `b)`, `c)`,
  so an unbalanced parenthesis is ordinary prose; what breaks is a placeholder
  whose *name* spans lines. See `docs/guest-messages-audit.md` for the full
  inventory of what the system sends and what it does not.
- **Contracts share the message-template engine.** `ContractTemplate` holds one
  apartment and one vehicle draft in both languages, seeded by migration 0050
  and edited under Templates. `render_template` from `views/_drafts.py` fills
  them - never write a second placeholder engine. It resolves **a line at a
  time**, so an optional `[segment]` must open and close on the same line; split
  over two it never matches and the placeholder inside is reported missing.
- **An invoice knows whether it bills a person or a company.** `client_type`
  decides which reference is asked for and printed: an individual carries
  `client_id_number` and has *no* VAT or tax number - that is a complete
  invoice, not a draft - while a business carries tax id, VAT id and
  registration number. Only the name is required either way. Existing rows
  default to `business`, which is what they always were.
- **The contract is the operator's own paper form, rebuilt.** Centred
  letterhead, black section bars, bordered label/value tables, terms in a box,
  signature line - see `ContractModal`. A hire agreement names *this* car, so
  `brand`, `model`, `chassis_number`, `licence_plate` and `allowed_countries`
  live on the fleet `Property` and are filled in on the Service page. The
  second-driver column is deliberately blank: it is completed by hand at the desk.
- **A vehicle is a `Property` with `platform="fleet"`**, so its service record
  lives there. `vehicle_alerts` in `views/_fleet.py` is the only place that
  decides whether a van is due: the codes page, the notifications bell and any
  future report all call it, so they cannot disagree. Two clocks run - months
  since the last service and kilometres since it - and whichever comes first
  wins, but a vehicle overdue on both still reports **one** service to book.
- **Notifications are computed, never stored.** Every source is a fact about
  current state, so the feed cannot go stale and nothing has to retract a
  reminder for a service already done. Only the *reading* is stored, per user,
  in `NotificationRead`. The key carries a fingerprint of the state behind it,
  so an alert dismissed, dealt with, and later triggered again comes back
  unread. `info`-severity alerts ("nothing recorded yet") are setup tasks and
  deliberately never reach the bell.
- Expense statistics are keyed by **expense month** (`start_year`/`start_month`
  plus recurrence) — never invoice date or payment date.
- Paid status is per month (`ExpensePayment` rows), not a flag on the expense.
- All pricing goes through `calculate_price` in `views/_pricing.py`. Do not add
  a second price calculation.
- A property has no price of its own. Nightly rates come from the **Base
  Prices** group; `Property.base_price_eur` was removed in migration 0034.
- Pricing groups and stay constraints belong to one **platform** (AirStay or
  Fleet) and never apply across platforms.
- A group's `behaviour` decides which of its rules apply: `stack` (all, in
  order), `exclusive` (first match), `best` (biggest discount) and `specific`
  (narrowest scope). Only `stack` and `exclusive` are order-sensitive.
- Frontend unit tests run under Vitest (`npm test`); they cover the pure
  pricing helpers in `src/components/pricing/`, not components.
- Guest replies are templates, not code. Six `MessageTemplate` rows — four
  availability scenarios plus `booking_approved` / `booking_rejected` — hold
  Albanian and English bodies, edited at `/message-templates`. `(placeholders)`
  resolve in `views/_drafts.py`; `[square brackets]` drop when empty. Never
  hardcode reply wording.
- The four availability replies are **copied** by staff, so an unfillable
  placeholder stays visible. The two booking outcomes are **emailed**, so
  `views/_guest_mail.py` refuses to send one with a placeholder left in it, and
  fails **open** — a failed send never rolls back the booking. 2FA mail is the
  opposite on both counts; don't copy its policy here.
- `ReservationType` is the single source of truth for what a booking type is
  called and its colour. `Reservation.platform` stays a plain string keyed to
  `ReservationType.code` — never convert it to a foreign key (two unique
  constraints, sync dedupe, and billing behaviour hang off the literal values).
  Built-in types can be renamed and recoloured but not deleted.
- Per-type colours are **generated at runtime** into a `<style>` tag by
  `context/ReservationTypesContext.tsx`. Do not hardcode `.platform-airbnb`
  colours in a stylesheet again — an admin can add a type no `.css` file knows.
- `Property.bathrooms` is a decimal (1.5 = one full bath, one without a shower).
  Serializers must cast it to `float`: `JsonResponse` renders a `Decimal` as a
  JSON *string*, which silently breaks the frontend's `number` type.
- The stay date picker is `components/shared/StayRangePicker` — one component,
  two palettes via `tone`. The guest site and the PMS share it.
- **Check-in and check-out are two controls, not one gesture.** Picking a whole
  range in one go is right when there is no stay yet and wrong once there is:
  changing a departure meant re-entering an arrival that was already correct,
  and one stray click wiped both. `stayRangeEdit.ts` holds what a day click
  means per mode, and check-out mode *disables* days on or before the arrival
  rather than silently rewriting it. `mode` defaults to `range`, so the guest
  site - which picks a whole stay from scratch - is unchanged.
- **A popover is portalled to `<body>`, never hung off its field.**
  `position: absolute` is measured from the nearest positioned ancestor and
  clipped by any ancestor hiding its overflow. The Pricing page's "Test a stay"
  bar is `position: sticky; z-index: 5; overflow: hidden`, which both sliced the
  calendar off at the bar's own bottom edge and sealed it into a stacking
  context five layers down — neither fixable from inside. `popoverPlacement.ts`
  does the arithmetic that replaces the browser's, and is tested without a
  layout.
- Backend returns camelCase JSON; frontend types live in `frontend/src/types/domain.ts`.
- The guest sign-in email is hardcoded security mail (following
  `views/_two_factor.py`), **not** a `MessageTemplate`. The "never hardcode
  reply wording" rule governs the six booking-reply scenarios only.
- `GUEST_PORTAL_URL` must point at the **public site**, not the API. It is where
  sign-in links land; unset, no guest can sign in.
- Reservation-type colours are generated into a `<style>` tag at runtime by
  `context/ReservationTypesContext.tsx`. Never hardcode `.platform-*` colours in
  a stylesheet again — an admin can add a type no `.css` file knows about.
- Never commit secrets. `backend/.env` is real config (gitignored);
  `backend/.env.example` is a tracked template — placeholders only.
