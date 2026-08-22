import { describe, expect, it } from 'vitest'
import type { ReservationRecord } from '../../types/domain'
import {
  lastMonths,
  newVsReturning,
  platformRevenue,
  topApartmentsByRevenue,
} from './insightCalculations'

// The chart palette used to be a frozen array in this file. Types are editable
// now, so the series has to be handed in — otherwise a renamed type shows its
// old name and a type an admin added never appears in the chart at all.
const TYPES = [
  { code: 'private', label: 'Private', color: '#202020' },
  { code: 'airbnb', label: 'Airbnb', color: '#e51b3f' },
  { code: 'glamping', label: 'Glamping', color: '#00ff00' },
]

function stay(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    id: Math.random().toString(36).slice(2),
    propertyId: 'p1',
    apartment: 'A',
    guestId: '',
    guestName: 'Guest',
    guestPhone: '',
    reservationType: 'airbnb',
    checkIn: '2026-03-01',
    checkOut: '2026-03-06',
    totalNights: 5,
    totalPaid: '500.00',
    paid: true,
    isArchived: false,
    ...overrides,
  } as ReservationRecord
}

describe('platformRevenue', () => {
  it('splits revenue by type', () => {
    const rows = platformRevenue(
      [stay({ reservationType: 'airbnb' }), stay({ reservationType: 'private' })],
      2026,
      3,
      TYPES,
    )
    expect(rows.map((row) => row.label).sort()).toEqual(['Airbnb', 'Private'])
  })

  it('carries each type its own colour', () => {
    const [row] = platformRevenue([stay({ reservationType: 'airbnb' })], 2026, 3, TYPES)
    expect(row.color).toBe('#e51b3f')
  })

  it('follows a renamed type rather than a hardcoded label', () => {
    const renamed = [{ code: 'airbnb', label: 'Airbnb UK', color: '#e51b3f' }]
    const [row] = platformRevenue([stay({ reservationType: 'airbnb' })], 2026, 3, renamed)
    expect(row.label).toBe('Airbnb UK')
  })

  it('includes a type an admin invented', () => {
    const [row] = platformRevenue([stay({ reservationType: 'glamping' })], 2026, 3, TYPES)
    expect(row.label).toBe('Glamping')
  })

  it('leaves out types that earned nothing in the period', () => {
    const rows = platformRevenue([stay({ reservationType: 'airbnb' })], 2026, 3, TYPES)
    expect(rows.map((row) => row.key)).toEqual(['airbnb'])
  })

  it('ignores maintenance blocks, which are not income', () => {
    const rows = platformRevenue(
      [stay({ reservationType: 'maintenance', totalPaid: '900.00' })],
      2026,
      3,
      [...TYPES, { code: 'maintenance', label: 'Maintenance', color: '#16a34a' }],
    )
    expect(rows).toEqual([])
  })

  it('ignores archived stays', () => {
    const rows = platformRevenue([stay({ isArchived: true })], 2026, 3, TYPES)
    expect(rows).toEqual([])
  })

  it('sums a whole year when the month is zero', () => {
    const rows = platformRevenue(
      [stay({ checkIn: '2026-01-02', checkOut: '2026-01-07' }), stay()],
      2026,
      0,
      TYPES,
    )
    expect(rows[0].value).toBeGreaterThan(0)
  })
})

describe('newVsReturning', () => {
  // A guest is "returning" on a stay when they had an earlier one — not when
  // Guest.is_returning happens to be set. That flag is a sticky lifetime marker:
  // it is true even on the very first stay of someone who later came back, so
  // using it would count that first visit as a return.
  const firstVisit = stay({
    guestId: 'g1',
    checkIn: '2026-01-10',
    checkOut: '2026-01-12',
  })
  const secondVisit = stay({
    guestId: 'g1',
    checkIn: '2026-03-04',
    checkOut: '2026-03-08',
  })

  it('counts a guest with no earlier stay as new', () => {
    expect(newVsReturning([firstVisit], 2026, 1)).toMatchObject({ newCount: 1, returningCount: 0 })
  })

  it('counts a later stay by the same guest as returning', () => {
    expect(newVsReturning([firstVisit, secondVisit], 2026, 3)).toMatchObject({
      newCount: 0,
      returningCount: 1,
    })
  })

  it('still calls the first visit new when both are in view', () => {
    expect(newVsReturning([firstVisit, secondVisit], 2026, 1)).toMatchObject({
      newCount: 1,
      returningCount: 0,
    })
  })

  it('looks outside the month for earlier stays', () => {
    // Only March is being counted, but January is what makes March a return.
    const result = newVsReturning([firstVisit, secondVisit], 2026, 3)
    expect(result.returningCount).toBe(1)
  })

  it('counts by arrival, so a stay running into the month is not counted twice', () => {
    const straddling = stay({ guestId: 'g2', checkIn: '2026-02-26', checkOut: '2026-03-03' })
    expect(newVsReturning([straddling], 2026, 3).newCount).toBe(0)
  })

  it('reports stays with no client attached rather than calling them new', () => {
    // guestId is "" on rows the linker has not matched. Counting them as new
    // would quietly inflate the figure the operator is looking at.
    const orphan = stay({ guestId: '', checkIn: '2026-03-02', checkOut: '2026-03-04' })
    expect(newVsReturning([orphan], 2026, 3)).toMatchObject({
      newCount: 0,
      returningCount: 0,
      unlinked: 1,
    })
  })

  it('ignores maintenance blocks', () => {
    const block = stay({
      guestId: 'g9',
      reservationType: 'maintenance',
      checkIn: '2026-03-02',
      checkOut: '2026-03-04',
    })
    expect(newVsReturning([block], 2026, 3)).toMatchObject({ newCount: 0, unlinked: 0 })
  })

  it('ignores archived stays', () => {
    const archived = stay({ guestId: 'g8', checkIn: '2026-03-02', isArchived: true })
    expect(newVsReturning([archived], 2026, 3).newCount).toBe(0)
  })

  it('counts two different guests separately', () => {
    const other = stay({ guestId: 'g3', checkIn: '2026-03-05', checkOut: '2026-03-07' })
    expect(newVsReturning([secondVisit, firstVisit, other], 2026, 3)).toMatchObject({
      newCount: 1,
      returningCount: 1,
    })
  })

  it('counts a whole year when the month is zero', () => {
    expect(newVsReturning([firstVisit, secondVisit], 2026, 0)).toMatchObject({
      newCount: 1,
      returningCount: 1,
    })
  })

  it('is all zeroes for a quiet month', () => {
    expect(newVsReturning([firstVisit], 2026, 7)).toEqual({
      newCount: 0,
      returningCount: 0,
      unlinked: 0,
    })
  })
})

