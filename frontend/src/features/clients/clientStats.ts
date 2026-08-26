// A client's numbers, for the staff-side detail page.
//
// Deliberately thin. `partitionStays` and `statTiles` already exist for the
// guest portal and are the definition of "has this stay happened" and "how do
// these numbers read" — a second copy would let the portal and the PMS drift
// into disagreeing about the same person. This adapts a ReservationRecord to
// feed them, and computes nothing the backend does not compute the same way
// (see `guest_stays` in views/_guests.py).

import type { GuestStats, ReservationRecord } from '../../types/domain'
import { partitionStays } from '../guest/accountView'

/** Upcoming vs past, using the guest portal's rule verbatim. */
export function splitStays(stays: ReservationRecord[], today: string) {
  return partitionStays(stays, today)
}

/**
 * Lifetime totals, in the shape `statTiles` renders.
 *
 * Lifetime, not finished-only: this has to match the number on the directory
 * row beside it, and that counts every stay. The finished/upcoming split is a
 * separate question, answered by `splitStays`.
 */
export function stayStatsFrom(stays: ReservationRecord[], today: string): GuestStats {
  let nights = 0
  let spent = 0
  let lastVisit = ''

  for (const stay of stays) {
    nights += stay.totalNights || 0
    const paid = Number(stay.totalPaid)
    if (Number.isFinite(paid)) spent += paid
    // A booking in the future is something to look forward to, not a visit.
    if (stay.checkOut <= today && stay.checkOut > lastVisit) lastVisit = stay.checkOut
  }

  return {
    stays: stays.length,
    nights,
    totalSpentEur: spent.toFixed(2),
    lastVisit,
  }
}
