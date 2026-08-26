import { describe, expect, it } from 'vitest'
import type { ReservationRecord } from '../../types/domain'
import { addMonthsClamped, buildDueRows, stayPeriods } from './paymentPeriods'

// Collecting rent and reporting revenue are different questions and must be
// allowed to give different answers.
//
//   Payments  - what does this tenant OWE, and when?  Per anniversary period.
//               A period that has started is owed in full. Nobody bills
//               "159.68 for the tail of August".
//   Reports   - what did this month EARN?  Per night.
//
// These tests exist to keep the first answer nailed down while the second one
// moved to night-proration. If a change to revenue reporting ever drags the
// billing amount with it, these fail.

function tenancy(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    id: 'r1',
    guestName: 'Tenant',
    guestPhone: '',
    paymentDue: '',
    paid: false,
    paidMonths: [],
    notes: '',
    reservationType: 'monthly',
    propertyId: 'prop-1',
    apartment: 'Apartment #6',
    apartmentType: '1 bedroom',
    checkIn: '2026-08-23',
    checkOut: '2026-09-23',
    totalNights: 31,
    nightlyPrice: '17.74',
    monthlyPrice: '550.00',
    totalPaid: '550.00',
    isArchived: false,
    archivedAt: '',
    ...overrides,
  }
}

describe('what a monthly tenant owes', () => {
  it('bills the whole instalment, never a part month', () => {
    const rows = buildDueRows([tenancy()], '2026-08-26')
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(550)
  })

  it('bills it in the month the period started', () => {
    const rows = buildDueRows([tenancy()], '2026-08-26')
    expect(rows[0].monthKey).toBe('2026-08')
  })

  it('bills a started period in full even on its first day', () => {
    const rows = buildDueRows([tenancy()], '2026-08-23')
    expect(rows[0].amount).toBe(550)
  })

  it('does not bill a period that has not started yet', () => {
    const long = tenancy({ checkOut: '2026-11-23' })
    const rows = buildDueRows([long], '2026-09-30')
    expect(rows.map((row) => row.monthKey)).toEqual(['2026-08', '2026-09'])
  })

  it('bills each period once the whole tenancy has run', () => {
    const long = tenancy({ checkOut: '2026-11-23' })
    const rows = buildDueRows([long], '2026-12-01')
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.amount === 550)).toBe(true)
  })

  it('marks a settled period as paid', () => {
    const rows = buildDueRows([tenancy({ paidMonths: ['2026-08'] })], '2026-08-26')
    expect(rows[0].paid).toBe(true)
  })

  it('charges a nightly stay its whole total, not a monthly instalment', () => {
    const short = tenancy({
      reservationType: 'airbnb',
      checkIn: '2026-08-03',
      checkOut: '2026-08-12',
      totalNights: 9,
      monthlyPrice: undefined,
      totalPaid: '267.03',
    })
    const rows = buildDueRows([short], '2026-08-26')
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBeCloseTo(267.03, 2)
    expect(rows[0].monthKey).toBeNull()
  })

  it('leaves a maintenance block out of the money owed', () => {
    const block = tenancy({ reservationType: 'maintenance', totalPaid: '0.00' })
    expect(buildDueRows([block], '2026-08-26')).toHaveLength(0)
  })
})

describe('the billing periods themselves', () => {
  it('runs from anniversary to anniversary', () => {
    expect(stayPeriods(tenancy())).toEqual([
      { key: '2026-08', start: '2026-08-23', endExcl: '2026-09-23' },
    ])
  })

  it('gives a two-month tenancy two periods', () => {
    expect(stayPeriods(tenancy({ checkOut: '2026-10-23' })).map((p) => p.key)).toEqual([
      '2026-08',
      '2026-09',
    ])
  })

  it('clamps a 31st anniversary into a short month', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('does not let the clamp drift when called from the original anchor', () => {
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31')
  })
})
