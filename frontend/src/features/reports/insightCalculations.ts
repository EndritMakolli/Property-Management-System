import type { ReservationRecord } from '../../types/domain'
import { calculateNights } from '../../utils/date'
import { buildDueRows } from '../payments/paymentPeriods'
import { nightsInsideMonth, revenueInsideMonth, stayBuckets } from './reportCalculations'

// Platform identity colors — the same hues used across the app (calendar,
// chips). Validated CVD-safe with the dataviz palette checker.
export const PLATFORM_SERIES: { key: ReservationRecord['reservationType']; label: string; color: string }[] = [
  { key: 'private', label: 'Private', color: '#111111' },
  { key: 'airbnb', label: 'Airbnb', color: '#FF5A5F' },
  { key: 'booking', label: 'Booking.com', color: '#003580' },
  { key: 'monthly', label: 'Monthly', color: '#eab308' },
  { key: 'direct', label: 'Direct', color: '#6B7280' },
]

export const STATUS_COLORS = {
  paid: '#2f8f74',
  unpaid: '#d97706',
}

function isRealStay(reservation: ReservationRecord) {
  return reservation.reservationType !== 'maintenance' && !reservation.isArchived
}

// Revenue split by platform for a month (or the whole year when month = 0).
export function platformRevenue(reservations: ReservationRecord[], year: number, month: number) {
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
  return PLATFORM_SERIES.filter((series) => (totals.get(series.key) ?? 0) > 0).map((series) => ({
    ...series,
    value: Math.round(totals.get(series.key) ?? 0),
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

export function stayLengthDistribution(reservations: ReservationRecord[]) {
  return stayBuckets.map((bucket) => ({
    label: bucket.label,
    count: reservations.filter(
      (r) => isRealStay(r) && r.totalNights >= bucket.min && r.totalNights <= bucket.max,
    ).length,
  }))
}

const LEAD_BUCKETS = [
  { label: 'Same day', min: 0, max: 0 },
  { label: '1-3 days', min: 1, max: 3 },
  { label: '4-7 days', min: 4, max: 7 },
  { label: '8-30 days', min: 8, max: 30 },
  { label: '31+ days', min: 31, max: Infinity },
]

// How far in advance bookings are made (creation date → check-in).
export function leadTimeDistribution(reservations: ReservationRecord[]) {
  const withCreated = reservations.filter((r) => isRealStay(r) && r.createdAt)
  const counts = LEAD_BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }))
  for (const reservation of withCreated) {
    const created = reservation.createdAt!.slice(0, 10)
    const lead = Math.max(calculateNights(created, reservation.checkIn), 0)
    const index = LEAD_BUCKETS.findIndex((bucket) => lead >= bucket.min && lead <= bucket.max)
    if (index >= 0) counts[index].count += 1
  }
  return { buckets: counts, skipped: reservations.filter(isRealStay).length - withCreated.length }
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
