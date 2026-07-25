import type { ReservationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { revenueInsideMonth } from '../reports/reportCalculations'

// Anniversary billing periods for "monthly" reservations, shared by the
// dashboard Payments-due panel and the Payments page. A stay starting Jan 15
// owes the full monthly price for Jan 15–Feb 15 (due in January), again for
// Feb 15–Mar 15 (due in February), and so on. A started period is always owed
// in full. Period key = "YYYY-MM" of the period start — starts are exactly one
// month apart, so keys never collide and stay compatible with paidMonths.

export type StayPeriod = {
  key: string
  start: string
  endExcl: string
}

// One row per outstanding payment: a whole reservation, or — for "monthly"
// stays — one instalment per billing period.
export type DueRow = {
  key: string
  reservation: ReservationRecord
  monthKey: string | null // period key for a monthly instalment, null for full
  periodStart: string | null
  periodEnd: string | null
  label: string
  dueLabel: string
  sortKey: string
  amount: number
  paid: boolean
}

// iso + n months, day clamped to the target month length (Jan 31 -> Feb 28).
// Always call with the original anchor so the day never drifts.
export function addMonthsClamped(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const monthIndex = m - 1 + n
  const year = y + Math.floor(monthIndex / 12)
  const month = (((monthIndex % 12) + 12) % 12) + 1
  const day = Math.min(d, new Date(year, month, 0).getDate())
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function stayPeriods(reservation: Pick<ReservationRecord, 'checkIn' | 'checkOut'>): StayPeriod[] {
  const { checkIn, checkOut } = reservation
  if (!checkIn || !checkOut || checkOut <= checkIn) return []
  const periods: StayPeriod[] = []
  for (let n = 0; ; n++) {
    const start = addMonthsClamped(checkIn, n)
    if (start >= checkOut) break
    periods.push({ key: start.slice(0, 7), start, endExcl: addMonthsClamped(checkIn, n + 1) })
  }
  return periods
}

export function monthlyPrice(reservation: ReservationRecord): number | null {
  const price = Number(reservation.monthlyPrice)
  return Number.isFinite(price) && price > 0 ? price : null
}

export function periodLabel(period: StayPeriod): string {
  return `${formatDisplayDate(period.start)} → ${formatDisplayDate(period.endExcl)}`
}

export function buildDueRows(reservations: ReservationRecord[], today: string): DueRow[] {
  const rows: DueRow[] = []

  for (const r of reservations) {
    if (r.reservationType === 'maintenance' || r.isArchived) continue
    // Only stays that have already checked in owe anything yet.
    if (r.checkIn > today) continue
    const guest = r.guestName || r.guestPhone || 'Guest'

    if (r.reservationType === 'monthly') {
      const paidMonths = new Set(r.paidMonths ?? [])
      const flat = monthlyPrice(r)
      for (const period of stayPeriods(r)) {
        // Future periods are not due yet — they appear once the period starts.
        if (period.start > today) continue
        const [year, month] = period.key.split('-').map(Number)
        // Legacy monthly rows without a flat price fall back to proration.
        const amount = flat ?? revenueInsideMonth(r, year, month)
        if (amount <= 0) continue
        rows.push({
          key: `${r.id}-${period.key}`,
          reservation: r,
          monthKey: period.key,
          periodStart: period.start,
          periodEnd: period.endExcl,
          label: `${guest} · ${r.apartment}`,
          dueLabel: periodLabel(period),
          sortKey: period.start,
          amount,
          paid: paidMonths.has(period.key),
        })
      }
    } else {
      const amount = Number(r.totalPaid)
      if (!Number.isFinite(amount) || amount <= 0) continue
      rows.push({
        key: r.id,
        reservation: r,
        monthKey: null,
        periodStart: null,
        periodEnd: null,
        label: `${guest} · ${r.apartment}`,
        dueLabel: r.paymentDue
          ? `due ${formatDisplayDate(r.paymentDue)}`
          : `check-in ${formatDisplayDate(r.checkIn)}`,
        sortKey: r.paymentDue || r.checkIn,
        amount,
        paid: r.paid,
      })
    }
  }

  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
}

// The PATCH body for toggling a row's paid state. Monthly instalments update
// paidMonths and flip the overall flag only when every period is settled.
export function togglePayload(row: DueRow): { paid: boolean; paidMonths?: string[] } {
  if (!row.monthKey) {
    return { paid: !row.paid }
  }
  const current = new Set(row.reservation.paidMonths ?? [])
  if (row.paid) current.delete(row.monthKey)
  else current.add(row.monthKey)
  const paidMonths = [...current].sort()
  const allPaid = stayPeriods(row.reservation).every((period) => current.has(period.key))
  return { paidMonths, paid: allPaid }
}
