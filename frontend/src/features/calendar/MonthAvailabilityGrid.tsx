import { useMemo } from 'react'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { monthOptions } from '../reservations/monthOptions'
import type { CalendarSortBy } from './calendarFilters'
import { buildMonthDays, reservationTouchesDay, toDateKey } from './calendarUtils'

type MonthAvailabilityGridProps = {
  properties: PropertyListing[]
  reservations: ReservationRecord[]
  month: number
  year: number
  onMonthChange: (month: number) => void
  onYearChange: (year: number) => void
  onSelectProperty: (propertyId: string) => void
  searchValue: string
  onSearchChange: (value: string) => void
  bedroomFilter: string
  bedroomOptions: number[]
  onBedroomFilterChange: (value: string) => void
  sortBy: CalendarSortBy
  onSortChange: (value: CalendarSortBy) => void
  status: 'loading' | 'ready' | 'error'
}

const weekDayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function MonthAvailabilityGrid({
  properties,
  reservations,
  month,
  year,
  onMonthChange,
  onYearChange,
  onSelectProperty,
  searchValue,
  onSearchChange,
  bedroomFilter,
  bedroomOptions,
  onBedroomFilterChange,
  sortBy,
  onSortChange,
  status,
}: MonthAvailabilityGridProps) {
  const days = useMemo(() => buildMonthDays(year, month), [year, month])
  const todayKey = toDateKey(new Date())

  const byProperty = useMemo(() => {
    const map = new Map<string, ReservationRecord[]>()
    for (const reservation of reservations) {
      const list = map.get(reservation.propertyId)
      if (list) list.push(reservation)
      else map.set(reservation.propertyId, [reservation])
    }
    return map
  }, [reservations])

  return (
    <section className="month-grid-shell">
      <div className="month-grid-toolbar">
        <div>
          <p className="eyebrow">Availability grid</p>
          <h2>Which apartments are free</h2>
        </div>
        <div className="month-grid-controls">
          <input
            aria-label="Search apartments"
            placeholder="Search, e.g. 2,4"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <select
            aria-label="Filter by bedrooms"
            value={bedroomFilter}
            onChange={(event) => onBedroomFilterChange(event.target.value)}
          >
            <option value="any">Any bedrooms</option>
            {bedroomOptions.map((option) => (
              <option key={option} value={option}>
                {option} {option === 1 ? 'bedroom' : 'bedrooms'}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort apartments"
            value={sortBy}
            onChange={(event) => onSortChange(event.target.value as CalendarSortBy)}
          >
            <option value="number">Sort by number</option>
            <option value="name">Sort A–Z</option>
            <option value="bedrooms">Sort by bedrooms</option>
          </select>
          <select value={month} onChange={(event) => onMonthChange(Number(event.target.value))}>
            {monthOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={year} onChange={(event) => onYearChange(Number(event.target.value))}>
            {[year - 1, year, year + 1, year + 2].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <div className="month-grid-legend">
            <span><i className="legend-free" /> Free</span>
            <span><i className="legend-booked" /> Booked</span>
          </div>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading availability…</p>}
      {status === 'error' && <p className="form-error">Could not load availability.</p>}

      {status === 'ready' && properties.length === 0 && (
        <p className="listings-message">No apartments match the current filters.</p>
      )}

      <div className="month-grid">
        {properties.map((property) => {
          const propertyReservations = byProperty.get(property.id) ?? []
          const reservationForDay = (dayKey: string) =>
            propertyReservations.find((reservation) => reservationTouchesDay(reservation, dayKey))
          const freeNights = days.filter(
            (day) => day.inMonth && day.key >= todayKey && !reservationForDay(day.key),
          ).length

          return (
            <article className="month-grid-card" key={property.id}>
              <header className="month-grid-card-head">
                <button
                  type="button"
                  className="month-grid-card-name"
                  title={`Open ${property.name} calendar`}
                  onClick={() => onSelectProperty(property.id)}
                >
                  {property.name}
                </button>
                <span>{freeNights} free</span>
              </header>

              <div className="mini-cal-weekdays">
                {weekDayLetters.map((letter, index) => (
                  <span key={index}>{letter}</span>
                ))}
              </div>

              <div className="mini-cal">
                {(() => {
                  const cells = days.map((day) => {
                    const booked = reservationForDay(day.key)
                    const isPast = day.inMonth && day.key < todayKey
                    const tone = !day.inMonth ? 'muted' : isPast ? 'past' : booked ? 'booked' : 'free'
                    return { day, booked, tone }
                  })

                  return cells.map(({ day, booked, tone }, index) => {
                    const colored = tone === 'free' || tone === 'booked'
                    const col = index % 7
                    const prev = col > 0 ? cells[index - 1] : null
                    const next = col < 6 ? cells[index + 1] : null
                    const prevSame = colored && !!prev && prev.tone === tone
                    const nextSame = colored && !!next && next.tone === tone
                    const prevColored = !!prev && (prev.tone === 'free' || prev.tone === 'booked')
                    const className = [
                      'mini-cal-day',
                      tone,
                      colored && !prevSame ? 'run-start' : '',
                      colored && !nextSame ? 'run-end' : '',
                      colored && !prevSame && prevColored ? 'gap-before' : '',
                    ].filter(Boolean).join(' ')

                    return (
                      <div
                        key={day.key}
                        className={className}
                        title={
                          booked
                            ? `${booked.guestName || booked.guestPhone || 'Booked'} · ${booked.checkIn} → ${booked.checkOut}`
                            : undefined
                        }
                      >
                        {day.date.getDate()}
                      </div>
                    )
                  })
                })()}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
