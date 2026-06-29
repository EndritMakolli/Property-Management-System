import type { CleanStatusRecord, PropertyListing, ReservationRecord } from '../../types/domain'
import { calculateNights } from '../../utils/date'

// Cleaning priority tiers (lower = clean first):
//   1 — a guest arrives today (must be clean before arrival)
//   2 — free for a longer stretch (clean so it's ready to book)
//   3 — next guest is tomorrow (can be left for tomorrow)
export type CleaningTier = 1 | 2 | 3

export type CleaningTask = {
  property: PropertyListing
  needsCleaning: boolean
  cleanedToday: boolean
  tier: CleaningTier
  priorityLabel: string
  nextCheckIn: string | null
  freeNights: number | null
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

// An apartment that has had a guest check out since it was last cleaned is dirty
// again — the same rule the door-code panel uses for "needs change". This makes
// the status reset automatically each turnover: skip a cleaning today and the
// apartment still shows "needs cleaning" tomorrow.
export function buildCleaningTasks(
  properties: PropertyListing[],
  reservations: ReservationRecord[],
  cleanStatuses: CleanStatusRecord[],
  reportDate: string,
): CleaningTask[] {
  const tomorrow = addDays(reportDate, 1)

  const cleanedDateByProperty = new Map<string, string>()
  for (const status of cleanStatuses) {
    cleanedDateByProperty.set(status.propertyId, status.cleanedAt ? status.cleanedAt.slice(0, 10) : '')
  }

  const tasks: CleaningTask[] = []

  for (const property of properties) {
    if (!property.active) continue

    const propertyReservations = reservations.filter(
      (r) => r.propertyId === property.id && r.reservationType !== 'maintenance',
    )

    // Latest checkout on or before the report date, and the next check-in after it.
    let lastCheckout: string | null = null
    let nextCheckIn: string | null = null
    let checkInToday = false
    let occupiedTonight = false
    for (const r of propertyReservations) {
      if (r.checkOut <= reportDate && (lastCheckout === null || r.checkOut > lastCheckout)) {
        lastCheckout = r.checkOut
      }
      if (r.checkIn > reportDate && (nextCheckIn === null || r.checkIn < nextCheckIn)) {
        nextCheckIn = r.checkIn
      }
      if (r.checkIn === reportDate) checkInToday = true
      if (r.checkIn < reportDate && r.checkOut > reportDate) occupiedTonight = true
    }

    const cleanedDate = cleanedDateByProperty.get(property.id) ?? ''
    const cleanedToday = cleanedDate === reportDate

    const dirtyAfterCheckout =
      lastCheckout !== null && (cleanedDate === '' || cleanedDate < lastCheckout)
    // A first-ever arrival with no cleaning on record still needs a prep clean.
    const neverCleanedArrival = checkInToday && cleanedDate === ''

    const needsCleaning = !occupiedTonight && (dirtyAfterCheckout || neverCleanedArrival)

    if (!needsCleaning && !cleanedToday) continue

    const freeNights = nextCheckIn ? calculateNights(reportDate, nextCheckIn) : null

    let tier: CleaningTier
    let priorityLabel: string
    if (checkInToday) {
      tier = 1
      priorityLabel = 'Guest arrives today'
    } else if (nextCheckIn === tomorrow) {
      tier = 3
      priorityLabel = 'Next guest tomorrow — can wait'
    } else {
      tier = 2
      priorityLabel =
        freeNights === null
          ? 'Open — no upcoming booking'
          : `Open ${freeNights} night${freeNights !== 1 ? 's' : ''} — clean soon`
    }

    tasks.push({
      property,
      needsCleaning,
      cleanedToday,
      tier,
      priorityLabel,
      nextCheckIn,
      freeNights,
    })
  }

  // Pending tasks first (by tier, then most open dates, then name); done last.
  return tasks.sort((a, b) => {
    if (a.cleanedToday !== b.cleanedToday) return a.cleanedToday ? 1 : -1
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.tier === 2) {
      const aFree = a.freeNights ?? Infinity
      const bFree = b.freeNights ?? Infinity
      if (aFree !== bFree) return bFree - aFree
    }
    return a.property.name.localeCompare(b.property.name, undefined, { numeric: true })
  })
}
