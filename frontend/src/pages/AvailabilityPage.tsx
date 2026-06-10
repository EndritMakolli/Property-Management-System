import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchProperties, fetchReservations } from '../api/pmsApi'
import { DateInput } from '../components/shared/DateInput'
import { CalendarOverviewTimeline } from '../features/calendar/CalendarOverviewTimeline'
import { useCalendarReservationEditor } from '../features/calendar/useCalendarReservationEditor'
import { NewReservationModal } from '../features/reservations/NewReservationModal'
import type { PropertyListing, ReservationRecord } from '../types/domain'
import { calculateNights, formatDisplayDate, parseDateValue, toDateInputValue } from '../utils/date'

const availabilitySearchStorageKey = 'pms.availability.search'

type AvailabilitySearchState = {
  bedrooms: string
  checkIn: string
  checkOut: string
}

type StaySegment = {
  checkIn: string
  checkOut: string
  nights: number
  property: PropertyListing
}

export function AvailabilityPage() {
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  const defaultSearch = {
    bedrooms: 'any',
    checkIn: toDateInputValue(today),
    checkOut: toDateInputValue(tomorrow),
  }
  const storedSearch = readStoredAvailabilitySearch(defaultSearch)

  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [checkIn, setCheckIn] = useState(storedSearch.checkIn)
  const [checkOut, setCheckOut] = useState(storedSearch.checkOut)
  const [bedrooms, setBedrooms] = useState(storedSearch.bedrooms)
  const [timelineStartDate, setTimelineStartDate] = useState(() => parseDate(storedSearch.checkIn))

  const {
    closeModal,
    handleCalendarDayClick,
    handleReservationClick,
    modalState,
    selectedDateKey,
    selectedPropertyId: selectedRangePropertyId,
  } = useCalendarReservationEditor()

  const [bookModal, setBookModal] = useState<{
    propertyId: string
    checkIn: string
    checkOut: string
    nightlyPrice: string
  } | null>(null)

  useEffect(() => {
    let ignore = false

    async function loadAvailabilityData() {
      try {
        setStatus('loading')
        const [propertyRows, reservationRows] = await Promise.all([
          fetchProperties(),
          fetchReservations(),
        ])

        if (!ignore) {
          setProperties(propertyRows)
          setReservations(reservationRows)
          setStatus('ready')
        }
      } catch {
        if (!ignore) {
          setStatus('error')
        }
      }
    }

    loadAvailabilityData()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(
      availabilitySearchStorageKey,
      JSON.stringify({ bedrooms, checkIn, checkOut }),
    )
  }, [bedrooms, checkIn, checkOut])

  const bedroomOptions = useMemo(
    () => [...new Set(properties.map((property) => property.bedrooms))].sort((a, b) => a - b),
    [properties],
  )

  const availableProperties = useMemo(() => {
    if (!checkIn || !checkOut || calculateNights(checkIn, checkOut) < 1) {
      return []
    }

    return properties.filter((property) => {
      const bedroomMatch = bedrooms === 'any' || property.bedrooms === Number(bedrooms)
      const hasOverlap = reservations.some(
        (reservation) =>
          reservation.propertyId === property.id && reservationOverlapsStay(reservation, checkIn, checkOut),
      )

      return bedroomMatch && !hasOverlap
    })
  }, [bedrooms, checkIn, checkOut, properties, reservations])

  const nights = calculateNights(checkIn, checkOut)
  const recommendation = useMemo(() => {
    if (!checkIn || !checkOut || nights < 1 || availableProperties.length > 0) {
      return []
    }

    return buildSplitStayRecommendation({
      bedrooms,
      checkIn,
      checkOut,
      properties,
      reservations,
    })
  }, [availableProperties.length, bedrooms, checkIn, checkOut, nights, properties, reservations])
  const recommendedProperties = useMemo(
    () => uniqueProperties(recommendation.map((segment) => segment.property)),
    [recommendation],
  )
  const calendarProperties = availableProperties.length > 0 ? availableProperties : recommendedProperties
  const recommendationReservations = useMemo(
    () => buildRecommendationReservations(recommendation),
    [recommendation],
  )
  const calendarReservations = useMemo(
    () => [...reservations, ...recommendationReservations],
    [recommendationReservations, reservations],
  )

  useEffect(() => {
    if (checkIn) {
      setTimelineStartDate(parseDate(checkIn))
    }
  }, [checkIn])

  function moveTimeline(days: number) {
    if (days === 0) {
      setTimelineStartDate(parseDate(checkIn))
      return
    }

    setTimelineStartDate((current) => {
      const nextDate = new Date(current)
      nextDate.setDate(current.getDate() + days)
      return nextDate
    })
  }

  function openBookModal(property: PropertyListing) {
    setBookModal({
      propertyId: property.id,
      checkIn,
      checkOut,
      nightlyPrice: '0.00',
    })
  }

  function closeAllModals() {
    closeModal()
    setBookModal(null)
  }

  async function reloadData() {
    const [propertyRows, reservationRows] = await Promise.all([
      fetchProperties(),
      fetchReservations(),
    ])
    setProperties(propertyRows)
    setReservations(reservationRows)
  }

  const activeModalValues = bookModal ?? modalState?.initialValues
  const activeModalMode = bookModal ? 'create' : (modalState?.mode ?? 'create')
  const activeModalReservation = bookModal ? null : modalState?.reservation

  return (
    <section className="availability-page">
      <div className="availability-search-band">
        <div>
          <p className="eyebrow">Availability</p>
          <h2>Find free apartments</h2>
        </div>
        <div className="availability-search-form">
          <label>
            Check-in
            <DateInput ariaLabel="Check-in" value={checkIn} onChange={setCheckIn} />
          </label>
          <label>
            Check-out
            <DateInput ariaLabel="Check-out" min={checkIn} value={checkOut} onChange={setCheckOut} />
          </label>
          <label>
            Bedrooms
            <select value={bedrooms} onChange={(event) => setBedrooms(event.target.value)}>
              <option value="any">Any</option>
              {bedroomOptions.map((option) => (
                <option key={option} value={option}>
                  {option} {option === 1 ? 'bedroom' : 'bedrooms'}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="button" onClick={() => setTimelineStartDate(parseDate(checkIn))}>
            <Search size={17} />
            Search
          </button>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading availability...</p>}
      {status === 'error' && <p className="form-error">Could not load availability data.</p>}
      {nights < 1 && <p className="form-error">Check-out must be after check-in.</p>}

      {status === 'ready' && nights > 0 && (
        <>
          <div className="availability-summary">
            <strong>{availableProperties.length}</strong>
            <span>
              available for {nights} {nights === 1 ? 'night' : 'nights'}
            </span>
          </div>
          <div className="availability-results">
            {availableProperties.map((property) => (
              <article className="availability-card" key={property.id}>
                {property.photoUrl ? <img alt="" src={property.photoUrl} /> : <span />}
                <div>
                  <strong>{property.name}</strong>
                  <p>{property.apartmentType}</p>
                  <small>{Number(property.basePriceEur || 0).toFixed(0)} EUR per night</small>
                </div>
                <button
                  className="primary-button availability-book-btn"
                  type="button"
                  onClick={() => openBookModal(property)}
                >
                  Book
                </button>
              </article>
            ))}
          </div>
          {availableProperties.length === 0 && recommendation.length > 0 && (
            <section className="availability-recommendations">
              <div>
                <p className="eyebrow">Recommendation</p>
                <h3>Split the stay between apartments</h3>
              </div>
              <div className="recommendation-route">
                {recommendation.map((segment, index) => (
                  <article className="recommendation-segment" key={`${segment.property.id}-${segment.checkIn}`}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{segment.property.name}</strong>
                      <p>
                        {formatDisplayDate(segment.checkIn)} to {formatDisplayDate(segment.checkOut)} - {segment.nights}{' '}
                        {segment.nights === 1 ? 'night' : 'nights'}
                      </p>
                      <small>{segment.property.apartmentType}</small>
                    </div>
                    <button
                      className="primary-button availability-book-btn"
                      type="button"
                      onClick={() => setBookModal({
                        propertyId: segment.property.id,
                        checkIn: segment.checkIn,
                        checkOut: segment.checkOut,
                        nightlyPrice: '0.00',
                      })}
                    >
                      Book segment
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}
          {availableProperties.length === 0 && recommendation.length === 0 && (
            <p className="listings-message">
              No full-stay apartment or split-stay recommendation is available for these dates.
            </p>
          )}
          <CalendarOverviewTimeline
            emptyMessage="Choose dates to see matching apartments on the calendar."
            onDayClick={handleCalendarDayClick}
            onMoveRange={moveTimeline}
            onReservationClick={handleReservationClick}
            properties={calendarProperties}
            reservations={calendarReservations}
            selectedDateKey={selectedDateKey}
            selectedPropertyId={selectedRangePropertyId}
            startDate={timelineStartDate}
            status={status}
            subtitle={`${formatDisplayDate(checkIn)} to ${formatDisplayDate(checkOut)}`}
            title={
              availableProperties.length > 0
                ? `${availableProperties.length} full-stay options`
                : `${recommendedProperties.length} recommendation apartments`
            }
            visibleDays={Math.max(nights, 7)}
          />
        </>
      )}

      {(modalState || bookModal) && (
        <NewReservationModal
          initialValues={activeModalValues}
          mode={activeModalMode}
          onClose={closeAllModals}
          onSaved={reloadData}
          open
          reservation={activeModalReservation}
        />
      )}
    </section>
  )
}

function buildSplitStayRecommendation({
  bedrooms,
  checkIn,
  checkOut,
  properties,
  reservations,
}: {
  bedrooms: string
  checkIn: string
  checkOut: string
  properties: PropertyListing[]
  reservations: ReservationRecord[]
}) {
  const minimumBedrooms = bedrooms === 'any' ? 0 : Number(bedrooms)
  const candidates = properties
    .filter((property) => property.bedrooms >= minimumBedrooms)
    .sort((first, second) => first.bedrooms - second.bedrooms || first.name.localeCompare(second.name))
  const segments: StaySegment[] = []
  let cursor = checkIn
  const maxSegments = calculateNights(checkIn, checkOut)

  while (cursor < checkOut && segments.length < maxSegments) {
    const best = candidates
      .map((property) => ({
        property,
        checkOut: longestFreeCheckout(property.id, cursor, checkOut, reservations),
      }))
      .filter((option) => option.checkOut > cursor)
      .sort((first, second) => {
        const nightDifference =
          calculateNights(cursor, second.checkOut) - calculateNights(cursor, first.checkOut)
        return nightDifference || first.property.bedrooms - second.property.bedrooms
      })[0]

    if (!best) {
      return []
    }

    if (best.checkOut <= cursor) {
      return []
    }

    segments.push({
      checkIn: cursor,
      checkOut: best.checkOut,
      nights: calculateNights(cursor, best.checkOut),
      property: best.property,
    })
    cursor = best.checkOut
  }

  if (cursor < checkOut || segments.length < 2) {
    return []
  }

  return segments
}

function longestFreeCheckout(
  propertyId: string,
  checkIn: string,
  requestedCheckOut: string,
  reservations: ReservationRecord[],
) {
  let cursor = checkIn

  while (cursor < requestedCheckOut) {
    const next = nextDateKey(cursor)
    const occupied = reservations.some(
      (reservation) =>
        reservation.propertyId === propertyId &&
        reservationOverlapsStay(reservation, cursor, next),
    )

    if (occupied) {
      break
    }

    if (next <= cursor) {
      break
    }

    cursor = next
  }

  return cursor
}

function buildRecommendationReservations(segments: StaySegment[]): ReservationRecord[] {
  return segments.map((segment, index) => ({
    id: `recommendation-${index}-${segment.property.id}-${segment.checkIn}`,
    guestName: 'Recommended stay',
    guestPhone: '',
    paymentDue: '',
    paid: false,
    notes: '',
    reservationType: 'private',
    propertyId: segment.property.id,
    apartment: segment.property.name,
    apartmentType: segment.property.apartmentType,
    checkIn: segment.checkIn,
    checkOut: segment.checkOut,
    totalNights: segment.nights,
    nightlyPrice: '0.00',
    totalPaid: '0',
    isArchived: false,
    archivedAt: '',
  }))
}

function uniqueProperties(properties: PropertyListing[]) {
  return properties.filter(
    (property, index, rows) => rows.findIndex((item) => item.id === property.id) === index,
  )
}

function parseDate(value: string) {
  return parseDateValue(value)
}

function nextDateKey(value: string) {
  const date = parseDate(value)
  date.setDate(date.getDate() + 1)
  return toDateInputValue(date)
}

function reservationOverlapsStay(reservation: ReservationRecord, checkIn: string, checkOut: string) {
  return reservation.checkIn < checkOut && reservation.checkOut > checkIn
}

function readStoredAvailabilitySearch(defaultSearch: AvailabilitySearchState) {
  const stored = window.localStorage.getItem(availabilitySearchStorageKey)

  if (!stored) {
    return defaultSearch
  }

  try {
    return { ...defaultSearch, ...JSON.parse(stored) } as AvailabilitySearchState
  } catch {
    return defaultSearch
  }
}
