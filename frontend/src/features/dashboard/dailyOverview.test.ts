import { describe, expect, it } from 'vitest'
import { buildArrivalMessage, buildDepartureMessage, splitDay } from './dailyOverview'
import type { DoorCodeRecord, ReservationRecord } from '../../types/domain'

const stay = (over: Partial<ReservationRecord> = {}): ReservationRecord =>
  ({
    id: 'r1',
    propertyId: 'p1',
    apartment: 'Apartment #2',
    guestName: 'Ana Berisha',
    guestPhone: '+383 44 111 222',
    guestEmail: '',
    checkIn: '2026-07-15',
    checkOut: '2026-07-18',
    nights: 3,
    guestsCount: 2,
    platform: 'airbnb',
    status: 'confirmed',
    totalPriceEur: '240.00',
    ...over,
  }) as ReservationRecord

const code = (over: Partial<DoorCodeRecord> = {}): DoorCodeRecord =>
  ({
    id: 'c1',
    propertyId: 'p1',
    apartmentNumber: 'Apartment #2',
    floor: 'third floor',
    wifiName: 'AirStay - 2',
    wifiPassword: '12345677-2',
    newCode: '3147*',
    oldCode: '',
    dateChanged: '',
    changedBy: '',
    notes: '',
    lastCheckout: '',
    needsChange: false,
    ...over,
  }) as DoorCodeRecord

const day = '2026-07-15'

describe('splitDay', () => {
  it('puts a stay starting today with the arrivals', () => {
    const { arrivals, departures } = splitDay([stay()], day)
    expect(arrivals.map((r) => r.id)).toEqual(['r1'])
    expect(departures).toEqual([])
  })

  it('puts a stay ending today with the departures', () => {
    const row = stay({ checkIn: '2026-07-12', checkOut: day })
    const { arrivals, departures } = splitDay([row], day)
    expect(departures.map((r) => r.id)).toEqual(['r1'])
    expect(arrivals).toEqual([])
  })

  it('drops a guest who is only passing through the middle of a stay', () => {
    // Nobody greets them and nobody cleans for them, so they are not on a list
    // that exists to say what has to be done today.
    const row = stay({ checkIn: '2026-07-12', checkOut: '2026-07-20' })
    const { arrivals, departures } = splitDay([row], day)
    expect(arrivals).toEqual([])
    expect(departures).toEqual([])
  })

  it('lists a same-day turnaround as both a departure and an arrival', () => {
    const out = stay({ id: 'out', checkIn: '2026-07-12', checkOut: day })
    const into = stay({ id: 'in', checkIn: day, checkOut: '2026-07-19' })
    const { arrivals, departures } = splitDay([out, into], day)
    expect(departures.map((r) => r.id)).toEqual(['out'])
    expect(arrivals.map((r) => r.id)).toEqual(['in'])
  })

  it('counts a one-night stay arriving and leaving around the day correctly', () => {
    const { arrivals, departures } = splitDay([stay({ checkIn: day, checkOut: '2026-07-16' })], day)
    expect(arrivals).toHaveLength(1)
    expect(departures).toHaveLength(0)
  })

  it('orders each group by apartment so the list matches the walk round', () => {
    const rows = [
      stay({ id: 'b', apartment: 'Apartment #9' }),
      stay({ id: 'a', apartment: 'Apartment #1' }),
    ]
    expect(splitDay(rows, day).arrivals.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('is empty on a quiet day', () => {
    expect(splitDay([], day)).toEqual({ arrivals: [], departures: [] })
  })
})

describe('buildArrivalMessage', () => {
  it('greets the guest and states the apartment and dates', () => {
    const text = buildArrivalMessage(stay())
    expect(text).toContain('Hi Ana')
    expect(text).toContain('Apartment #2')
    expect(text).toContain('15-Jul-2026')
    expect(text).toContain('18-Jul-2026')
  })

  it('carries the arrival details when the apartment has them on file', () => {
    // The message staff actually send: dates, then the door code and wifi.
    const text = buildArrivalMessage(stay(), code())
    expect(text).toContain('Door Code 3147*')
    expect(text).toContain('Wi-Fi Name: AirStay - 2')
    expect(text).toContain('Wi-Fi Password: 12345677-2')
    expect(text).toContain('third floor')
  })

  it('uses exactly the codes page wording, not a second version of it', () => {
    const text = buildArrivalMessage(stay(), code())
    expect(text).toContain(
      'Apartment #2, third floor\nDoor Code 3147*\nWi-Fi Name: AirStay - 2\nWi-Fi Password: 12345677-2',
    )
  })

  it('leaves out a detail the apartment has not recorded', () => {
    // A line reading "Wi-Fi Password: —" is worse than no line in a message
    // somebody actually receives.
    const text = buildArrivalMessage(stay(), code({ wifiPassword: '' }))
    expect(text).toContain('Door Code 3147*')
    expect(text).not.toContain('Wi-Fi Password')
  })

  it('still reads as a message when the apartment has nothing on file', () => {
    const text = buildArrivalMessage(stay(), code({ newCode: '', wifiName: '', wifiPassword: '', floor: '' }))
    expect(text).toContain('Hi Ana')
    expect(text).not.toContain('Door Code')
  })

  it('works with no codes passed at all', () => {
    const text = buildArrivalMessage(stay())
    expect(text).toContain('Hi Ana')
    expect(text).not.toContain('Door Code')
  })

  it('uses the first name only, the way a message would', () => {
    expect(buildArrivalMessage(stay({ guestName: 'Ana Berisha' }))).toContain('Hi Ana')
  })

  it('copes with a guest recorded under one name', () => {
    expect(buildArrivalMessage(stay({ guestName: 'Ana' }))).toContain('Hi Ana')
  })

  it('stays polite when there is no name at all', () => {
    const text = buildArrivalMessage(stay({ guestName: '' }))
    expect(text).not.toContain('Hi ,')
    expect(text).toContain('Apartment #2')
  })
})

describe('buildDepartureMessage', () => {
  it('names the guest and the day they leave', () => {
    const text = buildDepartureMessage(stay({ checkIn: '2026-07-12', checkOut: day }))
    expect(text).toContain('Ana')
    expect(text).toContain('Apartment #2')
  })

  it('carries no access details — they are leaving', () => {
    const text = buildDepartureMessage(stay())
    expect(text).not.toContain('Door Code')
    expect(text).not.toContain('Wi-Fi')
  })

  it('differs from the arrival message', () => {
    const row = stay()
    expect(buildDepartureMessage(row)).not.toBe(buildArrivalMessage(row))
  })
})
