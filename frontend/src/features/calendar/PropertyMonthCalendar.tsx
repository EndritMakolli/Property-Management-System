import { CalendarDays } from 'lucide-react'
import { useRef, type WheelEvent } from 'react'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { monthOptions } from '../reservations/monthOptions'
import { ReservationPopover } from './ReservationPopover'
import {
  buildMonthDays,
  reservationLabel,
  reservationPlatformClass,
  reservationStartsOnOrBeforeVisibleDay,
  reservationTouchesDay,
} from './calendarUtils'

type PropertyMonthCalendarProps = {
  month: number
  onMonthChange: (month: number) => void
  onYearChange: (year: number) => void
  onBackToOverview: () => void
  onDayClick?: (property: PropertyListing, dayKey: string) => void
  onReservationClick?: (reservation: ReservationRecord) => void
  property: PropertyListing | undefined
  reservations: ReservationRecord[]
  selectedDateKey?: string
  selectedPropertyId?: string
  status: 'loading' | 'ready' | 'error'
  year: number
}

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function PropertyMonthCalendar({
  month,
  onBackToOverview,
  onDayClick,
  onMonthChange,
  onReservationClick,
  onYearChange,
  property,
  reservations,
  selectedDateKey,
  selectedPropertyId,
  status,
  year,
}: PropertyMonthCalendarProps) {
  const wheelLockRef = useRef(false)
  const days = buildMonthDays(year, month)
  const visibleKeys = days.map((day) => day.key)
  const monthName = monthOptions.find((item) => item.value === month)?.label || ''

  function moveMonth(step: number) {
    const nextMonth = month + step

    if (nextMonth < 1) {
      onMonthChange(12)
      onYearChange(year - 1)
      return
    }

    if (nextMonth > 12) {
      onMonthChange(1)
      onYearChange(year + 1)
      return
    }

    onMonthChange(nextMonth)
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    if (Math.abs(event.deltaY) < 40 || wheelLockRef.current) {
      return
    }

    wheelLockRef.current = true
    moveMonth(event.deltaY > 0 ? 1 : -1)
    window.setTimeout(() => {
      wheelLockRef.current = false
    }, 450)
  }

  return (
    <section className="property-calendar-view" onWheel={handleWheel}>
      <div className="property-calendar-header">
        <div>
          <h2>{monthName}</h2>
          {property && <p>{property.name}</p>}
        </div>
        <div className="property-calendar-actions">
          <button onClick={onBackToOverview}>All listings</button>
          <button>Price tips</button>
          <select value={month} onChange={(event) => onMonthChange(Number(event.target.value))}>
            {monthOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select value={year} onChange={(event) => onYearChange(Number(event.target.value))}>
            {[year - 1, year, year + 1, year + 2].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button className="round-button" aria-label="Calendar options">
            <CalendarDays size={17} />
          </button>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading calendar...</p>}
      {status === 'error' && <p className="form-error">Could not load calendar reservations.</p>}

      <div className="property-calendar-weekdays">
        {weekDays.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="property-calendar-grid">
        {days.map((day) => {
          const dayReservations = reservations.filter(
            (reservation) =>
              reservationTouchesDay(reservation, day.key) ||
              (reservation.checkOut === day.key && reservation.checkIn !== day.key),
          )

          return (
            <div
              className={`property-calendar-cell${day.inMonth ? '' : ' muted'}${
                property && selectedPropertyId === property.id && selectedDateKey === day.key ? ' selected' : ''
              }`}
              key={day.key}
              onClick={() => property && onDayClick?.(property, day.key)}
            >
              <div className="property-calendar-date">
                <span>{day.date.getDate()}</span>
                <small>{property ? `${Number(property.basePriceEur || 0).toFixed(0)} EUR` : ''}</small>
              </div>
              <div className="property-calendar-bookings">
                {dayReservations.map((reservation) => {
                  const startsHere = reservationStartsOnOrBeforeVisibleDay(
                    reservation,
                    day.key,
                    visibleKeys,
                  )
                  const isCheckoutTail = reservation.checkOut === day.key && reservation.checkIn !== day.key

                  return (
                    <div
                      className={`calendar-reservation-pill${startsHere ? ' starts' : ''}${
                        isCheckoutTail ? ' ends checkout-tail' : ''
                      } ${reservationPlatformClass(reservation)}`}
                      key={`${day.key}-${reservation.id}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onReservationClick?.(reservation)
                      }}
                      title={`${reservation.guestName || reservation.guestPhone} ${formatDisplayDate(reservation.checkIn)} - ${formatDisplayDate(reservation.checkOut)}`}
                    >
                      {startsHere ? (
                        <>
                          <strong>{reservationLabel(reservation)}</strong>
                          <ReservationPopover reservation={reservation} />
                        </>
                      ) : (
                        <span />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
