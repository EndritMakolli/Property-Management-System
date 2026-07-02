"""
Google Sheets reservation sync.

Mirrors reservations into a spreadsheet with **one tab per month** (January …
December) for a single target year (GOOGLE_SHEETS_YEAR, default: current year).
A reservation lives on the tab for its check-in month; editing its check-in into
another month moves the row to the matching tab. Other years are never written,
so when a new year begins a rebuild (`sync_sheets`) replaces last year's data.

Each tab matches the reservations-page layout exactly:
  Emri & Mbiemri | Payment Due | Pagesa | Numri | Lloji rezervimit | Banesa |
  Lloji i baneses | Check-in | Check-out | Totali i nateve | Pagesa per nate |
  Totali i pageses
A 13th column (M) holds the reservation id so edits/deletes locate the right
row; it is hidden. Each tab gets a frozen, bold header, a filter (for sorting),
and a checkbox for the "Pagesa" column.

The integration is *optional and best-effort*:
  - It is a no-op unless GOOGLE_SHEETS_ID (and a service-account credential) is set.
  - Every public call swallows and logs errors, so a Sheets outage can never break
    a reservation save (the signal layer also runs these off the request thread).

Configure via settings / .env:
  GOOGLE_SHEETS_ID                 spreadsheet id (from its URL)
  GOOGLE_SHEETS_CREDENTIALS_FILE   path to a service-account JSON key, or
  GOOGLE_SHEETS_CREDENTIALS_JSON   the same key inline as JSON
  GOOGLE_SHEETS_YEAR               year to mirror (default: current year)
Share the spreadsheet with the service account's email (Editor) first.
"""

import json
import logging
import threading
import time
from collections import defaultdict

from django.conf import settings
from django.utils.timezone import localdate

logger = logging.getLogger(__name__)

# The signal layer fires each mirror call on its own background thread, so two
# quick saves of the same reservation could both miss find() and both append —
# a duplicate row. Serialize writes within this process; upsert additionally
# self-heals by deleting extra rows for the same id, which also repairs any
# duplicate created across processes.
_write_lock = threading.Lock()

# Visible columns, in the exact order of the reservations page.
HEADER = [
    "Emri & Mbiemri", "Payment Due", "Pagesa", "Numri", "Lloji rezervimit",
    "Banesa", "Lloji i baneses", "Check-in", "Check-out",
    "Totali i nateve", "Pagesa per nate", "Totali i pageses",
]
ID_HEADER = "ID"               # hidden 13th column (M), used to find a row
HEADER_ROW = HEADER + [ID_HEADER]
VISIBLE_COLS = len(HEADER)     # 12 (A–L); the id sits in column 13 (M)
ID_COLUMN = VISIBLE_COLS + 1   # 1-based column number of the id (13)
GRID_ROWS = 500                # rows per tab; filter/checkbox cover this range

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

# Match the reservations-page dropdown labels (reservationOptions.ts).
PLATFORM_LABELS = {
    "private": "Private",
    "airbnb": "Airbnb",
    "booking": "Booking",
    "maintenance": "Maintenance",
    "direct": "Direct",
}


def is_enabled() -> bool:
    """True when a spreadsheet id and some credential are configured."""
    return bool(
        getattr(settings, "GOOGLE_SHEETS_ID", "")
        and (
            getattr(settings, "GOOGLE_SHEETS_CREDENTIALS_FILE", "")
            or getattr(settings, "GOOGLE_SHEETS_CREDENTIALS_JSON", "")
        )
    )


def target_year() -> int:
    """The single year mirrored into the sheet (0/unset → current year)."""
    return getattr(settings, "GOOGLE_SHEETS_YEAR", 0) or localdate().year


def reservation_to_row(reservation) -> list:
    """Flatten a Reservation into a visible row (order matches HEADER)."""
    return [
        reservation.guest_name or "",
        reservation.payment_due.isoformat() if reservation.payment_due else "",
        "TRUE" if reservation.paid else "FALSE",
        reservation.guest_phone or "",
        PLATFORM_LABELS.get(reservation.platform, reservation.platform),
        reservation.property.name,
        reservation.property.apartment_type or "",
        reservation.check_in.isoformat(),
        reservation.check_out.isoformat(),
        reservation.nights,
        str(reservation.nightly_price_eur),
        str(reservation.total_price_eur),
    ]


