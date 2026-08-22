import { describe, expect, it } from 'vitest'
import type { GuestBooking, GuestStats } from '../../types/domain'
import { partitionStays, statTiles } from './accountView'

const TODAY = '2026-08-22'

function booking(overrides: Partial<GuestBooking> = {}): GuestBooking {
  return {
    id: Math.random().toString(36).slice(2),
    status: 'confirmed',
    checkIn: '2026-09-01',
    checkOut: '2026-09-05',
    nights: 4,
    guestsCount: 2,
    totalPriceEur: '200.00',
    declineReason: '',
    canCancel: true,
    property: { name: 'Apartment A', bedrooms: 1, photoUrl: '', address: '', floor: '' },
    ...overrides,
  }
}

describe('partitionStays', () => {
  it('puts a future stay in upcoming', () => {
    const row = booking()
    expect(partitionStays([row], TODAY).upcoming).toEqual([row])
  })

  it('puts a finished stay in past', () => {
    const row = booking({ checkIn: '2026-07-01', checkOut: '2026-07-05' })
    expect(partitionStays([row], TODAY).past).toEqual([row])
  })

  it('treats a stay in progress as upcoming', () => {
    // Checked in yesterday, leaving next week — they are still with us.
    const row = booking({ checkIn: '2026-08-21', checkOut: '2026-08-28' })
    expect(partitionStays([row], TODAY).upcoming).toHaveLength(1)
  })

  it('treats a checkout today as past', () => {
    const row = booking({ checkIn: '2026-08-18', checkOut: TODAY })
    expect(partitionStays([row], TODAY).past).toHaveLength(1)
  })

  it('keeps a pending request in upcoming', () => {
    const row = booking({ status: 'pending' })
    expect(partitionStays([row], TODAY).upcoming).toHaveLength(1)
  })

  it('puts a declined request in past whatever its dates', () => {
    const row = booking({ status: 'declined', checkOut: '2027-01-01' })
    expect(partitionStays([row], TODAY).past).toHaveLength(1)
  })

  it('puts a cancelled booking in past whatever its dates', () => {
    const row = booking({ status: 'cancelled', checkOut: '2027-01-01' })
    expect(partitionStays([row], TODAY).past).toHaveLength(1)
  })

  it('puts an expired request in past', () => {
    const row = booking({ status: 'expired', checkOut: '2027-01-01' })
    expect(partitionStays([row], TODAY).past).toHaveLength(1)
  })

  it('sorts upcoming soonest first', () => {
    const later = booking({ checkIn: '2026-12-01', checkOut: '2026-12-05' })
    const sooner = booking({ checkIn: '2026-09-01', checkOut: '2026-09-05' })
    expect(partitionStays([later, sooner], TODAY).upcoming).toEqual([sooner, later])
  })

  it('sorts past most recent first', () => {
    const older = booking({ checkIn: '2026-01-01', checkOut: '2026-01-05' })
    const newer = booking({ checkIn: '2026-07-01', checkOut: '2026-07-05' })
    expect(partitionStays([older, newer], TODAY).past).toEqual([newer, older])
  })

  it('gives two empty arrays for no bookings, never undefined', () => {
    expect(partitionStays([], TODAY)).toEqual({ upcoming: [], past: [] })
  })

  it('does not mutate what it was given', () => {
    const rows = [booking({ checkIn: '2026-12-01' }), booking({ checkIn: '2026-09-01' })]
    const before = [...rows]
    partitionStays(rows, TODAY)
    expect(rows).toEqual(before)
  })
})

function stats(overrides: Partial<GuestStats> = {}): GuestStats {
  return { stays: 3, nights: 11, totalSpentEur: '1234.50', lastVisit: '2026-07-05', ...overrides }
}

describe('statTiles', () => {
  it('returns the four tiles in order', () => {
    expect(statTiles(stats()).map((tile) => tile.label)).toEqual([
      'Stays',
      'Nights',
      'Total spent',
      'Last visit',
    ])
  })

  it('says one stay in the singular', () => {
    expect(statTiles(stats({ stays: 1 }))[0].value).toBe('1 stay')
  })

  it('says two stays in the plural', () => {
    expect(statTiles(stats({ stays: 2 }))[0].value).toBe('2 stays')
  })

  it('formats money without stray decimals', () => {
    expect(statTiles(stats({ totalSpentEur: '1234.50' }))[2].value).toBe('€1,234.50')
  })

  it('shows a round total without cents', () => {
    expect(statTiles(stats({ totalSpentEur: '200.00' }))[2].value).toBe('€200')
  })

  it('reads plainly for a guest who has not stayed yet', () => {
    const tiles = statTiles(stats({ stays: 0, nights: 0, totalSpentEur: '0.00', lastVisit: '' }))
    expect(tiles[0].value).toBe('0 stays')
    expect(tiles[2].value).toBe('€0')
    expect(tiles[3].value).toBe('No visits yet')
  })

  it('never renders NaN or Invalid Date', () => {
    const tiles = statTiles({ stays: 0, nights: 0, totalSpentEur: '', lastVisit: '' })
    for (const tile of tiles) {
      expect(tile.value).not.toMatch(/NaN|Invalid/)
    }
  })
})
