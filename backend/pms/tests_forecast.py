"""What the end-of-month turnover forecast actually does.

`dashboard_forecast` had one test, and it asserted the *shape* of the payload.
The arithmetic underneath it had none. These tests pin the parts that are
right and demonstrate, with numbers, the three places the model misleads.

The helpers take plain dicts, so none of this needs the database.
"""

from datetime import date

from django.test import TestCase

from .views._predictions import _month_forecast, _overlap_nights, _usual_occupancy_for_month


def stay(check_in, check_out, price):
    ci = date.fromisoformat(check_in)
    co = date.fromisoformat(check_out)
    return {"ci": ci, "co": co, "nights": max((co - ci).days, 0), "price": float(price)}


class OverlapNightsTests(TestCase):
    """The proration primitive. This part is correct and worth keeping so."""

    def test_a_stay_inside_the_window_counts_every_night(self):
        n = _overlap_nights(date(2026, 1, 5), date(2026, 1, 10), date(2026, 1, 1), date(2026, 2, 1))
        self.assertEqual(n, 5)

    def test_a_stay_crossing_the_end_counts_only_the_nights_inside(self):
        n = _overlap_nights(date(2026, 1, 28), date(2026, 2, 4), date(2026, 1, 1), date(2026, 2, 1))
        self.assertEqual(n, 4)

    def test_a_stay_crossing_the_start_counts_only_the_nights_inside(self):
        n = _overlap_nights(date(2025, 12, 28), date(2026, 1, 4), date(2026, 1, 1), date(2026, 2, 1))
        self.assertEqual(n, 3)

    def test_a_stay_entirely_outside_counts_nothing(self):
        n = _overlap_nights(date(2026, 6, 1), date(2026, 6, 5), date(2026, 1, 1), date(2026, 2, 1))
        self.assertEqual(n, 0)

    def test_it_never_returns_a_negative(self):
        n = _overlap_nights(date(2025, 1, 1), date(2025, 1, 2), date(2026, 1, 1), date(2026, 2, 1))
        self.assertGreaterEqual(n, 0)


class OnBooksRevenueTests(TestCase):
    """Revenue already banked for the month is night-prorated. This is right."""

    def test_a_stay_crossing_into_the_month_contributes_only_its_nights(self):
        # 28 Dec to 4 Jan, 7 nights, 700 EUR. January should see 300, not 700.
        res = [stay("2025-12-28", "2026-01-04", 700)]
        out = _month_forecast(res, prop_count=1, today=date(2026, 1, 20), avg_nightly=0)
        self.assertAlmostEqual(out["onBooksTurnoverEur"], 300, delta=0.5)
        self.assertEqual(out["onBooksNights"], 3)

    def test_a_stay_crossing_out_of_the_month_contributes_only_its_nights(self):
        res = [stay("2026-01-28", "2026-02-04", 700)]
        out = _month_forecast(res, prop_count=1, today=date(2026, 1, 20), avg_nightly=0)
        self.assertAlmostEqual(out["onBooksTurnoverEur"], 400, delta=0.5)

    def test_a_stay_in_a_different_month_contributes_nothing(self):
        res = [stay("2026-06-01", "2026-06-10", 900)]
        out = _month_forecast(res, prop_count=1, today=date(2026, 1, 20), avg_nightly=0)
        self.assertEqual(out["onBooksTurnoverEur"], 0)


class UsualOccupancyUsesTodaysPortfolioTests(TestCase):
    """FLAW 1 - history is measured against the portfolio size of today.

    `cap = prop_count * ydays` uses the *current* number of apartments for
    every past year. An operator who has grown from one apartment to ten has
    their history divided by ten, so "usual occupancy" collapses towards zero
    and the forecast quietly degrades into on-books-only.
    """

    def setUp(self):
        # One apartment, fully booked every January of 2024 and 2025.
        self.res = [
            stay("2024-01-01", "2024-02-01", 3100),
            stay("2025-01-01", "2025-02-01", 3100),
        ]

    def test_with_an_unchanged_portfolio_history_reads_as_full(self):
        occ = _usual_occupancy_for_month(self.res, 1, 1, date(2026, 1, 15))
        self.assertAlmostEqual(occ, 1.0, places=6)

    def test_growing_to_ten_apartments_reads_the_same_history_as_ten_percent(self):
        occ = _usual_occupancy_for_month(self.res, 10, 1, date(2026, 1, 15))
        self.assertAlmostEqual(occ, 0.1, places=6)

    def test_so_the_forecast_all_but_gives_up_on_the_pickup(self):
        """Same history, same month, only the portfolio has grown."""
        small = _usual_occupancy_for_month(self.res, 1, 1, date(2026, 1, 15))
        grown = _usual_occupancy_for_month(self.res, 10, 1, date(2026, 1, 15))
        self.assertGreater(small, grown * 5)