# ── gspread plumbing ─────────────────────────────────────────────────────────

def _column_letter(index_1_based: int) -> str:
    letters = ""
    n = index_1_based
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def _retry(func, *args, **kwargs):
    """Call a gspread operation, backing off on 429 (rate-limit) responses.

    Google allows ~60 write requests/minute/user; a large rebuild can brush
    that ceiling. Sleeping past a minute clears the window.
    """
    import gspread

    for delay in (15, 30, 60, 0):  # last attempt re-raises on failure
        try:
            return func(*args, **kwargs)
        except gspread.exceptions.APIError as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 429 and delay:
                logger.warning("Sheets rate-limited; retrying in %ss", delay)
                time.sleep(delay)
                continue
            raise


def _client():
    import gspread

    cred_json = getattr(settings, "GOOGLE_SHEETS_CREDENTIALS_JSON", "")
    if cred_json:
        return gspread.service_account_from_dict(json.loads(cred_json))
    return gspread.service_account(filename=settings.GOOGLE_SHEETS_CREDENTIALS_FILE)


def _spreadsheet():
    return _client().open_by_key(settings.GOOGLE_SHEETS_ID)


def _layout_requests(sheet_id: int, n_data_rows: int) -> list:
    """Batch requests to lay out a tab, scoped to the actual data extent.

    Scoping the filter and the "Pagesa" checkboxes to the real rows (rather than
    the whole 500-row grid) keeps the table tidy — no trailing empty checkboxes
    to wade through, and sorting only touches real reservations.
    """
    last_excl = n_data_rows + 1  # header is row 0; data is rows 1..n_data_rows
    requests = [
        {  # freeze the header row
            "updateSheetProperties": {
                "properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}},
                "fields": "gridProperties.frozenRowCount",
            }
        },
        {  # bold + tinted header
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1,
                    "startColumnIndex": 0, "endColumnIndex": VISIBLE_COLS,
                },
                "cell": {"userEnteredFormat": {
                    "textFormat": {"bold": True},
                    "backgroundColor": {"red": 0.85, "green": 0.92, "blue": 0.83},
                }},
                "fields": "userEnteredFormat(textFormat,backgroundColor)",
            }
        },
        {  # hide the id column
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                          "startIndex": VISIBLE_COLS, "endIndex": VISIBLE_COLS + 1},
                "properties": {"hiddenByUser": True},
                "fields": "hiddenByUser",
            }
        },
        {  # filter over header + data → click a header to sort
            "setBasicFilter": {"filter": {"range": {
                "sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": last_excl,
                "startColumnIndex": 0, "endColumnIndex": VISIBLE_COLS,
            }}}
        },
        {  # clear any stale checkboxes across the whole column first
            "setDataValidation": {"range": {
                "sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": GRID_ROWS,
                "startColumnIndex": 2, "endColumnIndex": 3,
            }}
        },
    ]
    if n_data_rows > 0:
        requests.append({  # "Pagesa" (column C) as checkboxes, data rows only
            "setDataValidation": {
                "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": last_excl,
                          "startColumnIndex": 2, "endColumnIndex": 3},
                "rule": {"condition": {"type": "BOOLEAN"}, "showCustomUi": True},
            }
        })
    return requests


def _apply_layout(spreadsheet, worksheet, n_data_rows: int) -> None:
    _retry(spreadsheet.batch_update, {"requests": _layout_requests(worksheet.id, n_data_rows)})


def _month_worksheet(spreadsheet, month: int, create: bool):
    """Return the worksheet for a 1-based month (signal path).

    Creates, headers and formats it on demand when missing.
    """
    import gspread

    name = MONTHS[month - 1]
    try:
        return spreadsheet.worksheet(name)
    except gspread.WorksheetNotFound:
        if not create:
            return None
        worksheet = _retry(
            spreadsheet.add_worksheet, title=name, rows=GRID_ROWS, cols=ID_COLUMN
        )
        _retry(worksheet.update, range_name="A1", values=[HEADER_ROW])
        _apply_layout(spreadsheet, worksheet, 0)
        return worksheet


# ── Public, error-swallowing operations ──────────────────────────────────────

