import { describe, expect, it } from 'vitest'
import type { ReservationRecord } from '../../types/domain'
import { buildCheckIns } from './checkInPriority'

const TODAY = '2026-08-22'

// The operator's own order: Airbnb first, then Booking, then private guests,
// with returning private guests grouped last so they can be greeted as such.
const ORDER = ['private', 'airbnb', 'booking', 'monthly', 'direct', 'maintenance']

function arrival(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    id: Math.random().toString(36).slice(2),
    propertyId: 'p1',
    apartment: 'Apartment 1',
    guestId: 'g1',
    guestName: 'Guest',
    guestPhone: '',
    guestIsReturning: false,
    reservationType: 'private',
    checkIn: TODAY,
    checkOut: '2026-08-26',
    totalNights: 4,
    totalPaid: '400.00',
    paid: true,
    isArchived: false,
    ...overrides,
  } as ReservationRecord
}

const codes = (rows: { reservation: ReservationRecord }[]) =>
  rows.map((row) => row.reservation.reservationType)

describe('buildCheckIns', () => {
  it('only lists people arriving on the day being viewed', () => {
    const rows = buildCheckIns(
      [arrival(), arrival({ checkIn: '2026-08-23' }), arrival({ checkIn: '2026-08-21' })],
      TODAY,
      ORDER,
    )
    expect(rows).toHaveLength(1)
  })

  it('does not list a guest who is merely still staying', () => {
    const rows = buildCheckIns(
      [arrival({ checkIn: '2026-08-19', checkOut: '2026-08-25' })],
      TODAY,
      ORDER,
    )
    expect(rows).toHaveLength(0)
  })

  it('puts Airbnb first, then Booking, then private', () => {
    const rows = buildCheckIns(
      [
        arrival({ reservationType: 'private' }),
        arrival({ reservationType: 'booking' }),
        arrival({ reservationType: 'airbnb' }),
      ],
      TODAY,
      ORDER,
    )
    expect(codes(rows)).toEqual(['airbnb', 'booking', 'private'])
  })

  it('puts a returning private guest after the other private guests', () => {
    const rows = buildCheckIns(
      [
        arrival({ guestName: 'Returning', guestIsReturning: true }),
        arrival({ guestName: 'First timer' }),
      ],
      TODAY,
      ORDER,
    )
    expect(rows.map((row) => row.reservation.guestName)).toEqual(['First timer', 'Returning'])
  })

  it('marks the returning guest so the row can say so', () => {
    const [row] = buildCheckIns([arrival({ guestIsReturning: true })], TODAY, ORDER)
    expect(row.isReturning).toBe(true)
  })

  it('does not mark a returning guest on a channel booking', () => {
    // Airbnb and Booking guests arrive through the channel; "returning guest" is
    // a thing the operator tracks about their own private guests.
    const [row] = buildCheckIns(
      [arrival({ reservationType: 'airbnb', guestIsReturning: true })],
      TODAY,
      ORDER,
    )
    expect(row.tier).toBe(1)
  })

  it('leaves maintenance blocks out — nobody checks in', () => {
    const rows = buildCheckIns([arrival({ reservationType: 'maintenance' })], TODAY, ORDER)
    expect(rows).toHaveLength(0)
  })

  it('leaves archived reservations out', () => {
    expect(buildCheckIns([arrival({ isArchived: true })], TODAY, ORDER)).toHaveLength(0)
  })

  it('places a type the operator invented after the named ones', () => {
    const rows = buildCheckIns(
      [
        arrival({ reservationType: 'glamping' }),
        arrival({ reservationType: 'airbnb' }),
        arrival({ reservationType: 'private' }),
      ],
      TODAY,
      [...ORDER, 'glamping'],
    )
    expect(codes(rows)).toEqual(['airbnb', 'private', 'glamping'])
  })

  it('sorts guests inside one tier by name', () => {
    const rows = buildCheckIns(
      [
        arrival({ reservationType: 'airbnb', guestName: 'Zana' }),
        arrival({ reservationType: 'airbnb', guestName: 'Arben' }),
      ],
      TODAY,
      ORDER,
    )
    expect(rows.map((row) => row.reservation.guestName)).toEqual(['Arben', 'Zana'])
  })

  it('gives every row a label explaining its group', () => {
    const rows = buildCheckIns(
      [arrival({ reservationType: 'airbnb' }), arrival({ guestIsReturning: true })],
      TODAY,
      ORDER,
    )
    for (const row of rows) {
      expect(row.tierLabel.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the phone number when a guest has no name', () => {
    const [row] = buildCheckIns(
      [arrival({ guestName: '', guestPhone: '+38344111222' })],
      TODAY,
      ORDER,
    )
    expect(row.displayName).toBe('+38344111222')
  })
})
