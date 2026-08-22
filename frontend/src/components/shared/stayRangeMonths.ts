// Which month the stay picker should open on.
//
// Split out because it is the part that was wrong: the calendar was built for a
// guest booking a stay soon, so it always opened on the current month. Inside
// the PMS that is the wrong answer — staff open it on a December reservation,
// or record one that happened last March, and want to land there.

export type MonthRef = { year: number; month: number }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** The month an ISO date falls in, or null if it is not one. */
export function monthOf(iso: string): MonthRef | null {
  const match = ISO_DATE.exec((iso ?? '').trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  if (month < 0 || month > 11) return null
  // Deliberately not `new Date(iso)`: that parses as UTC, so the first of a
  // month read back locally can land in the previous one.
  return { year, month }
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const total = ref.year * 12 + ref.month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

export function compareMonths(a: MonthRef, b: MonthRef): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month)
}

/** Open on the stay being edited; fall back to today when there is none. */
export function openingMonth(checkIn: string, today: string): MonthRef {
  return monthOf(checkIn) ?? monthOf(today) ?? { year: new Date().getFullYear(), month: new Date().getMonth() }
}
