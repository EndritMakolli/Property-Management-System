import type { ReservationRecord } from '../../types/domain'

export type CalendarDay = {
  date: Date
  inMonth: boolean
  key: string
}

export function buildMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1)
  const start = new Date(firstDay)
  start.setDate(firstDay.getDate() - firstDay.getDay())

  return Array.from({ length: 42 }, (_, index): CalendarDay => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)

    return {
      date,
      inMonth: date.getMonth() === month - 1,
      key: toDateKey(date),
    }
  })
}

export function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function reservationTouchesDay(reservation: ReservationRecord, dayKey: string) {
  return reservation.checkIn <= dayKey && reservation.checkOut > dayKey
}

export function reservationStartsOnOrBeforeVisibleDay(
  reservation: ReservationRecord,
  dayKey: string,
  visibleKeys: string[],
) {
  const firstVisibleKey = visibleKeys[0]

  if (reservation.checkIn === dayKey) {
    return true
  }

  return dayKey === firstVisibleKey && reservation.checkIn < firstVisibleKey
}

export function nextDateKey(date: Date) {
  const nextDate = new Date(date)
  nextDate.setDate(date.getDate() + 1)
  return toDateKey(nextDate)
}

export function buildDateRange(startDate: Date, days: number) {
  return Array.from({ length: days }, (_, index): CalendarDay => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)

    return {
      date,
      inMonth: true,
      key: toDateKey(date),
    }
  })
}

export function reservationPlatformClass(reservation: ReservationRecord) {
  if (reservation.id.startsWith('recommendation-')) {
    return 'platform-recommendation'
  }

  const base = `platform-${reservation.reservationType}`

  if (
    reservation.reservationType === 'airbnb' &&
    Number(reservation.nightlyPrice) === 0 &&
    Number(reservation.totalPaid) === 0
  ) {
    return `${base} price-zero`
  }

  return base
}

export function isAirbnbZeroPrice(reservation: ReservationRecord): boolean {
  return (
    reservation.reservationType === 'airbnb' &&
    Number(reservation.nightlyPrice) === 0 &&
    Number(reservation.totalPaid) === 0
  )
}

export function reservationLabel(reservation: ReservationRecord) {
  if (reservation.id.startsWith('recommendation-')) {
    return reservation.guestName || 'Suggested stay'
  }

  if (reservation.reservationType === 'maintenance') {
    return reservation.notes ? `Maintenance – ${reservation.notes}` : 'Maintenance'
  }

  if (
    reservation.reservationType === 'airbnb' &&
    (reservation.guestName === 'Airbnb' || !reservation.guestName) &&
    Number(reservation.totalPaid) === 0
  ) {
    return 'Airbnb'
  }

  return `${reservation.guestName || reservation.guestPhone || 'Reserved'} - ${Number(
    reservation.totalPaid,
  ).toFixed(2)} EUR`
}