describe('lastMonths', () => {
  it('ends with the month it is given', () => {
    const window = lastMonths('2026-08-22', 4)
    expect(window[window.length - 1]).toEqual({ year: 2026, month: 8 })
  })

  it('returns as many months as asked for', () => {
    expect(lastMonths('2026-08-22', 4)).toHaveLength(4)
  })

  it('counts backwards in order', () => {
    expect(lastMonths('2026-08-22', 4)).toEqual([
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
    ])
  })

  it('rolls back over the turn of the year', () => {
    expect(lastMonths('2026-02-10', 4)).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ])
  })
})

describe('topApartmentsByRevenue', () => {
  const PROPERTIES = [
    { id: 'p1', name: 'Apartment 1' },
    { id: 'p2', name: 'Apartment 2' },
    { id: 'p3', name: 'Apartment 3' },
  ]
  const WINDOW = lastMonths('2026-08-22', 4)

  function earned(propertyId: string, checkIn: string, paid: string) {
    return stay({
      propertyId,
      checkIn,
      checkOut: checkIn.slice(0, 8) + String(Number(checkIn.slice(8)) + 2).padStart(2, '0'),
      totalNights: 2,
      totalPaid: paid,
    })
  }

  it('totals revenue across the whole window, not one month', () => {
    const rows = topApartmentsByRevenue(
      PROPERTIES,
      [earned('p1', '2026-06-02', '100.00'), earned('p1', '2026-08-02', '150.00')],
      WINDOW,
    )
    expect(rows[0].revenue).toBe(250)
  })

  it('ranks the biggest earner first', () => {
    const rows = topApartmentsByRevenue(
      PROPERTIES,
      [earned('p1', '2026-07-02', '100.00'), earned('p2', '2026-07-02', '400.00')],
      WINDOW,
    )
    expect(rows.map((row) => row.name)).toEqual(['Apartment 2', 'Apartment 1'])
  })

  it('ignores earnings from before the window', () => {
    const rows = topApartmentsByRevenue(
      PROPERTIES,
      [earned('p1', '2026-01-02', '900.00')],
      WINDOW,
    )
    expect(rows).toEqual([])
  })

  it('leaves out apartments that earned nothing', () => {
    const rows = topApartmentsByRevenue(
      PROPERTIES,
      [earned('p1', '2026-07-02', '100.00')],
      WINDOW,
    )
    expect(rows.map((row) => row.id)).toEqual(['p1'])
  })

  it('ignores maintenance blocks', () => {
    const rows = topApartmentsByRevenue(
      PROPERTIES,
      [{ ...earned('p1', '2026-07-02', '900.00'), reservationType: 'maintenance' }],
      WINDOW,
    )
    expect(rows).toEqual([])
  })

  it('ignores archived stays', () => {
    const rows = topApartmentsByRevenue(
      PROPERTIES,
      [{ ...earned('p1', '2026-07-02', '900.00'), isArchived: true }],
      WINDOW,
    )
    expect(rows).toEqual([])
  })

  it('respects the limit', () => {
    const rows = topApartmentsByRevenue(
      PROPERTIES,
      [
        earned('p1', '2026-07-02', '100.00'),
        earned('p2', '2026-07-02', '200.00'),
        earned('p3', '2026-07-02', '300.00'),
      ],
      WINDOW,
      2,
    )
    expect(rows).toHaveLength(2)
  })

  it('does not mutate the properties it was given', () => {
    const before = [...PROPERTIES]
    topApartmentsByRevenue(PROPERTIES, [earned('p1', '2026-07-02', '100.00')], WINDOW)
    expect(PROPERTIES).toEqual(before)
  })

  it('is empty when nothing was earned at all', () => {
    expect(topApartmentsByRevenue(PROPERTIES, [], WINDOW)).toEqual([])
  })
})
