import { describe, expect, it } from 'vitest'
import type { ReservationRecord } from '../../types/domain'
import {
  GARAGE_FILTERS,
  HOSTING_SORT_OPTIONS,
  applyGarageFilter,
  currentlyHosting,
  garageCounts,
  sortHosting,
} from './hostingView'

const TODAY = '2026-08-26'

function stay(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  const checkIn = overrides.checkIn ?? '2026-08-24'
  const checkOut = overrides.checkOut ?? '2026-08-30'
  const nights =
    overrides.totalNights ??
    Math.round(
      (new Date(`${checkOut}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime()) /
        86400000,
    )
  return {
    id: Math.random().toString(36).slice(2),
    guestName: 'Rina Gashi',
    guestPhone: '044111222',
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
    totalPaid: '300.00',
    garageCard: false,
    isArchived: false,
    archivedAt: '',
    ...overrides,
  }
}

describe('currentlyHosting', () => {
  it('includes a stay in progress', () => {
    expect(currentlyHosting([stay()], TODAY)).toHaveLength(1)
  })

  it('includes someone who arrived today', () => {
    expect(currentlyHosting([stay({ checkIn: TODAY, checkOut: '2026-08-29' })], TODAY)).toHaveLength(1)
  })

  it('excludes someone who left this morning', () => {
    // They handed the key back; the apartment is free tonight.
    expect(currentlyHosting([stay({ checkIn: '2026-08-20', checkOut: TODAY })], TODAY)).toHaveLength(0)
  })

  it('excludes someone arriving tomorrow', () => {
    expect(
      currentlyHosting([stay({ checkIn: '2026-08-27', checkOut: '2026-08-30' })], TODAY),
    ).toHaveLength(0)
  })

  it('excludes a finished stay', () => {
    expect(
      currentlyHosting([stay({ checkIn: '2026-07-01', checkOut: '2026-07-05' })], TODAY),
    ).toHaveLength(0)
  })

  it('excludes a maintenance block, which is not a guest', () => {
    expect(currentlyHosting([stay({ reservationType: 'maintenance' })], TODAY)).toHaveLength(0)
  })

  it('excludes an archived stay', () => {
    expect(currentlyHosting([stay({ isArchived: true })], TODAY)).toHaveLength(0)
  })

  it('gives an empty array rather than undefined', () => {
    expect(currentlyHosting([], TODAY)).toEqual([])
  })
})

describe('garageCounts', () => {
  it('counts who holds a card and who does not', () => {
    const rows = [stay({ garageCard: true }), stay({ garageCard: true }), stay({ garageCard: false })]
    expect(garageCounts(rows)).toEqual({ total: 3, withCard: 2, withoutCard: 1 })
  })

  it('adds up to the total', () => {
    const rows = Array.from({ length: 7 }, (_, i) => stay({ garageCard: i % 2 === 0 }))
    const counts = garageCounts(rows)
    expect(counts.withCard + counts.withoutCard).toBe(counts.total)
  })

  it('reads as zero for an empty building', () => {
    expect(garageCounts([])).toEqual({ total: 0, withCard: 0, withoutCard: 0 })
  })

  it('treats a missing flag as no card, never as undefined', () => {
    const row = stay()
    delete (row as { garageCard?: boolean }).garageCard
    expect(garageCounts([row])).toEqual({ total: 1, withCard: 0, withoutCard: 1 })
  })
})

describe('applyGarageFilter', () => {
  const held = stay({ garageCard: true, guestName: 'Has card' })
  const missing = stay({ garageCard: false, guestName: 'No card' })

  it('shows everyone by default', () => {
    expect(applyGarageFilter([held, missing], 'all')).toHaveLength(2)
  })

  it('narrows to those still owed a card', () => {
    expect(applyGarageFilter([held, missing], 'without').map((r) => r.guestName)).toEqual(['No card'])
  })

  it('narrows to those holding one', () => {
    expect(applyGarageFilter([held, missing], 'with').map((r) => r.guestName)).toEqual(['Has card'])
  })

  it('offers exactly the three filters the UI shows', () => {
    expect(GARAGE_FILTERS.map((f) => f.value)).toEqual(['all', 'without', 'with'])
  })
})

describe('sortHosting', () => {
  const a = stay({ apartment: 'Apartment #2', guestName: 'Zana', checkOut: '2026-08-31', totalNights: 7 })
  const b = stay({ apartment: 'Apartment #10', guestName: 'Ardit', checkOut: '2026-08-27', totalNights: 2 })

  it('sorts apartments the way a person reads them, not the way a string sorts', () => {
    // #2 before #10 — a plain string compare puts "#10" first.
    expect(sortHosting([a, b], 'apartment', 'asc').map((r) => r.apartment)).toEqual([
      'Apartment #2',
      'Apartment #10',
    ])
  })

  it('sorts by guest name', () => {
    expect(sortHosting([a, b], 'guest', 'asc').map((r) => r.guestName)).toEqual(['Ardit', 'Zana'])
  })

  it('sorts by who leaves soonest', () => {
    expect(sortHosting([a, b], 'checkOut', 'asc').map((r) => r.checkOut)).toEqual([
      '2026-08-27',
      '2026-08-31',
    ])
  })

  it('sorts by length of stay', () => {
    expect(sortHosting([a, b], 'nights', 'desc').map((r) => r.totalNights)).toEqual([7, 2])
  })

  it('reverses cleanly', () => {
    const up = sortHosting([a, b], 'guest', 'asc').map((r) => r.guestName)
    const down = sortHosting([a, b], 'guest', 'desc').map((r) => r.guestName)
    expect(down).toEqual([...up].reverse())
  })

  it('leaves the caller array alone', () => {
    const rows = [a, b]
    const before = [...rows]
    sortHosting(rows, 'guest', 'asc')
    expect(rows).toEqual(before)
  })

  it('falls back to the guest phone when there is no name', () => {
    const nameless = stay({ guestName: '', guestPhone: '044999888' })
    expect(sortHosting([nameless], 'guest', 'asc')[0].guestPhone).toBe('044999888')
  })

  it('offers exactly the sort keys the picker shows', () => {
    expect(HOSTING_SORT_OPTIONS.map((o) => o.value)).toEqual([
      'apartment',
      'guest',
      'checkOut',
      'nights',
    ])
  })
})
