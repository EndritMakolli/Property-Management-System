"""Anniversary billing periods for "monthly" reservations.

A monthly stay is billed in periods that run from the check-in day: a stay
starting Jan 15 owes one full monthly price for Jan 15–Feb 15 (due in
January), another for Feb 15–Mar 15 (due in February), and so on. A period
that has started (its start is before check-out) is always owed in full,
regardless of how many nights of it are actually used.

Period key = "YYYY-MM" of the period start. Consecutive starts are exactly
one month apart, so keys never collide and stay compatible with the
Reservation.paid_months format.
"""

import calendar
from datetime import date


def add_months(anchor: date, n: int) -> date:
    """anchor + n months, day clamped to the target month length (Jan 31 -> Feb 28)."""
    year = anchor.year + (anchor.month - 1 + n) // 12
    month = (anchor.month - 1 + n) % 12 + 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def monthly_periods(check_in: date, check_out: date) -> list[tuple[date, date]]:
    """All billing periods of a monthly stay as (start, end) date pairs."""
    if not check_in or not check_out or check_out <= check_in:
        return []
    periods = []
    n = 0
    while True:
        start = add_months(check_in, n)
        if start >= check_out:
            break
        periods.append((start, add_months(check_in, n + 1)))
        n += 1
    return periods


def monthly_period_count(check_in: date, check_out: date) -> int:
    return len(monthly_periods(check_in, check_out))


def period_key(start: date) -> str:
    return f"{start.year:04d}-{start.month:02d}"
