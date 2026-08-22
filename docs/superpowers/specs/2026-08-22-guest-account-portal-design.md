# Guest account portal — design

**Date:** 2026-08-22
**Status:** approved, not yet planned

## The problem

A guest who books through the website has no way to find out what happened to
their request, and no record of anything they have booked before. The interim
fix shipped already — the booking form now collects an email, and approving or
declining opens an editable draft that staff send — but that is a message, not a
place the guest can return to.

This adds that place: a guest signs in with an emailed link and sees the
bookings they made, with the ability to cancel one.

## Why this is not a small feature

It is a **new public login on an application that stores passport and ID scans**.
The database also holds door codes, lockbox codes, wifi passwords and every
guest's financial history. The design below is shaped almost entirely by keeping
those separated from anything a guest can reach.

## Decisions taken

| Question | Answer |
|---|---|
| Sign-in method | Emailed one-time link. No passwords. |
| Booking without an account | Stays open to everyone. An account is never required to book. |
| Whose bookings appear | Only ones the guest made themselves, matched on the email they booked with. |
| Existing history | Not back-linked. History builds from now on. |
| Arrival details | Address and floor once confirmed. Door codes and wifi never. |
| Guest can cancel | Yes, under the existing cancellation policy. |
| Guest can request changes | **No.** Out of scope. |
| Extra content | Their own numbers, and featured apartments to browse. |

## Explicitly out of scope

Named so they do not creep back in:

- **Change requests.** Today's `booking_change_request` endpoint is a stub that
  discards its payload. Building it properly needs a stored record *and* a place
  in the PMS for staff to see them. Left as-is; guests cancel or message.
- **ID document upload.** Would put an upload path for passport scans on the
  public internet. Considered and rejected.
- **Promo codes in the portal.** A code shown to every signed-in guest is a code
  every signed-in guest can use.
- **Back-linking existing history.** Nobody in the database has an email (0 of
  394 guests, 0 of 797 reservations), so there is nothing to match against.
- **Phone-based claiming.** An unverified phone number lets anyone who knows a
  guest's number read their stays and spend. Would need SMS verification first.

---

## 1 · Identity

### Guests are never Django users

`GuestAccount` is its own model — email, no password — authenticated by its own
session key (`request.session["guest_account_id"]`). A guest never becomes a
`django.contrib.auth.User`.

**This is the security design, not an implementation detail.** `request.user`
stays anonymous for a guest, so every existing `require_roles` endpoint rejects
them with 401 without being modified. A staff endpoint that someone forgets to
protect still cannot be reached by a guest session, because the two systems do
not share a notion of being logged in.

The alternative — a Django user in a "Guest" group — was rejected. `user_role()`
returns `ROLE_CLEANING` for any authenticated user with no group, and cleaning
role can read `/api/codes/door/` and `/api/codes/lockboxes/`. Under that design a
single missed group assignment hands a guest the door codes to every apartment.

### Hardening that comes with it

`user_role()`'s fallback changes from `ROLE_CLEANING` to `""` (deny). Verified
against the live database: every non-superuser has a group, so nothing breaks.
This removes the trap rather than working around it.

### `GuestAccount` is not `Guest`

The existing `Guest` model is a staff-facing CRM record, built by the guest
linker from name and phone. `GuestAccount` is a login. They are deliberately
**not** related by a foreign key: linking them would reintroduce exactly the
back-matching this design rules out, and `Guest` rows carry `GuestDocument`
attachments that must stay unreachable from a guest session.

### Models

```
GuestAccount
    id            UUID pk
    email         EmailField, unique, stored lowercased
    created_at    auto
    last_login_at nullable

GuestLoginLink
    id            UUID pk
    account       FK -> GuestAccount
    token_hash    CharField          # hashed, never stored in the clear
    expires_at    DateTime           # 20 minutes
    consumed_at   nullable
    request_ip    nullable
```

Modelled on `LoginChallenge` in `model_defs/security.py`: hashed secret,
short TTL, single use, issuing a new one invalidates the old, and a per-account
hourly cap that also bounds outbound email.

### Endpoints

All under `/api/guest/`, all `@csrf_exempt` + throttled, matching the existing
public booking endpoints.

