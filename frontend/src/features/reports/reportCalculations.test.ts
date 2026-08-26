import { describe, expect, it } from 'vitest'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import {
  buildPropertyReportStats,
  buildPropertyYearStats,
  nightsInsideMonth,
  revenueInsideMonth,
} from './reportCalculations'

// The rule this file exists to defend: money belongs to the month the *nights*
// fall in. A stay running from one month into the next is split between them,
// never counted whole in either.

function stay(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  const checkIn = overrides.checkIn ?? '2026-01-10'
  const checkOut = overrides.checkOut ?? '2026-01-15'
  const nights =
    overrides.totalNights ??
    Math.round(
      (new Date(`${checkOut}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime()) /
        86400000,
    )
  return {
    id: Math.random().toString(36).slice(2),
    guestName: 'Guest',
    guestPhone: '',
    paymentDue: '',
    paid: true,
    notes: '',
    reservationType: 'airbnb',
    propertyId: 'prop-1',
    apartment: 'A1',
    apartmentType: '1 bedroom',
    checkIn,
    checkOut,
    totalNights: nights,
    nightlyPrice: '100.00',
    totalPaid: '500.00',
    isArchived: false,
    archivedAt: '',
    ...overrides,
  }
}

function property(overrides: Partial<PropertyListing> = {}): PropertyListing {
  return { id: 'prop-1', name: 'A1', bedrooms: 1, basePriceEur: '0', ...overrides } as PropertyListing
}

describe('revenueInsideMonth - a stay that crosses a month boundary', () => {
  // 28 Dec to 4 Jan is 7 nights at 100 EUR: four in December, three in January.
  const crossing = stay({
    checkIn: '2025-12-28',
    checkOut: '2026-01-04',
    totalNights: 7,
    totalPaid: '700.00',
  })

  it('gives December only its four nights', () => {
    expect(revenueInsideMonth(crossing, 2025, 12)).toBeCloseTo(400, 6)
  })

  it('gives January only its three nights', () => {
    expect(revenueInsideMonth(crossing, 2026, 1)).toBeCloseTo(300, 6)
  })

  it('never counts the whole stay in the month it began', () => {
    expect(revenueInsideMonth(crossing, 2025, 12)).not.toBeCloseTo(700, 6)
  })

  it('splits the money exactly - none created, none lost', () => {
    const total = revenueInsideMonth(crossing, 2025, 12) + revenueInsideMonth(crossing, 2026, 1)
    expect(total).toBeCloseTo(700, 6)
  })

  it('gives a month the stay never touched nothing at all', () => {
    expect(revenueInsideMonth(crossing, 2026, 2)).toBe(0)
    expect(revenueInsideMonth(crossing, 2025, 11)).toBe(0)
  })
})

describe('revenueInsideMonth - a stay spanning three months', () => {
  // 15 Jan to 15 Mar 2026: 17 + 28 + 14 = 59 nights at 50 EUR.
  const long = stay({
    checkIn: '2026-01-15',
    checkOut: '2026-03-15',
    totalNights: 59,
    totalPaid: '2950.00',
  })

  it('pays the middle month its full month of nights', () => {
    expect(revenueInsideMonth(long, 2026, 2)).toBeCloseTo(28 * 50, 6)
  })

  it('splits across all three and adds back to the total', () => {
    const total =
      revenueInsideMonth(long, 2026, 1) +
      revenueInsideMonth(long, 2026, 2) +
      revenueInsideMonth(long, 2026, 3)
    expect(total).toBeCloseTo(2950, 6)
  })
})

describe('revenueInsideMonth - what it trusts', () => {
  // The split is totalPaid / totalNights * nightsInThisMonth, so it divides by
  // the stored night count rather than re-deriving it from the dates. That is
  // safe only because Reservation.save() recomputes `nights` from check_in and
  // check_out on every write, and nothing bulk-updates a date around it. This
  // test states the dependency out loud: if the two ever drift, the months
  // stop adding up to the reservation, and money is invented or lost.
  it('invents money when the stored night count is short of the real span', () => {
    const drifted = stay({
      checkIn: '2026-01-15',
      checkOut: '2026-03-15', // really 59 nights
      totalNights: 58, // but the record claims 58
      totalPaid: '2900.00',
    })
    const total =
      revenueInsideMonth(drifted, 2026, 1) +
      revenueInsideMonth(drifted, 2026, 2) +
      revenueInsideMonth(drifted, 2026, 3)
    expect(total).toBeCloseTo(2950, 6)
    expect(total).toBeGreaterThan(2900)
  })
})

describe('revenueInsideMonth - edges', () => {
  it('counts a checkout on the 1st as the previous month last night', () => {
    const overnight = stay({
      checkIn: '2026-01-31',
      checkOut: '2026-02-01',
      totalNights: 1,
      totalPaid: '90.00',
    })
    expect(revenueInsideMonth(overnight, 2026, 1)).toBeCloseTo(90, 6)
    expect(revenueInsideMonth(overnight, 2026, 2)).toBe(0)
  })

  it('handles a leap February', () => {
    const feb = stay({
      checkIn: '2024-02-01',
      checkOut: '2024-03-01',
      totalNights: 29,
      totalPaid: '2900.00',
    })
    expect(revenueInsideMonth(feb, 2024, 2)).toBeCloseTo(2900, 6)
  })

  it('returns 0 rather than NaN when the stay has no nights', () => {
    const zero = stay({
      checkIn: '2026-01-10',
      checkOut: '2026-01-10',
      totalNights: 0,
      totalPaid: '100.00',
    })
    expect(revenueInsideMonth(zero, 2026, 1)).toBe(0)
  })

  it('returns 0 rather than NaN when the price is unparseable', () => {
    const broken = stay({ totalPaid: 'not a number' })
    expect(revenueInsideMonth(broken, 2026, 1)).toBe(0)
  })
})

describe('nightsInsideMonth', () => {
  const monthStart = '2026-01-01'
  const monthEnd = '2026-01-31'

  it('counts only the nights inside the month', () => {
    const crossing = stay({ checkIn: '2025-12-28', checkOut: '2026-01-04', totalNights: 7 })
    expect(nightsInsideMonth(crossing, monthStart, monthEnd)).toBe(3)
  })

  it('counts a full month', () => {
    const whole = stay({ checkIn: '2026-01-01', checkOut: '2026-02-01', totalNights: 31 })
    expect(nightsInsideMonth(whole, monthStart, monthEnd)).toBe(31)
  })

  it('gives 0 for a stay that ended before the month', () => {
    const past = stay({ checkIn: '2025-11-01', checkOut: '2025-11-05', totalNights: 4 })
    expect(nightsInsideMonth(past, monthStart, monthEnd)).toBe(0)
  })

  it('gives 0 - never a negative - for a stay after the month', () => {
    const future = stay({ checkIn: '2026-03-01', checkOut: '2026-03-05', totalNights: 4 })
    expect(nightsInsideMonth(future, monthStart, monthEnd)).toBe(0)
  })
})

describe('buildPropertyReportStats', () => {
  const crossing = () =>
    stay({ checkIn: '2025-12-28', checkOut: '2026-01-04', totalNights: 7, totalPaid: '700.00' })

  it('reports turnover for the nights of the month only', () => {
    const [row] = buildPropertyReportStats([property()], [crossing()], 2026, 1)
    expect(row.turnover).toBeCloseTo(300, 6)
    expect(row.bookedNights).toBe(3)
  })

  it('derives the average nightly rate from the same nights', () => {
    const [row] = buildPropertyReportStats([property()], [crossing()], 2026, 1)
    expect(row.averageNightlyPrice).toBeCloseTo(100, 6)
  })

  it('does not let a stay in another month leak into the turnover', () => {
    const elsewhere = stay({
      checkIn: '2026-06-01',
      checkOut: '2026-06-10',
      totalNights: 9,
      totalPaid: '900.00',
    })
    const [row] = buildPropertyReportStats([property()], [elsewhere], 2026, 1)
    expect(row.turnover).toBe(0)
    expect(row.bookedNights).toBe(0)
  })

  it('counts free nights against the real length of the month', () => {
    const week = stay({
      checkIn: '2026-01-05',
      checkOut: '2026-01-12',
      totalNights: 7,
      totalPaid: '700.00',
    })
    const [row] = buildPropertyReportStats([property()], [week], 2026, 1)
    expect(row.bookedNights + row.freeNights).toBe(31)
  })

  it('reports the real length of February, not a generic 30', () => {
    const feb = stay({
      checkIn: '2026-02-01',
      checkOut: '2026-02-08',
      totalNights: 7,
      totalPaid: '700.00',
    })
    const [row] = buildPropertyReportStats([property()], [feb], 2026, 2)
    expect(row.bookedNights + row.freeNights).toBe(28)
  })
})

describe('buildPropertyYearStats', () => {
  it('gives a year only the nights that fall inside it', () => {
    const crossing = stay({
      checkIn: '2025-12-28',
      checkOut: '2026-01-04',
      totalNights: 7,
      totalPaid: '700.00',
    })
    const [row] = buildPropertyYearStats([property()], [crossing], 2026)
    expect(row.turnover).toBeCloseTo(300, 6)
    expect(row.bookedNights).toBe(3)
  })

  it('agrees with the twelve months of the same year added up', () => {
    const rows = [
      stay({ checkIn: '2025-12-28', checkOut: '2026-01-04', totalNights: 7, totalPaid: '700.00' }),
      stay({ checkIn: '2026-05-01', checkOut: '2026-05-11', totalNights: 10, totalPaid: '1000.00' }),
      stay({ checkIn: '2026-12-20', checkOut: '2027-01-10', totalNights: 21, totalPaid: '2100.00' }),
    ]
    const yearly = buildPropertyYearStats([property()], rows, 2026)[0].turnover
    let monthly = 0
    for (let month = 1; month <= 12; month += 1) {
      monthly += rows.reduce((sum, r) => sum + revenueInsideMonth(r, 2026, month), 0)
    }
    expect(yearly).toBeCloseTo(monthly, 6)
  })
})

describe('monthly rent follows the nights like everything else', () => {
  // Rent is *collected* per anniversary period - the Payments page still owes
  // the whole instalment in the month the period starts, and that is right.
  // But a report answers a different question: what did this month earn? Rent
  // for nights that fall in September is September's, however it was billed.
  const monthly = stay({
    reservationType: 'monthly',
    checkIn: '2026-01-15',
    checkOut: '2026-03-15',
    totalNights: 59,
    monthlyPrice: '600.00',
    totalPaid: '1200.00',
  })

  it('splits the rent across every month the tenancy occupies', () => {
    expect(revenueInsideMonth(monthly, 2026, 1)).toBeCloseTo((1200 * 17) / 59, 6)
    expect(revenueInsideMonth(monthly, 2026, 2)).toBeCloseTo((1200 * 28) / 59, 6)
    expect(revenueInsideMonth(monthly, 2026, 3)).toBeCloseTo((1200 * 14) / 59, 6)
  })

  it('gives March revenue for the nights March actually held', () => {
    expect(nightsInsideMonth(monthly, '2026-03-01', '2026-03-31')).toBe(14)
    expect(revenueInsideMonth(monthly, 2026, 3)).toBeGreaterThan(0)
  })

  it('conserves the rent exactly across the tenancy', () => {
    const total =
      revenueInsideMonth(monthly, 2026, 1) +
      revenueInsideMonth(monthly, 2026, 2) +
      revenueInsideMonth(monthly, 2026, 3)
    expect(total).toBeCloseTo(1200, 6)
  })

  it('gives every month the same nightly rate', () => {
    const rate = (month: number, nights: number) =>
      revenueInsideMonth(monthly, 2026, month) / nights
    expect(rate(1, 17)).toBeCloseTo(rate(2, 28), 6)
    expect(rate(2, 28)).toBeCloseTo(rate(3, 14), 6)
  })

  it('no longer strands booked nights on zero revenue', () => {
    const [row] = buildPropertyReportStats([property()], [monthly], 2026, 3)
    expect(row.bookedNights).toBe(14)
    expect(row.averageNightlyPrice).toBeGreaterThan(0)
  })
})

describe('Apartment #6, August 2026 - the row that started this', () => {
  // Six short stays plus one tenancy running 23 Aug to 23 Sep at 550 EUR.
  // Only 9 of that tenancy's 31 nights are August's.
  const shortStays = [
    stay({ checkIn: '2026-07-30', checkOut: '2026-08-02', totalNights: 3, totalPaid: '284.34' }),
    stay({ checkIn: '2026-08-03', checkOut: '2026-08-12', totalNights: 9, totalPaid: '267.03' }),
    stay({ checkIn: '2026-08-12', checkOut: '2026-08-15', totalNights: 3, totalPaid: '120.00' }),
    stay({ checkIn: '2026-08-15', checkOut: '2026-08-19', totalNights: 4, totalPaid: '130.00' }),
    stay({ checkIn: '2026-08-20', checkOut: '2026-08-21', totalNights: 1, totalPaid: '50.00' }),
    stay({ checkIn: '2026-08-21', checkOut: '2026-08-23', totalNights: 2, totalPaid: '70.00' }),
  ]
  const tenancy = stay({
    reservationType: 'monthly',
    checkIn: '2026-08-23',
    checkOut: '2026-09-23',
    totalNights: 31,
    monthlyPrice: '550.00',
    totalPaid: '550.00',
  })
  const all = [...shortStays, tenancy]

  it('still counts seven reservations across twenty-nine nights', () => {
    const [row] = buildPropertyReportStats([property()], all, 2026, 8)
    expect(row.reservations).toBe(7)
    expect(row.bookedNights).toBe(29)
    expect(row.freeNights).toBe(2)
    expect(row.occupancy).toBe(94)
  })

  it('charges August only the nine nights of rent it held', () => {
    expect(revenueInsideMonth(tenancy, 2026, 8)).toBeCloseTo((550 * 9) / 31, 2)
  })

  it('gives September the twenty-two nights it holds, instead of nothing', () => {
    expect(revenueInsideMonth(tenancy, 2026, 9)).toBeCloseTo((550 * 22) / 31, 2)
  })

  it('reports 891.49 for August, not 1281.81', () => {
    const [row] = buildPropertyReportStats([property()], all, 2026, 8)
    expect(row.turnover).toBeCloseTo(891.49, 1)
  })

  it('brings the average night back to a believable 30.74', () => {
    const [row] = buildPropertyReportStats([property()], all, 2026, 8)
    expect(row.averageNightlyPrice).toBeCloseTo(30.74, 1)
  })
})

describe('maintenance blocks and the occupancy figure', () => {
  // insightCalculations filters these out with isRealStay(); reportCalculations
  // does not. The same page therefore counts a maintenance block as an
  // occupied, revenue-earning-rate night in one place and ignores it in another.
  const block = stay({
    reservationType: 'maintenance',
    checkIn: '2026-01-01',
    checkOut: '2026-01-11',
    totalNights: 10,
    totalPaid: '0.00',
  })

  it('counts ten maintenance nights as booked', () => {
    const [row] = buildPropertyReportStats([property()], [block], 2026, 1)
    expect(row.bookedNights).toBe(10)
  })

  it('reports 32% occupancy for an apartment that earned nothing', () => {
    const [row] = buildPropertyReportStats([property()], [block], 2026, 1)
    expect(row.occupancy).toBe(32)
    expect(row.turnover).toBe(0)
  })

  it('counts the block as a reservation', () => {
    const [row] = buildPropertyReportStats([property()], [block], 2026, 1)
    expect(row.reservations).toBe(1)
  })

  it('halves the average nightly rate when a block sits beside a real stay', () => {
    const real = stay({
      checkIn: '2026-01-15',
      checkOut: '2026-01-25',
      totalNights: 10,
      totalPaid: '1000.00',
    })
    const [row] = buildPropertyReportStats([property()], [block, real], 2026, 1)
    expect(row.turnover).toBeCloseTo(1000, 6)
    expect(row.bookedNights).toBe(20)
    expect(row.averageNightlyPrice).toBeCloseTo(50, 6) // the real rate is 100
  })
})

describe('an archived reservation still counts in the report totals', () => {
  // The list endpoint filters is_archived server-side, so this only bites the
  // views that pass an unfiltered set - but the helper itself has no guard.
  it('includes an archived stay in turnover', () => {
    const archived = stay({
      checkIn: '2026-01-05',
      checkOut: '2026-01-15',
      totalNights: 10,
      totalPaid: '1000.00',
      isArchived: true,
    })
    const [row] = buildPropertyReportStats([property()], [archived], 2026, 1)
    expect(row.turnover).toBeCloseTo(1000, 6)
  })
})

describe('the reservation count is scoped to the month', () => {
  // ApartmentYearlyBreakdown calls buildPropertyReportStats twelve times with
  // the *unfiltered* all-years reservation list, once per month. Turnover and
  // nights are prorated and come out right, but the count was taken straight
  // from the property filter - so every month showed the apartment's all-time
  // reservation count, and the yearly total summed that figure twelve times.
  const june = stay({
    checkIn: '2026-06-01',
    checkOut: '2026-06-10',
    totalNights: 9,
    totalPaid: '900.00',
  })
  const january = stay({
    checkIn: '2026-01-05',
    checkOut: '2026-01-12',
    totalNights: 7,
    totalPaid: '700.00',
  })

  it('counts only the reservations with nights in the month', () => {
    const [row] = buildPropertyReportStats([property()], [january, june], 2026, 1)
    expect(row.reservations).toBe(1)
  })

  it('counts nothing in a month the apartment was empty', () => {
    const [row] = buildPropertyReportStats([property()], [january, june], 2026, 3)
    expect(row.reservations).toBe(0)
  })

  it('counts a boundary-crossing stay in both months it occupies', () => {
    const crossing = stay({
      checkIn: '2025-12-28',
      checkOut: '2026-01-04',
      totalNights: 7,
      totalPaid: '700.00',
    })
    expect(buildPropertyReportStats([property()], [crossing], 2025, 12)[0].reservations).toBe(1)
    expect(buildPropertyReportStats([property()], [crossing], 2026, 1)[0].reservations).toBe(1)
  })

  it('adds up over twelve months to the number of real stays', () => {
    let total = 0
    for (let month = 1; month <= 12; month += 1) {
      total += buildPropertyReportStats([property()], [january, june], 2026, month)[0].reservations
    }
    expect(total).toBe(2)
  })

  it('still counts every reservation in all-time mode', () => {
    const [row] = buildPropertyReportStats([property()], [january, june], 2026, 0)
    expect(row.reservations).toBe(2)
  })
})
