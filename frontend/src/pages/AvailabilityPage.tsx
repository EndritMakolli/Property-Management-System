import { StayDateRangeField } from '../components/shared/StayDateRangeField'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchProperties, fetchQuotes, fetchReservations } from '../api/pmsApi'
import { CalendarOverviewTimeline } from '../features/calendar/CalendarOverviewTimeline'
import { useCalendarReservationEditor } from '../features/calendar/useCalendarReservationEditor'
import { GuestReplyPanel } from '../features/availability/GuestReplyPanel'
import { findCombinations } from '../features/availability/groupCombinations'
import { NewReservationModal } from '../features/reservations/NewReservationModal'
import type { PropertyListing, QuoteRecord, ReservationRecord } from '../types/domain'
import { calculateNights, formatDisplayDate, parseDateValue, toDateInputValue } from '../utils/date'

const availabilitySearchStorageKey = 'pms.availability.search'

type AvailabilitySearchState = {
  bedrooms: string
  checkIn: string
  checkOut: string
  /** Party size, as typed. '' means nobody asked, so no group search runs. */
  guests: string
}

type StaySegment = {
  checkIn: string
  checkOut: string
  nights: number
  property: PropertyListing
}

// A split-stay plan is pinned to the search that produced it. Re-deriving it
// from live reservations after booking one segment would collapse the plan
// (the remaining window is a single segment, which the builder rejects), so
// the plan is kept and each segment's status is evaluated against live data.
type PinnedPlan = {
  searchKey: string
  segments: StaySegment[]
}

type SegmentStatus = 'available' | 'booked' | 'unavailable'

// What each apartment CAN do when nothing matches the full stay: either the
// maximum stay starting on the requested check-in, or its next free window.
type ApartmentInsight = {
  property: PropertyListing
  freeOnCheckIn: boolean
  windowStart: string
  windowEnd: string | null // null — no upcoming booking limits the stay
  nights: number | null // null when the window is open-ended
}

const INSIGHT_HORIZON_DAYS = 180

