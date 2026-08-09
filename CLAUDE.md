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

    cd backend && .\.venv\Scripts\python.exe manage.py test pms     # 80 tests
    cd frontend && npx tsc -b --force && npm run build

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
  `.html` execute as script when served back).
- **The Django admin stays disabled** (`DJANGO_ADMIN_ENABLED`). It bypasses 2FA
  and its session is trusted by the whole API.
- **Public booking endpoints never leak** exact coordinates, door codes, wifi
  passwords, or financials.

## Conventions

- Expense statistics are keyed by **expense month** (`start_year`/`start_month`
  plus recurrence) — never invoice date or payment date.
- Paid status is per month (`ExpensePayment` rows), not a flag on the expense.
- All pricing goes through `calculate_price` in `views/_pricing.py`. Do not add
  a second price calculation.
- Backend returns camelCase JSON; frontend types live in `frontend/src/types/domain.ts`.
- Never commit secrets. `backend/.env` is real config (gitignored);
  `backend/.env.example` is a tracked template — placeholders only.
