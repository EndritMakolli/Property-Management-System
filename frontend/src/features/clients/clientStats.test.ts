import { describe, expect, it } from 'vitest'
import type { ReservationRecord } from '../../types/domain'
import { partitionStays } from '../guest/accountView'
import { splitStays, stayStatsFrom } from './clientStats'

// The client detail page shows a staff member the same numbers the guest sees
// in their own portal, computed the same way. `statTiles` and `partitionStays`
// already exist for the portal, so the job here is to feed them a
// ReservationRecord rather than to write a second set of stats.

const TODAY = '2026-08-26'

function stay(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  const checkIn = overrides.checkIn ?? '2026-08-01'
  const checkOut = overrides.checkOut ?? '2026-08-05'
  const nights =
    overrides.totalNights ??
    Math.round(
      (new Date(`${checkOut}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime()) /
        86400000,
    )
  return {
    id: Math.random().toString(36).slice(2),
    guestName: 'Rina Gashi',
    guestPhone: '',
    paymentDue: '',
    paid: true,
    notes: '',
    reservationType: 'private',
    propertyId: 'p1',
    apartment: 'Apartment #2',
    apartmentType: '1 bedroom',
    checkIn,
    checkOut,
    totalNights: nights,
    nightlyPrice: '50.00',
    totalPaid: '200.00',
    isArchived: false,
    archivedAt: '',
    ...overrides,
  }
}

describe('stayStatsFrom', () => {
  it('counts every stay, finished or not', () => {
    const rows = [
      stay({ checkIn: '2026-07-01', checkOut: '2026-07-05' }),
      stay({ checkIn: '2026-09-01', checkOut: '2026-09-05' }),
    ]
    expect(stayStatsFrom(rows, TODAY).stays).toBe(2)
  })

  it('adds up the nights', () => {
    const rows = [
      stay({ checkIn: '2026-07-01', checkOut: '2026-07-05', totalNights: 4 }),
      stay({ checkIn: '2026-09-01', checkOut: '2026-09-04', totalNights: 3 }),
    ]
    expect(stayStatsFrom(rows, TODAY).nights).toBe(7)
  })

  it('adds up the money as a string the tiles can format', () => {
    const rows = [stay({ totalPaid: '200.00' }), stay({ totalPaid: '150.50' })]
    expect(stayStatsFrom(rows, TODAY).totalSpentEur).toBe('350.50')
  })

  it('reports the last finished checkout as the last visit', () => {
    const rows = [
      stay({ checkIn: '2026-07-01', checkOut: '2026-07-05' }),
      stay({ checkIn: '2026-08-10', checkOut: '2026-08-14' }),
    ]
    expect(stayStatsFrom(rows, TODAY).lastVisit).toBe('2026-08-14')
  })

  it('does not call a future booking a visit', () => {
    const rows = [
      stay({ checkIn: '2026-07-01', checkOut: '2026-07-05' }),
      stay({ checkIn: '2026-12-01', checkOut: '2026-12-05' }),
    ]
    expect(stayStatsFrom(rows, TODAY).lastVisit).toBe('2026-07-05')
  })

  it('reads as zero for a client who has never stayed', () => {
    const stats = stayStatsFrom([], TODAY)
    expect(stats.stays).toBe(0)
    expect(stats.nights).toBe(0)
    expect(stats.totalSpentEur).toBe('0.00')
    expect(stats.lastVisit).toBe('')
  })

  it('never produces NaN from an unparseable price', () => {
    expect(stayStatsFrom([stay({ totalPaid: 'oops' })], TODAY).totalSpentEur).not.toMatch(/NaN/)
  })

  it('treats a checkout today as finished', () => {
    const rows = [stay({ checkIn: '2026-08-22', checkOut: TODAY })]
    expect(stayStatsFrom(rows, TODAY).lastVisit).toBe(TODAY)
  })
})

describe('splitStays', () => {
  it('separates what has happened from what has not', () => {
    const past = stay({ checkIn: '2026-07-01', checkOut: '2026-07-05' })
    const future = stay({ checkIn: '2026-09-01', checkOut: '2026-09-05' })
    const split = splitStays([past, future], TODAY)
    expect(split.past).toEqual([past])
    expect(split.upcoming).toEqual([future])
  })

  it('counts a stay in progress as upcoming, because they are still here', () => {
    const inHouse = stay({ checkIn: '2026-08-24', checkOut: '2026-08-30' })
    expect(splitStays([inHouse], TODAY).upcoming).toHaveLength(1)
  })

  it('sorts upcoming soonest first', () => {
    const later = stay({ checkIn: '2026-12-01', checkOut: '2026-12-05' })
    const sooner = stay({ checkIn: '2026-09-01', checkOut: '2026-09-05' })
    expect(splitStays([later, sooner], TODAY).upcoming).toEqual([sooner, later])
  })

  it('sorts past most recent first', () => {
    const older = stay({ checkIn: '2026-01-01', checkOut: '2026-01-05' })
    const newer = stay({ checkIn: '2026-07-01', checkOut: '2026-07-05' })
    expect(splitStays([older, newer], TODAY).past).toEqual([newer, older])
  })

  it('gives two empty arrays rather than undefined', () => {
    expect(splitStays([], TODAY)).toEqual({ upcoming: [], past: [] })
  })

  it('leaves the array it was given alone', () => {
    const rows = [stay({ checkIn: '2026-12-01' }), stay({ checkIn: '2026-09-01' })]
    const before = [...rows]
    splitStays(rows, TODAY)
    expect(rows).toEqual(before)
  })

  it('is the guest portal helper, not a second copy of it', () => {
    // splitStays delegates to partitionStays. If someone forks the logic, a
    // reservation and a guest booking will start disagreeing about the same
    // stay, so this pins that they still answer identically.
    const rows = [
      stay({ checkIn: '2026-07-01', checkOut: '2026-07-05' }),
      stay({ checkIn: '2026-09-01', checkOut: '2026-09-05' }),
    ]
    expect(splitStays(rows, TODAY)).toEqual(partitionStays(rows, TODAY))
  })
})
