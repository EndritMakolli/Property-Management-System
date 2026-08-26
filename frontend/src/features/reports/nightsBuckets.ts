// "Reservations by nights" — the stay-length mix for one month.
//
// The bucket is the length of the whole stay: a 31-night tenancy is a long
// stay even in a month it only half occupies, so that is what makes it a
// long stay here too.
//
// The money is not. Revenue is the month's own nights, prorated by
// `revenueInsideMonth`, exactly like every other figure on the page. Summing
// whole reservations by arrival month used to put a tenancy's entire rent into
// the month it began, so the panel and the turnover table disagreed by
// thousands and neither told you which was the month's.

import type { ReservationRecord } from '../../types/domain'
import { nightsInsideMonth, revenueInsideMonth } from './reportCalculations'

// Exact night counts to break down, plus a final "8+ nights" bucket.
export const EXACT_NIGHTS = [1, 2, 3, 4, 5, 6, 7]
export const PLUS_BUCKET = 8

export type NightBucket = {
  value: number
  label: string
  count: number
  nights: number
  pct: number
  revenue: number
}

export function bucketFor(nights: number): number {
  return nights >= PLUS_BUCKET ? PLUS_BUCKET : nights
}

export function bucketLabel(value: number): string {
  if (value === PLUS_BUCKET) return `${PLUS_BUCKET}+ nights`
  return `${value} night${value !== 1 ? 's' : ''}`
}

function monthBounds(year: number, month: number) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const pad = String(month).padStart(2, '0')
  return {
    monthStart: `${year}-${pad}-01`,
    monthEnd: `${year}-${pad}-${String(daysInMonth).padStart(2, '0')}`,
  }
}

/** Stays that occupied at least one night of this month — arrivals included. */
export function staysInMonth(
  reservations: ReservationRecord[],
  year: number,
  month: number,
): ReservationRecord[] {
  const { monthStart, monthEnd } = monthBounds(year, month)
  return reservations.filter((r) => nightsInsideMonth(r, monthStart, monthEnd) > 0)
}

export function buildNightBuckets(
  reservations: ReservationRecord[],
  year: number,
  month: number,
): NightBucket[] {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const present = staysInMonth(reservations, year, month)
  const total = present.length || 1

  return [...EXACT_NIGHTS, PLUS_BUCKET].map((value) => {
    const matches = present.filter((r) => bucketFor(r.totalNights) === value)
    return {
      value,
      label: bucketLabel(value),
      count: matches.length,
      nights: matches.reduce((sum, r) => sum + nightsInsideMonth(r, monthStart, monthEnd), 0),
      pct: Math.round((matches.length / total) * 100),
      revenue: matches.reduce((sum, r) => sum + revenueInsideMonth(r, year, month), 0),
    }
  })
}
