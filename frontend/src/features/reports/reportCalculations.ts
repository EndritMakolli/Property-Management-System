import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { calculateNights, nextDateValue } from '../../utils/date'

export type PropertyReportStat = {
  averageNightlyPrice: number
  bookedNights: number
  freeNights: number
  id: string
  name: string
  basePriceEur: number
  bedrooms: number
  occupancy: number
  reservations: number
  turnover: number
}

export type StayBucket = {
  label: string
  min: number
  max: number
}

export type PropertyReportSortKey =
  | 'name'
  | 'reservations'
  | 'bookedNights'
  | 'freeNights'
  | 'occupancy'
  | 'averageNightlyPrice'
  | 'turnover'

export type PropertyReportSort = {
  direction: 'asc' | 'desc'
  key: PropertyReportSortKey
}

export const stayBuckets: StayBucket[] = [
  { label: '0-1 day', min: 0, max: 1 },
  { label: '2-6 days', min: 2, max: 6 },
  { label: '7-14 days', min: 7, max: 14 },
  { label: '15-27 days', min: 15, max: 27 },
  { label: '28+ days', min: 28, max: Infinity },
]

export const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function buildPropertyReportStats(
  properties: PropertyListing[],
  reservations: ReservationRecord[],
  year: number,
  month: number,
): PropertyReportStat[] {
  const useAllTime = month === 0
  const daysInMonth = useAllTime ? 365 : new Date(year, month, 0).getDate()
  const monthStart = useAllTime ? '1900-01-01' : `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = useAllTime
    ? '2999-12-31'
    : `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  return properties.map((property) => {
    const propertyReservations = reservations.filter((r) => r.propertyId === property.id)

    // A stay belongs to this month only if it has nights in it — or, for a
    // monthly rent period, money in it. Turnover and nights were already
    // prorated, but the *count* was taken straight from the property filter,
    // so ApartmentYearlyBreakdown (which passes every reservation, once per
    // month) showed the apartment's all-time total in all twelve rows and
    // summed it twelve times in the year total.
    const inMonth = useAllTime
      ? propertyReservations
      : propertyReservations.filter(
          (r) =>
            nightsInsideMonth(r, monthStart, monthEnd) > 0 || revenueInsideMonth(r, year, month) > 0,
        )

    const turnover = inMonth.reduce(
      (sum, r) =>
        sum + (useAllTime ? Number(r.totalPaid) || 0 : revenueInsideMonth(r, year, month)),
      0,
    )
    const bookedNights = inMonth.reduce(
      (sum, r) => sum + (useAllTime ? r.totalNights : nightsInsideMonth(r, monthStart, monthEnd)),
      0,
    )
    const freeNights = useAllTime ? 0 : Math.max(daysInMonth - bookedNights, 0)
    const occupancy = useAllTime ? 0 : Math.round((bookedNights / daysInMonth) * 100)

    return {
      averageNightlyPrice: bookedNights > 0 ? turnover / bookedNights : 0,
      basePriceEur: Number(property.basePriceEur || 0),
      bedrooms: property.bedrooms,
      bookedNights,
      freeNights,
      id: property.id,
      name: property.name,
      occupancy,
      reservations: inMonth.length,
      turnover,
    }
  })
}

