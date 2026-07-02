"""
Dashboard forecast endpoint.

Two heuristic, explainable forecasts surfaced on the operations dashboard:

  • workload      — check-ins / check-outs per day for the next two weeks.
  • monthForecast — projected end-of-month turnover, built from the free
                    apartment-nights left in the month, the usual occupancy for
                    this calendar month, and the average nightly price.

Everything is driven by stay dates, prices and property data — the signals we
actually have. (Booking `created_at` is import-stamped in this dataset, so
lead-time / pickup-curve models are intentionally avoided.)
"""

import calendar
from datetime import date, timedelta

from django.utils.timezone import localdate
from django.http import JsonResponse

from ..models import Property, Reservation
from ._roles import ROLE_ADMIN, ROLE_MANAGEMENT, require_roles

DAILY_FORECAST_DAYS = 14  # workload window (check-ins / check-outs per day)


def _overlap_nights(check_in, check_out, start, end_exclusive):
    """Nights of a [check_in, check_out) stay that fall inside [start, end_exclusive)."""
    a = max(check_in, start)
    b = min(check_out, end_exclusive)
    return (b - a).days if b > a else 0


def _month_bounds(year, month):
    days = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, days), days


def dashboard_forecast(request):
    denied = require_roles(request, [ROLE_ADMIN, ROLE_MANAGEMENT])
    if denied:
        return denied
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    platform = request.GET.get("platform") or Property.Platform.AIRSTAY
    today = localdate()

    props = list(Property.objects.filter(active=True, platform=platform))
    prop_count = len(props) or 1

    reservations = list(
        Reservation.objects.filter(is_archived=False, property__platform=platform)
        .exclude(platform=Reservation.Platform.MAINTENANCE)
        .select_related("property")
    )
    res = [
        {
            "ci": r.check_in,
            "co": r.check_out,
            "nights": max((r.check_out - r.check_in).days, 0),
            "price": float(r.total_price_eur or 0),
        }
        for r in reservations
    ]

    total_nights_all = sum(x["nights"] for x in res) or 1
    total_revenue_all = sum(x["price"] for x in res)
    avg_nightly = total_revenue_all / total_nights_all if total_nights_all else 0.0

    return JsonResponse(
        {
            "generatedAt": today.isoformat(),
            "platform": platform,
            "propertyCount": prop_count,
            "workload": _workload(res, today),
            "monthForecast": _month_forecast(res, prop_count, today, avg_nightly),
        }
    )


# ── Workload (check-ins / check-outs, next 14 days) ──────────────────────────

def _workload(res, today):
    days = []
    for offset in range(DAILY_FORECAST_DAYS):
        d = today + timedelta(days=offset)
        days.append(
            {
                "date": d.isoformat(),
                "weekday": calendar.day_abbr[d.weekday()],
                "checkIns": sum(1 for x in res if x["ci"] == d),
                "checkOuts": sum(1 for x in res if x["co"] == d),
            }
        )
    return {"days": days}


# ── End-of-month turnover forecast ───────────────────────────────────────────

def _usual_occupancy_for_month(res, prop_count, month, today):
    """Average occupancy for this calendar month across *completed* prior years.

    Falls back to month-to-date occupancy when there is no prior-year history."""
    earliest = min((x["ci"] for x in res), default=today)

    total_occ = 0.0
    years = 0
    y = earliest.year
    while y < today.year:
        start = date(y, month, 1)
        ydays = calendar.monthrange(y, month)[1]
        end_excl = start + timedelta(days=ydays)
        nights = sum(_overlap_nights(x["ci"], x["co"], start, end_excl) for x in res)
        if nights > 0:
            cap = prop_count * ydays
            total_occ += (nights / cap) if cap else 0
            years += 1
        y += 1

    if years:
        return min(1.0, total_occ / years)

    # No comparable history — use this month so far as the best available signal.
    m_start = date(today.year, month, 1)
    days_elapsed = max((today - m_start).days, 1)
    mtd_nights = sum(_overlap_nights(x["ci"], x["co"], m_start, today) for x in res)
    cap = prop_count * days_elapsed
    return min(1.0, (mtd_nights / cap) if cap else 0.0)


def _month_forecast(res, prop_count, today, avg_nightly):
    _, _, days_in_month = _month_bounds(today.year, today.month)
    m_start = date(today.year, today.month, 1)
    m_end_excl = m_start + timedelta(days=days_in_month)

    # Turnover already on the books for the whole month (revenue attributed to
    # the nights that fall inside the month).
    on_books_nights = 0
    on_books_rev = 0.0
    for x in res:
        n = _overlap_nights(x["ci"], x["co"], m_start, m_end_excl)
        if n:
            on_books_nights += n
            if x["nights"]:
                on_books_rev += x["price"] * (n / x["nights"])

    # Free apartment-nights left from today to the end of the month.
    remaining_start = max(today, m_start)
    days_remaining = max((m_end_excl - remaining_start).days, 0)
    remaining_capacity = prop_count * days_remaining
    booked_remaining = sum(
        _overlap_nights(x["ci"], x["co"], remaining_start, m_end_excl) for x in res
    )
    free_remaining = max(0, remaining_capacity - booked_remaining)

    usual_occ = _usual_occupancy_for_month(res, prop_count, today.month, today)
    expected_pickup = free_remaining * usual_occ * avg_nightly
    projected = on_books_rev + expected_pickup

    return {
        "monthLabel": f"{calendar.month_name[today.month]} {today.year}",
        "daysInMonth": days_in_month,
        "daysRemaining": days_remaining,
        "onBooksNights": round(on_books_nights),
        "onBooksTurnoverEur": round(on_books_rev),
        "freeNightsRemaining": round(free_remaining),
        "usualOccupancyPct": round(usual_occ * 100, 1),
        "avgNightlyEur": round(avg_nightly, 2),
        "expectedPickupEur": round(expected_pickup),
        "projectedTurnoverEur": round(projected),
    }
