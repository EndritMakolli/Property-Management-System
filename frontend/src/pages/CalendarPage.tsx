import { useEffect, useMemo, useState } from 'react'
import { fetchProperties, fetchReservations } from '../api/pmsApi'
import { CalendarOverviewTimeline } from '../features/calendar/CalendarOverviewTimeline'
import { PropertyMonthCalendar } from '../features/calendar/PropertyMonthCalendar'
import { filterCalendarProperties, sortCalendarProperties, type CalendarSortBy } from '../features/calendar/calendarFilters'
import { useCalendarReservationEditor } from '../features/calendar/useCalendarReservationEditor'
import { NewReservationModal } from '../features/reservations/NewReservationModal'
import type { PropertyListing, ReservationRecord } from '../types/domain'

export function CalendarPage() {
  const today = new Date()
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [overviewReservations, setOverviewReservations] = useState<ReservationRecord[]>([])
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [timelineStartDate, setTimelineStartDate] = useState(() => new Date(today))
  const [calendarView, setCalendarView] = useState<'overview' | 'property'>('overview')
  const [calendarSearch, setCalendarSearch] = useState('')
  const [bedroomFilter, setBedroomFilter] = useState('any')
  const [calendarSort, setCalendarSort] = useState<CalendarSortBy>('number')
  const [propertyStatus, setPropertyStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [overviewStatus, setOverviewStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reservationStatus, setReservationStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const {
    closeModal,
    handleCalendarDayClick,
    handleReservationClick,
    modalState,
    selectedDateKey,
    selectedPropertyId: selectedRangePropertyId,
  } = useCalendarReservationEditor()

  useEffect(() => {
    let ignore = false

    async function loadProperties() {
      try {
        setPropertyStatus('loading')
        const data = await fetchProperties()
        if (ignore) {
          return
        }

        setProperties(data)
        setSelectedPropertyId((current) => current || data[0]?.id || '')
        setPropertyStatus('ready')
      } catch {
        if (!ignore) {
          setPropertyStatus('error')
        }
      }
    }

    loadProperties()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadOverviewReservations() {
      try {
        setOverviewStatus('loading')
        const data = await fetchReservations()
        if (!ignore) {
          setOverviewReservations(data)
          setOverviewStatus('ready')
        }
      } catch {
        if (!ignore) {
          setOverviewStatus('error')
        }
      }
    }

    loadOverviewReservations()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!selectedPropertyId) {
      setReservations([])
      setReservationStatus('ready')
      return
    }

    let ignore = false

    async function loadReservations() {
      try {
        setReservationStatus('loading')
        const data = await fetchReservations({
          month: selectedMonth,
          propertyId: selectedPropertyId,
          year: selectedYear,
        })
        if (!ignore) {
          setReservations(data)
          setReservationStatus('ready')
        }
      } catch {
        if (!ignore) {
          setReservationStatus('error')
        }
      }
    }

    loadReservations()

    return () => {
      ignore = true
    }
  }, [selectedMonth, selectedPropertyId, selectedYear])

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === selectedPropertyId),
    [properties, selectedPropertyId],
  )
  const bedroomOptions = useMemo(
    () => [...new Set(properties.map((property) => property.bedrooms))].sort((a, b) => a - b),
    [properties],
  )
  const filteredProperties = useMemo(
    () => sortCalendarProperties(
      filterCalendarProperties(properties, calendarSearch, bedroomFilter),
      calendarSort,
    ),
    [bedroomFilter, calendarSearch, calendarSort, properties],
  )

  function selectProperty(propertyId: string) {
    setSelectedPropertyId(propertyId)
    setCalendarView('property')
  }

  function moveTimeline(days: number) {
    if (days === 0) {
      setTimelineStartDate(new Date())
      return
    }

    setTimelineStartDate((current) => {
      const date = new Date(current)
      date.setDate(current.getDate() + days)
      return date
    })
  }

  async function reloadCalendarData() {
    const overviewData = await fetchReservations()
    setOverviewReservations(overviewData)

    if (selectedPropertyId) {
      const monthData = await fetchReservations({
        month: selectedMonth,
        propertyId: selectedPropertyId,
        year: selectedYear,
      })
      setReservations(monthData)
    }
  }

  if (calendarView === 'overview') {
    return (
      <>
        <CalendarOverviewTimeline
          onDayClick={handleCalendarDayClick}
          onJumpToDate={setTimelineStartDate}
          onMoveRange={moveTimeline}
          onReservationClick={handleReservationClick}
          onSelectProperty={selectProperty}
          bedroomFilter={bedroomFilter}
          bedroomOptions={bedroomOptions}
          onBedroomFilterChange={setBedroomFilter}
          onSearchChange={setCalendarSearch}
          onSortChange={setCalendarSort}
          properties={filteredProperties}
          reservations={overviewReservations}
          searchValue={calendarSearch}
          selectedDateKey={selectedDateKey}
          selectedPropertyId={selectedRangePropertyId}
          sortBy={calendarSort}
          startDate={timelineStartDate}
          status={propertyStatus === 'error' ? 'error' : overviewStatus}
        />
        {modalState && (
          <NewReservationModal
            initialValues={modalState.initialValues}
            mode={modalState.mode}
            onClose={closeModal}
            onSaved={reloadCalendarData}
            open
            reservation={modalState.reservation}
          />
        )}
      </>
    )
  }

  return (
    <section className="calendar-page-shell">
      <PropertyMonthCalendar
        month={selectedMonth}
        onBackToOverview={() => setCalendarView('overview')}
        onDayClick={handleCalendarDayClick}
        onMonthChange={setSelectedMonth}
        onReservationClick={handleReservationClick}
        onYearChange={setSelectedYear}
        property={selectedProperty}
        reservations={reservations}
        selectedDateKey={selectedDateKey}
        selectedPropertyId={selectedRangePropertyId}
        status={propertyStatus === 'error' ? 'error' : reservationStatus}
        year={selectedYear}
      />
      {modalState && (
        <NewReservationModal
          initialValues={modalState.initialValues}
          mode={modalState.mode}
          onClose={closeModal}
          onSaved={reloadCalendarData}
          open
          reservation={modalState.reservation}
        />
      )}
    </section>
  )
}
