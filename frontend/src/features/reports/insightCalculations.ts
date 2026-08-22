import type { ReservationRecord } from '../../types/domain'
import { buildDueRows } from '../payments/paymentPeriods'
import { nightsInsideMonth, revenueInsideMonth } from './reportCalculations'

/** The shape the charts need from a reservation type. */
export type SeriesType = { code: string; label: string; color: string }

export const STATUS_COLORS = {
  paid: '#2f8f74',
  unpaid: '#d97706',
}

function isRealStay(reservation: ReservationRecord) {
  return reservation.reservationType !== 'maintenance' && !reservation.isArchived
}

// Revenue split by reservation type for a month (or the whole year when
// month = 0). The types are passed in rather than hardcoded here: an admin can
// rename one or add a new one, and a frozen list would show the old name and
// silently drop the new type from the chart.
export function platformRevenue(
  reservations: ReservationRecord[],
  year: number,
  month: number,
  types: SeriesType[],
) {
  const totals = new Map<string, number>()
  for (const reservation of reservations.filter(isRealStay)) {
    let value = 0
    if (month === 0) {
      for (let m = 1; m <= 12; m++) value += revenueInsideMonth(reservation, year, m)
    } else {
      value = revenueInsideMonth(reservation, year, month)
    }
    if (value > 0) {
      totals.set(reservation.reservationType, (totals.get(reservation.reservationType) ?? 0) + value)
    }
  }
  return types
    .filter((type) => (totals.get(type.code) ?? 0) > 0)
    .map((type) => ({
      key: type.code,
      label: type.label,
      color: type.color,
      value: Math.round(totals.get(type.code) ?? 0),
    }))
}

// Monthly occupancy % for a year: booked nights ÷ (properties × days in month).
export function occupancyByMonth(
  propertyCount: number,
  reservations: ReservationRecord[],
  year: number,
) {
  const rows: number[] = []
  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(year, month, 0).getDate()
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
    const booked = reservations
      .filter(isRealStay)
      .reduce((sum, r) => sum + nightsInsideMonth(r, monthStart, monthEnd), 0)
    const capacity = propertyCount * daysInMonth
    rows.push(capacity > 0 ? Math.round((booked / capacity) * 1000) / 10 : 0)
  }
  return rows
}

// Average daily (nightly) rate per month: month revenue ÷ booked nights.
export function adrByMonth(reservations: ReservationRecord[], year: number) {
  const rows: number[] = []
  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(year, month, 0).getDate()
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
    let revenue = 0
    let nights = 0
    for (const reservation of reservations.filter(isRealStay)) {
      revenue += revenueInsideMonth(reservation, year, month)
      nights += nightsInsideMonth(reservation, monthStart, monthEnd)
    }
    rows.push(nights > 0 ? Math.round((revenue / nights) * 10) / 10 : 0)
  }
  return rows
}


export type PaymentSplit = {
  paidCount: number
  unpaidCount: number
  paidAmount: number
  unpaidAmount: number
}

// Payments due in a given month: how many are settled vs outstanding.
export function monthPaymentSplit(
  reservations: ReservationRecord[],
  today: string,
  year: number,
  month: number,
): PaymentSplit {
  const key = `${year}-${String(month).padStart(2, '0')}`
  const rows = buildDueRows(reservations, today).filter((row) => row.sortKey.slice(0, 7) === key)
  return {
    paidCount: rows.filter((row) => row.paid).length,
    unpaidCount: rows.filter((row) => !row.paid).length,
    paidAmount: rows.filter((row) => row.paid).reduce((sum, row) => sum + row.amount, 0),
    unpaidAmount: rows.filter((row) => !row.paid).reduce((sum, row) => sum + row.amount, 0),
  }
}

// Guests currently in-house: settled vs owing (a monthly stay counts as owing
// while any started rent period is unpaid).
export function checkedInPaymentSplit(reservations: ReservationRecord[], today: string): PaymentSplit {
  const unpaidIds = new Set(
    buildDueRows(reservations, today)
      .filter((row) => !row.paid)
      .map((row) => row.reservation.id),
  )
  const amounts = new Map<string, number>()
  for (const row of buildDueRows(reservations, today)) {
    if (!row.paid) amounts.set(row.reservation.id, (amounts.get(row.reservation.id) ?? 0) + row.amount)
  }

  const checkedIn = reservations.filter(
    (r) => isRealStay(r) && r.checkIn <= today && r.checkOut > today,
  )
  const paid = checkedIn.filter((r) => !unpaidIds.has(r.id))
  const unpaid = checkedIn.filter((r) => unpaidIds.has(r.id))
  return {
    paidCount: paid.length,
    unpaidCount: unpaid.length,
    paidAmount: paid.reduce((sum, r) => sum + (Number(r.totalPaid) || 0), 0),
    unpaidAmount: unpaid.reduce((sum, r) => sum + (amounts.get(r.id) ?? 0), 0),
  }
}