| Endpoint | Behaviour |
|---|---|
| `POST auth/request-link/` | Always returns `{"sent": true}`, whether or not the account exists — the endpoint must not reveal who has booked with you. Rate limited per email and per IP. |
| `POST auth/verify/` | Exchanges the token for a session. Rotates the session key on success. Same error for unknown, expired and used tokens. |
| `GET auth/me/` | The signed-in account, or an anonymous shape. |
| `POST auth/logout/` | Clears the guest session key only. |
| `GET bookings/` | Their bookings, upcoming and past. |
| `GET stats/` | Their own numbers. |
| `POST bookings/<booking_request_id>/cancel/` | Cancels under the existing policy. Keyed on the `BookingRequest`, never the `Reservation` — the request is the thing the guest made, and it is the only id the ownership rule can verify. |

A new `require_guest(request)` helper gates the last three, returning 401 the way
`require_roles` does. It is the only thing that reads the guest session key.

Unlike staff 2FA — which fails **closed** — a link that cannot be emailed simply
means the guest cannot sign in. The response stays `{"sent": true}` for
enumeration resistance; the failure is logged for the operator.

## 2 · Which bookings are theirs

A booking belongs to an account when **both** hold:

1. its `guest_email` equals the account's email (compared lowercased), and
2. it originated on the website — a `BookingRequest`, or a `Reservation` reached
   through one.

Nothing staff entered in the PMS is ever matched, so there is no path by which
one person's stay appears in another person's portal. Channel imports from
Airbnb and Booking.com are likewise invisible; those guests have their own
account with the channel.

Matched at read time rather than stored at booking time, so a booking made before
the account existed appears as soon as the guest signs in. Needs an index on
`guest_email` for both models.

## 3 · Pages

| Route | Was | Becomes |
|---|---|---|
| `/login` | Staff sign-in (purple) | Guest sign-in (blue), with an "I am staff" link |
| `/staff-login` | — | The existing purple page, unchanged |
| `/account` | — | The guest's own page, behind a guest session |

The staff page moves rather than changing: same component, same styling, same
2FA flow. `/login` gets a blue variant of the same layout, so the two read as one
family.

**Two redirects have to move with it.** `RequireAuth` sends an unauthenticated
visitor to `/login`, and `defaultPathForRole` returns `/login` for an unknown
role. Both must point at `/staff-login` instead, or a staff member opening a
protected page lands on the guest sign-in and cannot get in.

`/account` holds, in order: their numbers (stays, nights, total spent, last
visit), upcoming bookings, past bookings, and featured apartments.

The numbers are computed **from the same filtered set as the bookings list** —
not from `Guest.total_stays` / `total_nights` / `total_paid_eur`. Those count
every stay including ones staff entered, so using them would contradict the
ownership rule and show a guest a total they cannot account for.

Featured apartments are the highest-rated active listings — `rating` and
`review_count` already exist on `Property`, so there is no new field and nothing
for staff to maintain.

### The client header

"Staff Login" becomes "Login" and points at `/login`. The three dead nav buttons
were already removed.

## 4 · What a booking shows

| Shown | Never shown |
|---|---|
| Apartment name, photo, bedrooms | Door codes, lockbox codes |
| Address and floor — **only once confirmed** | Wifi password |
| Dates, nights, guests | Exact coordinates beyond the address |
| Price and what is owed | Any `GuestDocument` |
| Status, and the decline reason if declined | Anything belonging to another guest |

A pending or declined request shows no address at all.

## 5 · Frontend session

`AuthProvider` currently wraps the whole app, including the public site, and
understands only staff. A second, independent `GuestAuthProvider` wraps the
client routes. The two never consult each other; a browser can hold a staff
session and a guest session at once without either noticing.

## 6 · Testing

The isolation tests matter more than the happy path:

- A guest session gets **401** from staff endpoints — `/api/properties/`,
  `/api/reservations/`, `/api/codes/door/`, `/api/guests/`.
- Account A cannot read account B's booking, by id or by any filter.
- A staff-entered reservation with a matching email does **not** appear.
- A channel (Airbnb/Booking) reservation does not appear.
- A used link cannot be replayed; an expired link is refused; unknown, expired
  and used tokens are indistinguishable in the response.
- `request-link` answers identically for a known and an unknown email.
- A pending booking exposes no address; a confirmed one does.
- Cancelling applies the cancellation policy and cannot touch another account's
  booking.
- `user_role()` returns `""` for a groupless user, and the three real roles still
  resolve.

Frontend: pure helpers only, per this project's convention — the ownership
filter and the stats calculation.

## Verification

```bash
cd backend && ./.venv/Scripts/python.exe manage.py test pms
cd frontend && npx tsc -b --force && npm run build && npm test
```

Manual, because no test can see them: a real sign-in email arriving and its link
working; the blue/purple split rendering correctly; a staff session and a guest
session coexisting in one browser.