export function AvailabilityPage() {
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  const defaultSearch = {
    bedrooms: 'any',
    checkIn: toDateInputValue(today),
    checkOut: toDateInputValue(tomorrow),
    guests: '',
  }
  const storedSearch = readStoredAvailabilitySearch(defaultSearch)

  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [checkIn, setCheckIn] = useState(storedSearch.checkIn)
  const [checkOut, setCheckOut] = useState(storedSearch.checkOut)
  const [bedrooms, setBedrooms] = useState(storedSearch.bedrooms)
  const [guests, setGuests] = useState(storedSearch.guests ?? '')
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

  // Rule-adjusted quotes for the properties currently on screen, keyed by
  // property id. Fetched after a search resolves; while a fetch is in
  // flight (or before any search has run) this stays whatever it was —
  // callers fall back to `basePriceEur` rather than showing a spinner.
  const [quotes, setQuotes] = useState<Record<string, QuoteRecord>>({})

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
      JSON.stringify({ bedrooms, checkIn, checkOut, guests }),
    )
  }, [bedrooms, checkIn, checkOut, guests])

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

  // Free for the whole stay, whatever their size. A party of fourteen does not
  // care how many bedrooms each apartment has, so the bedroom filter - which
  // narrows the single-apartment list above - must not narrow this one too.
  const freeForStay = useMemo(() => {
    if (!checkIn || !checkOut || calculateNights(checkIn, checkOut) < 1) return []
    return properties.filter(
      (property) =>
        !reservations.some(
          (reservation) =>
            reservation.propertyId === property.id &&
            reservationOverlapsStay(reservation, checkIn, checkOut),
        ),
    )
  }, [checkIn, checkOut, properties, reservations])

  const partySize = Number(guests) || 0

  const groupOptions = useMemo(() => {
    if (partySize < 2) return []
    return findCombinations(
      freeForStay.map((property) => ({
        id: property.id,
        name: property.name,
        maxGuests: property.maxGuests,
        bedrooms: property.bedrooms,
      })),
      partySize,
    )
  }, [freeForStay, partySize])

  // Apartments that sleep the party on their own. Shown beside the
  // combinations so a group is never split when it did not need to be.
  const singlesForParty = useMemo(
    () => (partySize < 2 ? [] : freeForStay.filter((property) => property.maxGuests >= partySize)),
    [freeForStay, partySize],
  )

  const nights = calculateNights(checkIn, checkOut)
  const searchKey = `${checkIn}|${checkOut}|${bedrooms}`
  const [pinnedPlan, setPinnedPlan] = useState<PinnedPlan | null>(null)

  // Compute a split-stay plan once per search and pin it. Booking a segment
  // refetches reservations, but the pinned plan survives — only the per-segment
  // statuses below change, so the other segments stay visible and bookable.
  useEffect(() => {
    if (status !== 'ready' || !checkIn || !checkOut || nights < 1) return
    if (pinnedPlan && pinnedPlan.searchKey === searchKey) return
    if (availableProperties.length > 0) {
      if (pinnedPlan) setPinnedPlan(null)
      return
    }
    const segments = buildSplitStayRecommendation({
      bedrooms,
      checkIn,
      checkOut,
      properties,
      reservations,
    })
    setPinnedPlan({ searchKey, segments })
  }, [
    availableProperties.length,
    bedrooms,
    checkIn,
    checkOut,
    nights,
    pinnedPlan,
    properties,
    reservations,
    searchKey,
    status,
  ])

  const recommendation = useMemo(() => {
    if (!pinnedPlan || pinnedPlan.searchKey !== searchKey) return []
    return pinnedPlan.segments.map((segment) => {
      const exactMatch = reservations.some(
        (reservation) =>
          reservation.propertyId === segment.property.id &&
          reservation.checkIn === segment.checkIn &&
          reservation.checkOut === segment.checkOut,
      )
      const overlaps = reservations.some(
        (reservation) =>
          reservation.propertyId === segment.property.id &&
          reservationOverlapsStay(reservation, segment.checkIn, segment.checkOut),
      )
      const segmentStatus: SegmentStatus = exactMatch ? 'booked' : overlaps ? 'unavailable' : 'available'
      return { ...segment, status: segmentStatus }
    })
  }, [pinnedPlan, reservations, searchKey])
  const recommendedProperties = useMemo(
    () => uniqueProperties(recommendation.map((segment) => segment.property)),
    [recommendation],
  )
  const insights = useMemo(() => {
    if (!checkIn || nights < 1 || availableProperties.length > 0) return []
    return buildApartmentInsights({ bedrooms, checkIn, checkOut, properties, reservations })
  }, [availableProperties.length, bedrooms, checkIn, checkOut, nights, properties, reservations])
  const calendarProperties = availableProperties.length > 0 ? availableProperties : recommendedProperties

  // The availability facts the reply draft is built from. Derived here rather
  // than recomputed server-side so the draft can never contradict what is on
  // screen — same walk, same numbers.
  const freeTypes = useMemo(
    () => [...new Set(availableProperties.map((p) => p.bedrooms))].sort((a, b) => a - b),
    [availableProperties],
  )
  const splitCovers = useMemo(
    () => recommendation.length > 0 && recommendation.every((s) => s.status === 'available'),
    [recommendation],
  )
  // Every segment after the first starts on the day the guest changes
  // apartment, so those check-ins ARE the changeover dates.
  const changeDate = useMemo(
    () => recommendation.slice(1).map((segment) => segment.checkIn),
    [recommendation],
  )
  // The apartment sizes the split plan uses, so the reply can quote the
  // cheapest of them.
  const splitTypes = useMemo(
    () => [...new Set(recommendation.map((segment) => segment.property.bedrooms))].sort((a, b) => a - b),
    [recommendation],
  )
  const nextFree = useMemo(() => {
    const starts = insights.map((i) => i.windowStart).filter(Boolean).sort()
    return starts[0] || ''
  }, [insights])
  const recommendationReservations = useMemo(
    // Booked segments already exist as real reservations — only ghost the rest.
    () =>
      buildRecommendationReservations(
        recommendation.filter((segment) => segment.status === 'available'),
        quotes,
      ),
    [quotes, recommendation],
  )
  const calendarReservations = useMemo(
    () => [...reservations, ...recommendationReservations],
    [recommendationReservations, reservations],
  )

  // Every property shown anywhere on the page right now (full-stay results,
  // insight rows, split-stay segments) — quoted together in one request.
  const listedPropertyIdsKey = useMemo(() => {
    const ids = new Set<string>()
    for (const property of availableProperties) ids.add(property.id)
    for (const property of recommendedProperties) ids.add(property.id)
    for (const insight of insights) ids.add(insight.property.id)
    return [...ids].sort().join(',')
  }, [availableProperties, insights, recommendedProperties])

  useEffect(() => {
    let ignore = false
    const propertyIds = listedPropertyIdsKey ? listedPropertyIdsKey.split(',') : []

    if (status !== 'ready' || nights < 1 || propertyIds.length === 0) {
      setQuotes({})
      return
    }

    fetchQuotes(checkIn, checkOut, propertyIds)
      .then((data) => {
        if (!ignore) setQuotes(data)
      })
      .catch(() => {
        // Leave quotes as-is (or empty) — every call site falls back to
        // basePriceEur, so a failed quote fetch never blanks the page.
        if (!ignore) setQuotes({})
      })

    return () => {
      ignore = true
    }
  }, [checkIn, checkOut, listedPropertyIdsKey, nights, status])

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
      nightlyPrice: quotedNightlyRate(quotes[property.id], property.basePriceEur),
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
          <StayDateRangeField
            checkIn={checkIn}
            checkOut={checkOut}
            onChange={(nextIn, nextOut) => {
              setCheckIn(nextIn)
              setCheckOut(nextOut)
            }}
          />
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
          <label>
            Party size
            <input
              className="availability-guests"
              min={1}
              placeholder="Any"
              type="number"
              value={guests}
              onChange={(event) => setGuests(event.target.value.replace(/[^0-9]/g, ''))}
            />
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
            {availableProperties.map((property) => {
              const quote = quotes[property.id]
              const nightlyRate = quotedNightlyRate(quote, property.basePriceEur)
              const totalNote = quotedTotalNote(quote, nights)
              return (
                <article className="availability-card" key={property.id}>
                  {property.photoUrl ? <img alt="" src={property.photoUrl} /> : <span />}
                  <div>
                    <strong>{property.name}</strong>
                    <p>{property.apartmentType}</p>
                    <small className="money">{Number(nightlyRate || 0).toFixed(0)} EUR per night</small>
                    {totalNote && <small className="money">{totalNote}</small>}
                  </div>
                  <button
                    className="primary-button availability-book-btn"
                    type="button"
                    onClick={() => openBookModal(property)}
                  >
                    Book
                  </button>
                </article>
              )
            })}
          </div>
          {partySize >= 2 && (
            <section className="availability-group">
              <div>
                <p className="eyebrow">Party of {partySize}</p>
                <h3>
                  {singlesForParty.length > 0
                    ? 'Apartments that take the whole party'
                    : 'No single apartment takes the whole party'}
                </h3>
              </div>

              {singlesForParty.length > 0 && (
                <div className="group-singles">
                  {singlesForParty.map((property) => (
                    <article className="group-single" key={property.id}>
                      <div>
                        <strong>{property.name}</strong>
                        <small>sleeps {property.maxGuests}</small>
                      </div>
                      <button
                        className="btn btn-sm btn-outline"
                        type="button"
                        onClick={() => openBookModal(property)}
                      >
                        Book
                      </button>
                    </article>
                  ))}
                </div>
              )}

              {groupOptions.length > 0 ? (
                <>
                  <p className="group-lead">
                    {singlesForParty.length > 0 ? 'Or split them across:' : 'Split them across:'}
                  </p>
                  <div className="group-combos">
                    {groupOptions.map((combo) => (
                      <article
                        className="group-combo"
                        key={combo.apartments.map((a) => a.id).join('+')}
                      >
                        <header>
                          <strong>
                            {combo.apartments.length} apartments · sleeps {combo.capacity}
                          </strong>
                          <small>
                            {combo.bedrooms} {combo.bedrooms === 1 ? 'bedroom' : 'bedrooms'}
                            {combo.spareBeds > 0
                              ? ` · ${combo.spareBeds} spare ${combo.spareBeds === 1 ? 'bed' : 'beds'}`
                              : ' · exact fit'}
                          </small>
                        </header>
                        <ul>
                          {combo.apartments.map((apartment) => {
                            const property = freeForStay.find((row) => row.id === apartment.id)
                            return (
                              <li key={apartment.id}>
                                <span>{apartment.name}</span>
                                <small>sleeps {apartment.maxGuests}</small>
                                {property && (
                                  <button
                                    className="btn btn-sm btn-outline"
                                    type="button"
                                    onClick={() => openBookModal(property)}
                                  >
                                    Book
                                  </button>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                singlesForParty.length === 0 && (
                  <p className="group-empty">
                    Nothing free over these dates sleeps {partySize}, even combined. Try shorter
                    dates, or split the party across two stays.
                  </p>
                )
              )}
            </section>
          )}

          {availableProperties.length === 0 && insights.length > 0 && (
            <section className="availability-insights">
              <div>
                <p className="eyebrow">No full-stay match</p>
                <h3>What each apartment can do instead</h3>
              </div>
              <div className="insight-list">
                {insights.map((insight) => {
                  const bookCheckOut =
                    insight.windowEnd ??
                    toDateInputValue(addDaysToDate(insight.windowStart, nights))
                  return (
                    <article className="insight-row" key={insight.property.id}>
                      <div className="insight-main">
                        <strong>{insight.property.name}</strong>
                        <small>{insight.property.apartmentType}</small>
                      </div>
                      <div className="insight-detail">
                        {insight.freeOnCheckIn ? (
                          <>
                            <span className="insight-badge free-now">Free on your date</span>
                            {insight.nights !== null ? (
                              <span>
                                Max <strong>{insight.nights} night{insight.nights !== 1 ? 's' : ''}</strong> from{' '}
                                {formatDisplayDate(insight.windowStart)} (until {formatDisplayDate(insight.windowEnd!)})
                              </span>
                            ) : (
                              <span>
                                Free from {formatDisplayDate(insight.windowStart)} — no upcoming booking
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="insight-badge free-later">Free later</span>
                            {insight.nights !== null ? (
                              <span>
                                Next window {formatDisplayDate(insight.windowStart)} →{' '}
                                {formatDisplayDate(insight.windowEnd!)} ({insight.nights} night{insight.nights !== 1 ? 's' : ''})
                              </span>
                            ) : (
                              <span>
                                Free from {formatDisplayDate(insight.windowStart)} — no upcoming booking
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <button
                        className="primary-button availability-book-btn"
                        type="button"
                        onClick={() =>
                          setBookModal({
                            propertyId: insight.property.id,
                            checkIn: insight.windowStart,
                            checkOut: bookCheckOut,
                            nightlyPrice: quotedNightlyRate(
                              quotes[insight.property.id],
                              insight.property.basePriceEur,
                            ),
                          })
                        }
                      >
                        Book this
                      </button>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
          {availableProperties.length === 0 && recommendation.length > 0 && (
            <section className="availability-recommendations">
              <div>
                <p className="eyebrow">Recommendation</p>
                <h3>Split the stay between apartments</h3>
                {recommendation.some((segment) => segment.status === 'booked') && (
                  <p className="recommendation-progress">
                    {recommendation.filter((segment) => segment.status === 'booked').length} of{' '}
                    {recommendation.length} segments booked — the remaining segments stay available below.
                  </p>
                )}
              </div>
              <div className="recommendation-route">
                {recommendation.map((segment, index) => (
                  <article
                    className={`recommendation-segment${segment.status !== 'available' ? ` segment-${segment.status}` : ''}`}
                    key={`${segment.property.id}-${segment.checkIn}`}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{segment.property.name}</strong>
                      <p>
                        {formatDisplayDate(segment.checkIn)} to {formatDisplayDate(segment.checkOut)} - {segment.nights}{' '}
                        {segment.nights === 1 ? 'night' : 'nights'}
                      </p>
                      <small>{segment.property.apartmentType}</small>
                    </div>
                    {segment.status === 'available' ? (
                      <button
                        className="primary-button availability-book-btn"
                        type="button"
                        onClick={() => setBookModal({
                          propertyId: segment.property.id,
                          checkIn: segment.checkIn,
                          checkOut: segment.checkOut,
                          nightlyPrice: quotedNightlyRate(quotes[segment.property.id], segment.property.basePriceEur),
                        })}
                      >
                        Book segment
                      </button>
                    ) : (
                      <div>
                        <span
                          className={`insight-badge ${segment.status === 'booked' ? 'free-now' : 'free-later'}`}
                        >
                          {segment.status === 'booked' ? 'Booked ✓' : 'No longer available'}
                        </span>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          {availableProperties.length === 0 && recommendation.length === 0 && insights.length === 0 && (
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

      {status === 'ready' && checkIn && checkOut && nights > 0 && (
        <GuestReplyPanel
          checkIn={checkIn}
          checkOut={checkOut}
          freeTypes={freeTypes}
          splitCovers={splitCovers}
          nextFree={nextFree}
          changeDate={changeDate}
          splitTypes={splitTypes}
        />
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

function buildRecommendationReservations(
  segments: StaySegment[],
  quotes: Record<string, QuoteRecord>,
): ReservationRecord[] {
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
    nightlyPrice: quotedNightlyRate(quotes[segment.property.id], segment.property.basePriceEur),
    totalPaid: '0',
    isArchived: false,
    archivedAt: '',
  }))
}

// A quote is either the full rule-adjusted breakdown or `{ error, total }`
// when pricing raised for that property (see QuoteRecord in types/domain.ts).
// Both here and at every prefill site, an error — or no quote yet, e.g. still
// loading or no search has run — falls back to the property's flat base
// price rather than showing a spinner or blanking the price out.
function quotedNightlyRate(quote: QuoteRecord | undefined, basePriceEur: string): string {
  if (!quote || 'error' in quote) return basePriceEur
  return quote.averageNightlyRate
}

// Rule-adjusted totals aren't always nightly rate × nights (e.g. a locked
// first-night rate, or a whole-stay promo) — surface the real total when it
// diverges so staff aren't misled by the per-night figure alone.
function quotedTotalNote(quote: QuoteRecord | undefined, nights: number): string | null {
  if (!quote || 'error' in quote) return null
  const rate = Number(quote.averageNightlyRate)
  const total = Number(quote.total)
  if (!Number.isFinite(rate) || !Number.isFinite(total)) return null
  if (Math.abs(total - rate * nights) < 0.01) return null
  return `Total €${total.toFixed(2)} for ${nights} night${nights === 1 ? '' : 's'}`
}

// For every apartment matching the bedroom filter, walk its bookings from the
// requested check-in and report either the max stay starting that day or the
// next free window. All reservation types (incl. maintenance) block dates,
// matching the main availability filter. To keep the panel focused, only two
// kinds of rows are shown: apartments free on the requested check-in, and
// apartments that free up inside the searched range with nothing booked after.
function buildApartmentInsights({
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
}): ApartmentInsight[] {
  const horizon = toDateInputValue(addDaysToDate(checkIn, INSIGHT_HORIZON_DAYS))
  const insights: ApartmentInsight[] = []

  for (const property of properties) {
    if (bedrooms !== 'any' && property.bedrooms !== Number(bedrooms)) continue

    const rows = reservations
      .filter((r) => r.propertyId === property.id && r.checkOut > checkIn)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))

    // Slide the cursor forward past every booking that covers it; the first
    // uncovered date starts the free window, the next booking ends it.
    let cursor = checkIn
    let windowEnd: string | null = null
    for (const r of rows) {
      if (r.checkOut <= cursor) continue
      if (r.checkIn <= cursor) {
        cursor = r.checkOut
        if (cursor > horizon) break
      } else {
        windowEnd = r.checkIn
        break
      }
    }
    if (cursor > horizon) continue // fully blocked for the next 6 months

    const freeOnCheckIn = cursor === checkIn
    // "Free later" rows are only useful when the apartment opens up during the
    // searched range and stays open — skip fragmented or far-future windows.
    if (!freeOnCheckIn && (windowEnd !== null || cursor >= checkOut)) continue

    insights.push({
      property,
      freeOnCheckIn,
      windowStart: cursor,
      windowEnd,
      nights: windowEnd ? calculateNights(cursor, windowEnd) : null,
    })
  }

  return insights.sort((a, b) => {
    if (a.freeOnCheckIn !== b.freeOnCheckIn) return a.freeOnCheckIn ? -1 : 1
    const aNights = a.nights ?? Infinity
    const bNights = b.nights ?? Infinity
    if (aNights !== bNights) return bNights - aNights
    return (
      a.windowStart.localeCompare(b.windowStart) ||
      a.property.name.localeCompare(b.property.name, undefined, { numeric: true })
    )
  })
}

function addDaysToDate(value: string, days: number) {
  const date = parseDate(value)
  date.setDate(date.getDate() + days)
  return date
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