export function buildPropertyYearStats(
  properties: PropertyListing[],
  reservations: ReservationRecord[],
  year: number,
): PropertyReportStat[] {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInYear = isLeap ? 366 : 365
  const yearStart = `${year}-01-01`
  const yearEndExcl = `${year + 1}-01-01`

  return properties.map((property) => {
    const propertyReservations = reservations.filter((r) => r.propertyId === property.id)
    const overlapping = propertyReservations.filter(
      (r) => r.checkIn < yearEndExcl && r.checkOut > yearStart,
    )

    const bookedNights = overlapping.reduce((sum, r) => {
      const start = r.checkIn > yearStart ? r.checkIn : yearStart
      const end = r.checkOut < yearEndExcl ? r.checkOut : yearEndExcl
      return sum + calculateNights(start, end)
    }, 0)

    const turnover = overlapping.reduce((sum, r) => {
      const start = r.checkIn > yearStart ? r.checkIn : yearStart
      const end = r.checkOut < yearEndExcl ? r.checkOut : yearEndExcl
      const nightsInYear = calculateNights(start, end)
      const totalNights = r.totalNights || calculateNights(r.checkIn, r.checkOut)
      if (nightsInYear <= 0 || totalNights <= 0) return sum
      return sum + (Number(r.totalPaid) / totalNights) * nightsInYear
    }, 0)

    const freeNights = Math.max(daysInYear - bookedNights, 0)
    const occupancy = Math.round((bookedNights / daysInYear) * 100)

    return {
      averageNightlyPrice: bookedNights > 0 ? turnover / bookedNights : 0,
      basePriceEur: Number(property.basePriceEur || 0),
      bedrooms: property.bedrooms,
      bookedNights,
      freeNights,
      id: property.id,
      name: property.name,
      occupancy,
      reservations: overlapping.length,
      turnover,
    }
  })
}

// Summarise a set of properties by bedroom type, e.g. "3 × 1-bedroom · 4 × 2-bedroom".
export function bedroomComposition(properties: { bedrooms: number }[]): string {
  if (properties.length === 0) return ''
  const counts = new Map<number, number>()
  for (const property of properties) {
    counts.set(property.bedrooms, (counts.get(property.bedrooms) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([beds, count]) => `${count} × ${beds === 0 ? 'studio' : `${beds}-bedroom`}`)
    .join(' · ')
}

// Combine a set of per-property stats into one aggregate stat for group compare.
export function aggregateGroupStats(
  stats: PropertyReportStat[],
  name: string,
): PropertyReportStat | null {
  if (stats.length === 0) return null
  const turnover = stats.reduce((sum, s) => sum + s.turnover, 0)
  const bookedNights = stats.reduce((sum, s) => sum + s.bookedNights, 0)
  const freeNights = stats.reduce((sum, s) => sum + s.freeNights, 0)
  const reservations = stats.reduce((sum, s) => sum + s.reservations, 0)
  const capacity = bookedNights + freeNights

  return {
    averageNightlyPrice: bookedNights > 0 ? turnover / bookedNights : 0,
    basePriceEur: 0,
    bedrooms: 0,
    bookedNights,
    freeNights,
    id: 'group',
    name,
    occupancy: capacity > 0 ? Math.round((bookedNights / capacity) * 100) : 0,
    reservations,
    turnover,
  }
}

export function sortPropertyStats(
  stats: PropertyReportStat[],
  sort: PropertyReportSort,
): PropertyReportStat[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...stats].sort((left, right) => {
    const leftValue = left[sort.key]
    const rightValue = right[sort.key]

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * direction
    }

    return String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) * direction
  })
}

export function nightsInsideMonth(reservation: ReservationRecord, monthStart: string, monthEnd: string) {
  const start = reservation.checkIn > monthStart ? reservation.checkIn : monthStart
  const end = reservation.checkOut <= monthEnd ? reservation.checkOut : nextDateValue(monthEnd)
  return calculateNights(start, end)
}

// What this month earned. Every reservation type, monthly rent included, is
// prorated across the nights it actually occupied.
//
// Monthly rent used to be the exception: the whole instalment was credited to
// the month its billing period *started* in. That is how the rent is collected,
// but it is not what a month earned — a tenancy running 23 Aug to 23 Sep put
// all 31 nights of rent into August, overstating it by the 22 nights that
// belong to September and leaving September holding occupied nights worth
// nothing. Collection still works per period; see buildDueRows, which is
// deliberately unchanged and guarded by paymentPeriods.test.ts.
export function revenueInsideMonth(reservation: ReservationRecord, year: number, month: number) {
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  const nightsInMonth = nightsInsideMonth(reservation, monthStart, monthEnd)
  const totalNights = reservation.totalNights || calculateNights(reservation.checkIn, reservation.checkOut)
  const totalPaid = Number(reservation.totalPaid)

  if (!Number.isFinite(totalPaid) || totalNights <= 0 || nightsInMonth <= 0) {
    return 0
  }

  return (totalPaid / totalNights) * nightsInMonth
}

export function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
