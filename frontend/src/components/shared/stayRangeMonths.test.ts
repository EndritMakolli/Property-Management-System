import { describe, expect, it } from 'vitest'
import { compareMonths, monthOf, openingMonth, shiftMonth } from './stayRangeMonths'

const TODAY = '2026-08-22'

// The calendar used to be built for one job — a guest booking a stay soon — so
// it always opened on the current month. Inside the PMS that is wrong: staff
// open it on a reservation in December, or enter one that happened last March,
// and see August every time.
describe('openingMonth', () => {
  it('opens on the month of the stay being edited', () => {
    expect(openingMonth('2026-12-04', TODAY)).toEqual({ year: 2026, month: 11 })
  })

  it('opens on this month when no dates are set yet', () => {
    expect(openingMonth('', TODAY)).toEqual({ year: 2026, month: 7 })
  })

  it('opens on a past month for a stay that already happened', () => {
    expect(openingMonth('2026-03-15', TODAY)).toEqual({ year: 2026, month: 2 })
  })

  it('opens on a month in another year', () => {
    expect(openingMonth('2027-01-02', TODAY)).toEqual({ year: 2027, month: 0 })
  })

  it('ignores a check-in that is not a real date', () => {
    expect(openingMonth('not-a-date', TODAY)).toEqual({ year: 2026, month: 7 })
  })
})

describe('shiftMonth', () => {
  it('steps forward', () => {
    expect(shiftMonth({ year: 2026, month: 7 }, 1)).toEqual({ year: 2026, month: 8 })
  })

  it('steps backward', () => {
    expect(shiftMonth({ year: 2026, month: 7 }, -1)).toEqual({ year: 2026, month: 6 })
  })

  it('rolls over the end of the year', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
  })

  it('rolls back over the start of the year', () => {
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })

  it('steps more than a year', () => {
    expect(shiftMonth({ year: 2026, month: 5 }, 14)).toEqual({ year: 2027, month: 7 })
  })
})

describe('compareMonths', () => {
  it('is negative when the first month is earlier', () => {
    expect(compareMonths({ year: 2026, month: 6 }, { year: 2026, month: 7 })).toBeLessThan(0)
  })

  it('compares across years', () => {
    expect(compareMonths({ year: 2025, month: 11 }, { year: 2026, month: 0 })).toBeLessThan(0)
  })

  it('is zero for the same month', () => {
    expect(compareMonths({ year: 2026, month: 3 }, { year: 2026, month: 3 })).toBe(0)
  })
})

describe('monthOf', () => {
  it('reads an ISO date', () => {
    expect(monthOf('2026-08-22')).toEqual({ year: 2026, month: 7 })
  })

  it('does not drift a day-one date into the previous month', () => {
    // Parsing '2026-03-01' as UTC and reading it locally is how a picker ends
    // up showing February.
    expect(monthOf('2026-03-01')).toEqual({ year: 2026, month: 2 })
  })

  it('returns null for junk', () => {
    expect(monthOf('')).toBeNull()
  })
})
