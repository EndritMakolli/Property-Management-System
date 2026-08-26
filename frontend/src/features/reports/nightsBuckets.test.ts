import { describe, expect, it } from 'vitest'
import type { ReservationRecord } from '../../types/domain'
import { bucketFor, bucketLabel, buildNightBuckets, staysInMonth } from './nightsBuckets'

// This panel used to ask "which stays *began* this month, and what is each
// worth in full". That put money from other months into the month on screen —
// a tenancy running 23 Aug to 23 Sep showed its whole 550 EUR under August —
// and left the page carrying two irreconcilable revenue totals.
//
// It now asks the same question every other figure answers: what did these
// nights, in this month, earn.

function stay(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  const checkIn = overrides.checkIn ?? '2026-08-03'
  const checkOut = overrides.checkOut ?? '2026-08-12'
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
    nightlyPrice: '30.00',
    totalPaid: '270.00',
    isArchived: false,
    archivedAt: '',
    ...overrides,
  }
}

describe('bucketFor', () => {
  it('keeps short stays in their own bucket', () => {
    expect(bucketFor(1)).toBe(1)
    expect(bucketFor(7)).toBe(7)
  })

  it('rolls anything from eight nights up into one bucket', () => {
    expect(bucketFor(8)).toBe(8)
    expect(bucketFor(31)).toBe(8)
  })

  it('labels the long bucket as open-ended', () => {
    expect(bucketLabel(8)).toBe('8+ nights')
    expect(bucketLabel(1)).toBe('1 night')
    expect(bucketLabel(3)).toBe('3 nights')
  })
})

describe('staysInMonth', () => {
  it('includes a stay that arrived last month and is still here', () => {
    const arriving = stay({ checkIn: '2026-07-30', checkOut: '2026-08-02', totalNights: 3 })
    expect(staysInMonth([arriving], 2026, 8)).toHaveLength(1)
  })

  it('includes a stay that runs on into next month', () => {
    const leaving = stay({ checkIn: '2026-08-23', checkOut: '2026-09-23', totalNights: 31 })
    expect(staysInMonth([leaving], 2026, 8)).toHaveLength(1)
  })

  it('excludes a stay that never touches the month', () => {
    const elsewhere = stay({ checkIn: '2026-06-01', checkOut: '2026-06-10', totalNights: 9 })
    expect(staysInMonth([elsewhere], 2026, 8)).toHaveLength(0)
  })

  it('excludes a stay that checked out on the first of the month', () => {
    // Left on the morning of 1 August, so it slept no August night.
    const left = stay({ checkIn: '2026-07-28', checkOut: '2026-08-01', totalNights: 4 })
    expect(staysInMonth([left], 2026, 8)).toHaveLength(0)
  })
})

describe('buildNightBuckets', () => {
  it('buckets by the length of the whole stay, not the nights in this month', () => {
    // A 31-night tenancy is a long stay even in a month it only half occupies.
    const tenancy = stay({ checkIn: '2026-08-23', checkOut: '2026-09-23', totalNights: 31 })
    const rows = buildNightBuckets([tenancy], 2026, 8)
    expect(rows.find((r) => r.value === 8)?.count).toBe(1)
  })

  it('credits only the nights that fall inside the month', () => {
    const tenancy = stay({
      checkIn: '2026-08-23',
      checkOut: '2026-09-23',
      totalNights: 31,
      totalPaid: '550.00',
    })
    const rows = buildNightBuckets([tenancy], 2026, 8)
    expect(rows.find((r) => r.value === 8)?.revenue).toBeCloseTo((550 * 9) / 31, 2)
  })

  it('gives the rest of that tenancy to September', () => {
    const tenancy = stay({
      checkIn: '2026-08-23',
      checkOut: '2026-09-23',
      totalNights: 31,
      totalPaid: '550.00',
    })
    const rows = buildNightBuckets([tenancy], 2026, 9)
    expect(rows.find((r) => r.value === 8)?.revenue).toBeCloseTo((550 * 22) / 31, 2)
  })

  it('counts the nights each bucket actually held', () => {
    const tenancy = stay({ checkIn: '2026-08-23', checkOut: '2026-09-23', totalNights: 31 })
    expect(rowFor(buildNightBuckets([tenancy], 2026, 8), 8).nights).toBe(9)
  })

  it('picks up a stay that arrived before the month began', () => {
    const arriving = stay({
      checkIn: '2026-07-30',
      checkOut: '2026-08-02',
      totalNights: 3,
      totalPaid: '284.34',
    })
    const rows = buildNightBuckets([arriving], 2026, 8)
    expect(rowFor(rows, 3).count).toBe(1)
    expect(rowFor(rows, 3).revenue).toBeCloseTo(284.34 / 3, 2)
  })

  it('adds up to the month turnover, so the page reconciles', () => {
    const rows = buildNightBuckets(august(), 2026, 8)
    const total = rows.reduce((sum, r) => sum + r.revenue, 0)
    expect(total).toBeCloseTo(891.49, 1)
  })

  it('adds up to the nights the month actually held', () => {
    const rows = buildNightBuckets(august(), 2026, 8)
    expect(rows.reduce((sum, r) => sum + r.nights, 0)).toBe(29)
  })

  it('returns every bucket, including the empty ones', () => {
    const rows = buildNightBuckets([stay()], 2026, 8)
    expect(rows.map((r) => r.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('gives no bucket a share when the month is empty', () => {
    const rows = buildNightBuckets([], 2026, 8)
    expect(rows.every((r) => r.count === 0 && r.revenue === 0 && r.pct === 0)).toBe(true)
  })

  it('shares out to a hundred percent when stays are present', () => {
    const rows = buildNightBuckets(august(), 2026, 8)
    expect(rows.reduce((sum, r) => sum + r.pct, 0)).toBeGreaterThan(95)
  })
})

function rowFor(rows: ReturnType<typeof buildNightBuckets>, value: number) {
  const row = rows.find((r) => r.value === value)
  if (!row) throw new Error(`no bucket ${value}`)
  return row
}

// Apartment #6, August 2026 - the real row this all came from.
function august(): ReservationRecord[] {
  return [
    stay({ checkIn: '2026-07-30', checkOut: '2026-08-02', totalNights: 3, totalPaid: '284.34' }),
    stay({ checkIn: '2026-08-03', checkOut: '2026-08-12', totalNights: 9, totalPaid: '267.03' }),
    stay({ checkIn: '2026-08-12', checkOut: '2026-08-15', totalNights: 3, totalPaid: '120.00' }),
    stay({ checkIn: '2026-08-15', checkOut: '2026-08-19', totalNights: 4, totalPaid: '130.00' }),
    stay({ checkIn: '2026-08-20', checkOut: '2026-08-21', totalNights: 1, totalPaid: '50.00' }),
    stay({ checkIn: '2026-08-21', checkOut: '2026-08-23', totalNights: 2, totalPaid: '70.00' }),
    stay({
      reservationType: 'monthly',
      checkIn: '2026-08-23',
      checkOut: '2026-09-23',
      totalNights: 31,
      monthlyPrice: '550.00',
      totalPaid: '550.00',
    }),
  ]
}
