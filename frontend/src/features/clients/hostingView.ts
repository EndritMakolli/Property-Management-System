// Who is in the building right now, and who is holding a garage card.
//
// The in-house window is the whole point and it is easy to get wrong: a stay
// counts from the day the guest arrives until the day they leave, and *not* on
// the day they leave. Someone checking out this morning is not in the building
// this afternoon. Same rule as the server's `?hosting=1`, and the same rule
// `checkedInPaymentSplit` already uses on the reports page.

import type { ReservationRecord } from '../../types/domain'

export type GarageFilter = 'all' | 'without' | 'with'
export type HostingSortKey = 'apartment' | 'guest' | 'checkOut' | 'nights'
export type SortDirection = 'asc' | 'desc'

export const GARAGE_FILTERS: { value: GarageFilter; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'without', label: 'Without a garage card' },
  { value: 'with', label: 'With a garage card' },
]

export const HOSTING_SORT_OPTIONS: { value: HostingSortKey; label: string }[] = [
  { value: 'apartment', label: 'Apartment' },
  { value: 'guest', label: 'Guest' },
  { value: 'checkOut', label: 'Leaves' },
  { value: 'nights', label: 'Nights' },
]

export function currentlyHosting(
  reservations: ReservationRecord[],
  today: string,
): ReservationRecord[] {
  return reservations.filter(
    (r) =>
      r.reservationType !== 'maintenance' &&
      !r.isArchived &&
      r.checkIn <= today &&
      r.checkOut > today,
  )
}

export type GarageCounts = { total: number; withCard: number; withoutCard: number }

export function garageCounts(stays: ReservationRecord[]): GarageCounts {
  const withCard = stays.filter((stay) => stay.garageCard === true).length
  return { total: stays.length, withCard, withoutCard: stays.length - withCard }
}

export function applyGarageFilter(
  stays: ReservationRecord[],
  filter: GarageFilter,
): ReservationRecord[] {
  if (filter === 'with') return stays.filter((stay) => stay.garageCard === true)
  if (filter === 'without') return stays.filter((stay) => stay.garageCard !== true)
  return stays
}

function sortValue(stay: ReservationRecord, key: HostingSortKey): string | number {
  switch (key) {
    case 'apartment':
      return stay.apartment
    case 'guest':
      return stay.guestName || stay.guestPhone || ''
    case 'checkOut':
      return stay.checkOut
    case 'nights':
      return stay.totalNights
  }
}

export function sortHosting(
  stays: ReservationRecord[],
  key: HostingSortKey,
  direction: SortDirection,
): ReservationRecord[] {
  const factor = direction === 'asc' ? 1 : -1
  // A sorted copy: the caller's array is left alone.
  return [...stays].sort((left, right) => {
    const a = sortValue(left, key)
    const b = sortValue(right, key)
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor
    // `numeric` so "Apartment #2" comes before "Apartment #10" — a plain string
    // compare reads the "1" of "#10" first and puts it on top.
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * factor
  })
}
