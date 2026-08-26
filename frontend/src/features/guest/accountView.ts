import type { GuestBooking, GuestStats } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'

// Pure shaping for the guest account page. No fetching, no Date.now() — `today`
// is a parameter, so the boundary cases are testable rather than a matter of
// when the suite happens to run.

/** Statuses that are over regardless of what the calendar says. */
const FINISHED: GuestBooking['status'][] = ['declined', 'expired', 'cancelled']

/** The least a row needs for "has this happened yet" to be answerable.
 *
 *  Kept structural so the staff-side client page can split a `ReservationRecord`
 *  with this same function. A reservation carries no `status` — it exists, so it
 *  was never declined — and the date test alone is the right answer for it.
 */
type StayLike = { checkIn: string; checkOut: string; status?: GuestBooking['status'] }

export function partitionStays<T extends StayLike>(bookings: T[], today: string) {
  const upcoming: T[] = []
  const past: T[] = []

  for (const booking of bookings) {
    // A declined or cancelled booking is history whatever its dates say, and a
    // stay in progress is still ahead of you until the day you leave.
    const isPast =
      (booking.status !== undefined && FINISHED.includes(booking.status)) ||
      booking.checkOut <= today
    ;(isPast ? past : upcoming).push(booking)
  }

  // Sorted copies: the caller's array is left alone.
  upcoming.sort((a, b) => a.checkIn.localeCompare(b.checkIn))
  past.sort((a, b) => b.checkOut.localeCompare(a.checkOut))
  return { upcoming, past }
}

function money(value: string) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '€0'
  return `€${amount.toLocaleString('en', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

export function statTiles(stats: GuestStats) {
  return [
    { label: 'Stays', value: `${stats.stays} ${stats.stays === 1 ? 'stay' : 'stays'}` },
    { label: 'Nights', value: `${stats.nights} ${stats.nights === 1 ? 'night' : 'nights'}` },
    { label: 'Total spent', value: money(stats.totalSpentEur) },
    {
      label: 'Last visit',
      // "No visits yet" rather than a blank or an Invalid Date: a new guest
      // should read something that makes sense, not an empty box.
      value: stats.lastVisit ? formatDisplayDate(stats.lastVisit) : 'No visits yet',
    },
  ]
}
