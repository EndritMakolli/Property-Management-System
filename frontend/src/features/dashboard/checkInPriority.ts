import type { ReservationRecord } from '../../types/domain'

// Who is arriving today, in the order the front desk works through them.
//
// The grouping is the operator's, not an invented one: channel arrivals are
// handled first because those guests are strangers arriving to a fixed
// expectation, and returning private guests come last because they need the
// least explaining — they know the building. Splitting them out also makes the
// "returning guest" badge impossible to miss.
//
// Anything the operator has invented since (a "Corporate" type, say) sorts
// after the named groups, in their own configured order, rather than being
// dropped or jumbled in.
export type CheckInTier = 1 | 2 | 3 | 4 | 5

export type CheckInRow = {
  reservation: ReservationRecord
  tier: CheckInTier
  tierLabel: string
  isReturning: boolean
  displayName: string
}

const TIER_LABELS: Record<CheckInTier, string> = {
  1: 'Airbnb',
  2: 'Booking.com',
  3: 'Private',
  4: 'Returning guest',
  5: '',
}

function tierFor(reservation: ReservationRecord): CheckInTier {
  if (reservation.reservationType === 'airbnb') return 1
  if (reservation.reservationType === 'booking') return 2
  if (reservation.reservationType === 'private') {
    // Only private guests carry the returning distinction — a channel guest
    // arrives through Airbnb or Booking regardless of having been before.
    return reservation.guestIsReturning ? 4 : 3
  }
  return 5
}

export function buildCheckIns(
  reservations: ReservationRecord[],
  reportDate: string,
  typeOrder: string[],
): CheckInRow[] {
  const orderIndex = new Map(typeOrder.map((code, index) => [code, index]))

  const rows = reservations
    .filter(
      (reservation) =>
        reservation.checkIn === reportDate &&
        reservation.reservationType !== 'maintenance' &&
        !reservation.isArchived,
    )
    .map((reservation) => {
      const tier = tierFor(reservation)
      return {
        reservation,
        tier,
        tierLabel: tier === 5 ? reservation.reservationType : TIER_LABELS[tier],
        isReturning: tier === 4,
        displayName: reservation.guestName || reservation.guestPhone || 'Guest',
      }
    })

  return rows.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.tier === 5) {
      const left = orderIndex.get(a.reservation.reservationType) ?? Number.MAX_SAFE_INTEGER
      const right = orderIndex.get(b.reservation.reservationType) ?? Number.MAX_SAFE_INTEGER
      if (left !== right) return left - right
    }
    return a.displayName.localeCompare(b.displayName, undefined, { numeric: true })
  })
}