export type GuestMix = {
  /** Arrivals this period by someone with no earlier stay. */
  newCount: number
  /** Arrivals by someone who had stayed before. */
  returningCount: number
  /** Arrivals whose reservation is not linked to a client record. */
  unlinked: number
}

/**
 * New versus returning guests arriving in a period.
 *
 * Deliberately NOT read from `Guest.is_returning`. That flag is a sticky
 * lifetime marker — it is true even on the very first stay of someone who later
 * came back — so it would count that first visit as a return. What matters here
 * is the ordinal of the stay: did this guest arrive before this one?
 *
 * Earlier stays are looked for across every reservation given, not just the
 * period on screen, so a guest whose first visit was last year still counts as
 * returning today.
 *
 * Rows the guest linker has not matched carry no `guestId` and cannot be
 * grouped at all. They are counted separately rather than lumped in with "new",
 * which would quietly inflate the number an operator is reading.
 */
export function newVsReturning(
  reservations: ReservationRecord[],
  year: number,
  month: number,
): GuestMix {
  const real = reservations.filter(isRealStay)

  const earliestByGuest = new Map<string, string>()
  for (const reservation of real) {
    if (!reservation.guestId) continue
    const seen = earliestByGuest.get(reservation.guestId)
    if (seen === undefined || reservation.checkIn < seen) {
      earliestByGuest.set(reservation.guestId, reservation.checkIn)
    }
  }

  const prefix = month === 0 ? `${year}-` : `${year}-${String(month).padStart(2, '0')}-`

  let newCount = 0
  let returningCount = 0
  let unlinked = 0

  for (const reservation of real) {
    // By arrival: a stay that runs into the month belongs to the month it began.
    if (!reservation.checkIn.startsWith(prefix)) continue
    if (!reservation.guestId) {
      unlinked += 1
      continue
    }
    if (earliestByGuest.get(reservation.guestId) === reservation.checkIn) {
      newCount += 1
    } else {
      returningCount += 1
    }
  }

  return { newCount, returningCount, unlinked }
}

/* ── Top apartments over a rolling window ────────────────────────────────── */

export type MonthRef = { year: number; month: number }

/**
 * The `count` months ending with the one `today` falls in, oldest first.
 *
 * A rolling window rather than "this year so far": in August, a year-to-date
 * ranking is eight months of history, and in January it is three weeks. Four
 * months is the same amount of evidence whenever it is read.
 */
export function lastMonths(today: string, count: number): MonthRef[] {
  const [year, month] = today.split('-').map(Number)
  const months: MonthRef[] = []
  for (let back = count - 1; back >= 0; back -= 1) {
    // Work in absolute month numbers so the year boundary needs no special case.
    const total = year * 12 + (month - 1) - back
    months.push({ year: Math.floor(total / 12), month: (total % 12) + 1 })
  }
  return months
}

export type ApartmentRevenue = { id: string; name: string; revenue: number }

/**
 * What each apartment earned across the window, biggest first.
 *
 * Revenue is night-prorated by `revenueInsideMonth`, so a stay straddling the
 * edge of the window contributes only the nights inside it.
 */
export function topApartmentsByRevenue(
  properties: { id: string; name: string }[],
  reservations: ReservationRecord[],
  months: MonthRef[],
  limit = 10,
): ApartmentRevenue[] {
  const totals = new Map<string, number>()

  for (const reservation of reservations.filter(isRealStay)) {
    let earned = 0
    for (const { year, month } of months) {
      earned += revenueInsideMonth(reservation, year, month)
    }
    if (earned > 0) {
      totals.set(reservation.propertyId, (totals.get(reservation.propertyId) ?? 0) + earned)
    }
  }

  return properties
    .map((property) => ({
      id: property.id,
      name: property.name,
      revenue: Math.round(totals.get(property.id) ?? 0),
    }))
    .filter((row) => row.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
}