def upsert_reservation_row(reservation_id: str, row: list, year: int, month: int) -> None:
    """Update the reservation's row in its month tab, or append it if absent."""
    if not is_enabled() or year != target_year():
        return
    try:
        with _write_lock:
            spreadsheet = _spreadsheet()
            worksheet = _month_worksheet(spreadsheet, month, create=True)
            full = list(row) + [reservation_id]
            cells = _retry(worksheet.findall, reservation_id, in_column=ID_COLUMN)
            if cells:
                last_col = _column_letter(len(full))
                _retry(
                    worksheet.update,
                    range_name=f"A{cells[0].row}:{last_col}{cells[0].row}",
                    values=[full], value_input_option="USER_ENTERED",
                )
                # Self-heal: drop accidental duplicate rows (bottom-up so the
                # remaining row numbers stay valid while deleting).
                for cell in sorted(cells[1:], key=lambda c: c.row, reverse=True):
                    _retry(worksheet.delete_rows, cell.row)
            else:
                _retry(worksheet.append_row, full, value_input_option="USER_ENTERED")
                # Extend the filter + "Pagesa" checkbox to cover the new row.
                data_rows = len(_retry(worksheet.col_values, ID_COLUMN)) - 1
                _apply_layout(spreadsheet, worksheet, data_rows)
    except Exception:  # noqa: BLE001 — never let Sheets break a save
        logger.exception("Google Sheets upsert failed for reservation %s", reservation_id)


def remove_reservation_row(reservation_id: str, year: int, month: int) -> None:
    """Delete the reservation's row from its month tab, if present."""
    if not is_enabled() or year != target_year():
        return
    try:
        with _write_lock:
            worksheet = _month_worksheet(_spreadsheet(), month, create=False)
            if worksheet is None:
                return
            cells = _retry(worksheet.findall, reservation_id, in_column=ID_COLUMN)
            for cell in sorted(cells, key=lambda c: c.row, reverse=True):
                _retry(worksheet.delete_rows, cell.row)
    except Exception:  # noqa: BLE001
        logger.exception("Google Sheets remove failed for reservation %s", reservation_id)


def _ensure_month_tabs(spreadsheet):
    """Create any missing month tabs and drop the obsolete single-tab sheet.

    Done in one batched request to stay well under the write-rate limit.
    Returns ({month: worksheet}, {months that were freshly created}).
    """
    existing = {ws.title: ws for ws in spreadsheet.worksheets()}
    requests = []
    created = set()
    for month in range(1, 13):
        name = MONTHS[month - 1]
        if name not in existing:
            created.add(month)
            requests.append({"addSheet": {"properties": {
                "title": name,
                "gridProperties": {"rowCount": GRID_ROWS, "columnCount": ID_COLUMN},
            }}})
    if "Reservations" in existing:  # leftover from the earlier single-tab version
        requests.append({"deleteSheet": {"sheetId": existing["Reservations"].id}})

    if requests:
        _retry(spreadsheet.batch_update, {"requests": requests})
        existing = {ws.title: ws for ws in spreadsheet.worksheets()}

    return {month: existing[MONTHS[month - 1]] for month in range(1, 13)}, created


def sync_all() -> int:
    """Rebuild all 12 month tabs for the target year. Returns the count synced."""
    from .models import Reservation

    year = target_year()
    reservations = list(
        Reservation.objects.filter(is_archived=False, check_in__year=year)
        .select_related("property")
    )
    by_month = defaultdict(list)
    for reservation in reservations:
        by_month[reservation.check_in.month].append(reservation)

    spreadsheet = _spreadsheet()
    month_tabs, created = _ensure_month_tabs(spreadsheet)

    layout_requests = []
    for month in range(1, 13):
        worksheet = month_tabs[month]
        month_reservations = by_month.get(month, [])
        if month not in created:  # freshly created tabs are already empty
            _retry(worksheet.clear)
        rows = [HEADER_ROW] + [
            list(reservation_to_row(r)) + [str(r.id)] for r in month_reservations
        ]
        _retry(worksheet.update, range_name="A1", values=rows,
               value_input_option="USER_ENTERED")
        layout_requests.extend(_layout_requests(worksheet.id, len(month_reservations)))

    _retry(spreadsheet.batch_update, {"requests": layout_requests})
    return len(reservations)