class PickupIgnoresWhatIsAlreadyBookedTests(TestCase):
    """FLAW 2 - expected pickup is applied to the free nights unconditionally.

    `expected_pickup = free_remaining * usual_occ * avg_nightly` treats the
    remaining nights as if the month had not started. A month already booked to
    its historical norm is still forecast to pick up that norm *again* across
    whatever is left, so the projection lands above a level the property has
    never reached.
    """

    def test_a_month_already_at_its_usual_level_is_still_forecast_to_climb(self):
        # History: every January runs at 50% occupancy on one apartment.
        history = [stay("2025-01-01", "2025-01-17", 1600)]  # 16 of 31 nights
        today = date(2026, 1, 16)
        # This January is already booked at roughly that same 50% rate.
        current = [stay("2026-01-01", "2026-01-09", 800), stay("2026-01-16", "2026-01-24", 800)]

        res = history + current
        usual = _usual_occupancy_for_month(res, 1, 1, today)
        out = _month_forecast(res, prop_count=1, today=today, avg_nightly=100)

        projected_nights = out["onBooksNights"] + out["freeNightsRemaining"] * usual
        projected_occupancy = projected_nights / out["daysInMonth"]

        # The model projects a January materially busier than any January on record.
        self.assertGreater(projected_occupancy, usual)

    def test_the_gap_widens_the_better_booked_the_month_already_is(self):
        history = [stay("2025-01-01", "2025-01-17", 1600)]
        today = date(2026, 1, 16)
        lightly = history + [stay("2026-01-01", "2026-01-03", 200)]
        heavily = history + [
            stay("2026-01-01", "2026-01-14", 1300),
            stay("2026-01-16", "2026-01-29", 1300),
        ]

        light_out = _month_forecast(lightly, 1, today, 100)
        heavy_out = _month_forecast(heavily, 1, today, 100)

        usual_light = _usual_occupancy_for_month(lightly, 1, 1, today)
        usual_heavy = _usual_occupancy_for_month(heavily, 1, 1, today)

        light_final = (
            light_out["onBooksNights"] + light_out["freeNightsRemaining"] * usual_light
        ) / 31
        heavy_final = (
            heavy_out["onBooksNights"] + heavy_out["freeNightsRemaining"] * usual_heavy
        ) / 31
        self.assertGreater(heavy_final, light_final)


class ForecastOnTheFirstOfTheMonthTests(TestCase):
    """FLAW 3 - with no prior-year history the model has nothing to say.

    The fallback is month-to-date occupancy. On the 1st there is no month to
    date, so it reads zero and the projection is on-books only - the single day
    an operator most wants a forecast is the day it is weakest.
    """

    def test_a_first_of_month_forecast_with_no_history_expects_no_pickup(self):
        res = [stay("2026-01-10", "2026-01-20", 1000)]
        today = date(2026, 1, 1)
        occ = _usual_occupancy_for_month(res, 1, 1, today)
        self.assertEqual(occ, 0.0)

        out = _month_forecast(res, prop_count=1, today=today, avg_nightly=100)
        self.assertEqual(out["expectedPickupEur"], 0)
        self.assertEqual(out["projectedTurnoverEur"], out["onBooksTurnoverEur"])

    def test_the_same_data_a_fortnight_later_forecasts_a_pickup(self):
        res = [stay("2026-01-10", "2026-01-20", 1000)]
        out = _month_forecast(res, prop_count=1, today=date(2026, 1, 15), avg_nightly=100)
        self.assertGreater(out["expectedPickupEur"], 0)
