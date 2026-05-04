import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { ReservationPopover } from './ReservationPopover'
import {
  buildDateRange,
  reservationLabel,
  reservationPlatformClass,
  reservationStartsOnOrBeforeVisibleDay,
  reservationTouchesDay,
} from './calendarUtils'
import type { CalendarSortBy } from './calendarFilters'

type CalendarOverviewTimelineProps = {
  bedroomFilter?: string
  bedroomOptions?: number[]
  emptyMessage?: string
  onDayClick?: (property: PropertyListing, dayKey: string) => void
  onBedroomFilterChange?: (value: string) => void
  onMoveRange: (days: number) => void
  onReservationClick?: (reservation: ReservationRecord) => void
  onSearchChange?: (value: string) => void
  onSelectProperty?: (propertyId: string) => void
  onSortChange?: (value: CalendarSortBy) => void
  properties: PropertyListing[]
  reservations: ReservationRecord[]
  searchValue?: string
  selectedDateKey?: string
  selectedPropertyId?: string
  sortBy?: CalendarSortBy
  startDate: Date
  status: 'loading' | 'ready' | 'error'
  subtitle?: string
  title?: string
  visibleDays?: number
}

const defaultVisibleDays = 21
const monthFormatter = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' })
const dayFormatter = new Intl.DateTimeFormat('en', { weekday: 'short' })

export function CalendarOverviewTimeline({
  bedroomFilter = 'any',
  bedroomOptions = [],
  emptyMessage = 'No listings to show.',
  onDayClick,
  onBedroomFilterChange,
  onMoveRange,
  onReservationClick,
  onSearchChange,
  onSelectProperty,
  onSortChange,
  properties,
  reservations,
  searchValue = '',
  selectedDateKey,
  selectedPropertyId,
  sortBy = 'number',
  startDate,
  status,
  subtitle,
  title,
  visibleDays = defaultVisibleDays,
}: CalendarOverviewTimelineProps) {
  const days = buildDateRange(startDate, visibleDays)
  const visibleKeys = days.map((day) => day.key)

  return (
    <section className="calendar-overview">
      <div className="calendar-overview-header">
        <div>
          <h2>{title || `${properties.length} listings`}</h2>
          <p>{subtitle || monthFormatter.format(startDate)}</p>
        </div>
        {(onSearchChange || onBedroomFilterChange || onSortChange) && (
          <div className="calendar-overview-filters">
            {onSearchChange && (
              <input
                aria-label="Search listings"
                placeholder="Search listings, e.g. 2,4"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            )}
            {onBedroomFilterChange && (
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
            )}
            {onSortChange && (
              <select
                aria-label="Sort apartments"
                value={sortBy}
                onChange={(event) => onSortChange(event.target.value as CalendarSortBy)}
              >
                <option value="number">Sort by number</option>
                <option value="name">Sort A–Z</option>
                <option value="bedrooms">Sort by bedrooms</option>
              </select>
            )}
          </div>
        )}
        <div className="calendar-range-actions">
          <button aria-label="Previous dates" onClick={() => onMoveRange(-7)}>
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => onMoveRange(0)}>Today</button>
          <button aria-label="Next dates" onClick={() => onMoveRange(7)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading calendar...</p>}
      {status === 'error' && <p className="form-error">Could not load overview reservations.</p>}
      {status === 'ready' && properties.length === 0 && <p className="listings-message">{emptyMessage}</p>}

      {properties.length > 0 && (
      <div className="timeline-scroll">
        <div className="timeline-grid" style={{ '--timeline-days': visibleDays } as CSSProperties}>
          <div className="timeline-corner">{properties.length} listings</div>
          {days.map((day) => (
            <div className="timeline-date-cell" key={day.key}>
              <strong>{dayFormatter.format(day.date)}</strong>
              <span>{day.date.getDate()}</span>
            </div>
          ))}

          {properties.map((property) => (
            <TimelinePropertyRow
              days={days}
              key={property.id}
              onDayClick={onDayClick}
              onReservationClick={onReservationClick}
              onSelectProperty={onSelectProperty}
              property={property}
              reservations={reservations.filter((reservation) => reservation.propertyId === property.id)}
              selectedDateKey={selectedDateKey}
              selectedPropertyId={selectedPropertyId}
              visibleKeys={visibleKeys}
            />
          ))}
        </div>
      </div>
      )}
    </section>
  )
}

type TimelinePropertyRowProps = {
  days: ReturnType<typeof buildDateRange>
  onDayClick?: (property: PropertyListing, dayKey: string) => void
  onReservationClick?: (reservation: ReservationRecord) => void
  onSelectProperty?: (propertyId: string) => void
  property: PropertyListing
  reservations: ReservationRecord[]
  selectedDateKey?: string
  selectedPropertyId?: string
  visibleKeys: string[]
}

function TimelinePropertyRow({
  days,
  onDayClick,
  onReservationClick,
  onSelectProperty,
  property,
  reservations,
  selectedDateKey,
  selectedPropertyId,
  visibleKeys,
}: TimelinePropertyRowProps) {
  const propertyContent = (
    <>
      {property.photoUrl ? <img alt="" src={property.photoUrl} /> : <span />}
      <strong>{property.name}</strong>
      <small>{property.bedrooms}</small>
    </>
  )

  return (
    <>
      {onSelectProperty ? (
        <button className="timeline-property-cell" onClick={() => onSelectProperty(property.id)}>
          {propertyContent}
        </button>
      ) : (
        <div className="timeline-property-cell">{propertyContent}</div>
      )}

      {days.map((day) => {
        const dayReservations = reservations.filter(
          (reservation) =>
            reservationTouchesDay(reservation, day.key) ||
            (reservation.checkOut === day.key && reservation.checkIn !== day.key),
        )

        return (
          <div
            className={`timeline-day-cell${
              selectedPropertyId === property.id && selectedDateKey === day.key ? ' selected' : ''
            }`}
            key={`${property.id}-${day.key}`}
            onClick={() => onDayClick?.(property, day.key)}
          >
            <span className="timeline-price">
              {property.basePriceEur ? `${Number(property.basePriceEur).toFixed(0)} EUR` : ''}
            </span>
            {dayReservations.map((reservation) => {
              const startsHere = reservationStartsOnOrBeforeVisibleDay(
                reservation,
                day.key,
                visibleKeys,
              )
              const isCheckoutTail = reservation.checkOut === day.key && reservation.checkIn !== day.key

              return (
                <div
                  className={`timeline-reservation-bar${startsHere ? ' starts' : ''}${
                    isCheckoutTail ? ' ends checkout-tail' : ''
                  } ${reservationPlatformClass(reservation)}`}
                  key={`${property.id}-${day.key}-${reservation.id}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onReservationClick?.(reservation)
                  }}
                  title={`${reservation.guestName || reservation.guestPhone} ${formatDisplayDate(reservation.checkIn)} - ${formatDisplayDate(reservation.checkOut)}`}
                >
                  {startsHere && (
                    <>
                      <strong>{reservationLabel(reservation)}</strong>
                      <ReservationPopover reservation={reservation} />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
