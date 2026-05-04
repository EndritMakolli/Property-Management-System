import { CalendarDays } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createReservation,
  deleteReservation as deleteReservationRequest,
  fetchProperties,
  fetchReservations,
  updateReservation as updateReservationRequest,
  type ReservationPayload,
} from '../api/pmsApi'
import { PanelHeader } from '../components/shared/PanelHeader'
import { monthOptions, yearOptions } from '../features/reservations/monthOptions'
import {
  ReservationsTable,
  type PastedRow,
  type ReservationSort,
  type ReservationSortKey,
} from '../features/reservations/ReservationsTable'
import type { EditableReservation, PropertyListing } from '../types/domain'
import { calculateNights, toDateInputValue } from '../utils/date'

const reservationSortStorageKey = 'pms.reservations.sort'
const defaultSort: ReservationSort = { key: 'checkIn', direction: 'asc' }
const numericSortKeys: ReservationSortKey[] = ['totalNights', 'nightlyPrice', 'totalPaid']

export function ReservationsPage() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [reservations, setReservations] = useState<EditableReservation[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const autosaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const savingReservations = useRef(new Set<string>())
  const [sort, setSort] = useState<ReservationSort>(() => {
    const stored = window.localStorage.getItem(reservationSortStorageKey)
    if (!stored) {
      return defaultSort
    }

    try {
      return { ...defaultSort, ...JSON.parse(stored) } as ReservationSort
    } catch {
      return defaultSort
    }
  })

  const loadReservationData = useCallback(async () => {
    setStatus('loading')
    setError('')

    try {
      const [propertyRows, reservationRows] = await Promise.all([
        fetchProperties(),
        fetchReservations({ month: selectedMonth, year: selectedYear }),
      ])
      setProperties(propertyRows)
      setReservations(reservationRows.map((item) => ({ ...item, isDirty: false })))
      setStatus('ready')
    } catch {
      setStatus('error')
      setError('Start the Django server, then refresh this page.')
    }
  }, [selectedMonth, selectedYear])

  useEffect(() => {
    loadReservationData()
  }, [loadReservationData])

  useEffect(() => {
    return () => {
      autosaveTimers.current.forEach((timer) => clearTimeout(timer))
      autosaveTimers.current.clear()
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(reservationSortStorageKey, JSON.stringify(sort))
  }, [sort])

  useEffect(() => {
    function handleReservationCreated() {
      loadReservationData()
    }

    window.addEventListener('pms:reservation-created', handleReservationCreated)
    return () => window.removeEventListener('pms:reservation-created', handleReservationCreated)
  }, [loadReservationData])

  useEffect(() => {
    const dirtyIds = new Set(reservations.filter((reservation) => reservation.isDirty).map((reservation) => reservation.id))

    autosaveTimers.current.forEach((timer, id) => {
      if (!dirtyIds.has(id)) {
        clearTimeout(timer)
        autosaveTimers.current.delete(id)
      }
    })

    reservations.forEach((reservation) => {
      if (!reservation.isDirty || savingReservations.current.has(reservation.id)) {
        return
      }

      const existingTimer = autosaveTimers.current.get(reservation.id)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      const timer = setTimeout(() => {
        autosaveTimers.current.delete(reservation.id)
        autoSaveReservation(reservation)
      }, 500)
      autosaveTimers.current.set(reservation.id, timer)
    })
  }, [reservations])

  const sortedReservations = useMemo(
    () =>
      [...reservations].sort((left, right) => {
        const direction = sort.direction === 'asc' ? 1 : -1
        const leftValue = getReservationSortValue(left, sort.key)
        const rightValue = getReservationSortValue(right, sort.key)

        if (numericSortKeys.includes(sort.key)) {
          return (Number(leftValue) - Number(rightValue)) * direction
        }

        return String(leftValue).localeCompare(String(rightValue), undefined, {
          numeric: true,
          sensitivity: 'base',
        }) * direction
      }),
    [reservations, sort],
  )

  function updateSort(key: ReservationSortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function addReservation() {
    const property = properties[0]

    if (!property) {
      setError('Add at least one property before creating a reservation.')
      return
    }

    const checkIn = new Date()
    checkIn.setFullYear(selectedYear, selectedMonth - 1, 1)
    const checkOut = new Date()
    checkOut.setFullYear(selectedYear, selectedMonth - 1, 2)

    setReservations((current) => [
      {
        id: `new-${Date.now()}`,
        guestName: '',
        guestPhone: '',
        paymentDue: '',
        paid: false,
        notes: '',
        reservationType: 'private',
        propertyId: property.id,
        apartment: property.name,
        apartmentType: property.apartmentType,
        checkIn: toDateInputValue(checkIn),
        checkOut: toDateInputValue(checkOut),
        totalNights: 1,
        nightlyPrice: '0.00',
        totalPaid: '0.00',
        isNew: true,
        isDirty: true,
      },
      ...current,
    ])
  }

  function handlePasteRows(pastedRows: PastedRow[]) {
    if (!properties.length) {
      setError('Add at least one property before pasting reservations.')
      return
    }

    const defaultProperty = properties[0]
    const validTypes = new Set(['private', 'airbnb', 'booking'])

    const newRows: EditableReservation[] = pastedRows.map((row, index) => {
      const guestName = (row.guestName || '').trim()
      const guestPhone = (row.guestPhone || '').trim()
      const checkIn = normalizeDate(row.checkIn || '')
      const checkOut = normalizeDate(row.checkOut || '')
      const rawType = (row.reservationType || '').trim().toLowerCase()
      const reservationType = validTypes.has(rawType) ? rawType : 'private'
      const nights = checkIn && checkOut ? calculateNights(checkIn, checkOut) : 0
      const pastedTotal = parsePositiveFloat(row.totalPaid)
      const pastedNightlyPrice = parsePositiveFloat(row.nightlyPrice) ?? 0
      const nightlyPrice =
        reservationType === 'airbnb'
          ? 0
          : pastedTotal !== null && nights > 0
            ? pastedTotal / nights
            : pastedNightlyPrice
      const paid = (row.paid || '').trim().toUpperCase() === 'TRUE'
      const paymentDue = normalizeDate(row.paymentDue || '')

      // Try to match apartment ref (e.g. "2") to a property by number or name
      const matchedProperty = matchProperty(row.apartmentRef || '', properties) ?? defaultProperty

      return {
        id: `paste-${Date.now()}-${index}`,
        guestName,
        guestPhone,
        paymentDue,
        paid,
        notes: (row.notes || '').trim(),
        reservationType: reservationType as 'private' | 'airbnb' | 'booking',
        propertyId: matchedProperty.id,
        apartment: matchedProperty.name,
        apartmentType: matchedProperty.apartmentType,
        checkIn,
        checkOut,
        totalNights: nights,
        nightlyPrice: nightlyPrice.toFixed(2),
        totalPaid: (pastedTotal ?? nightlyPrice * nights).toFixed(2),
        isNew: true,
        isDirty: true,
      }
    })

    setReservations((current) => [...newRows, ...current])
  }

  function updateReservation(id: string, updates: Partial<EditableReservation>) {
    setReservations((current) =>
      current.map((reservation) => {
        if (reservation.id !== id) {
          return reservation
        }

        const next = { ...reservation, ...updates, isDirty: true }
        const nights = calculateNights(next.checkIn, next.checkOut)
        const totalPaid = Number(next.totalPaid)

        if ('totalPaid' in updates) {
          next.nightlyPrice =
            Number.isFinite(totalPaid) && nights > 0 ? (totalPaid / nights).toFixed(2) : '0.00'
          next.totalNights = nights
          next.totalPaid = updates.totalPaid ?? ''
          return next
        }

        const nightlyPrice = Number(next.nightlyPrice)

        next.totalNights = nights
        next.totalPaid = Number.isFinite(nightlyPrice) && nights > 0 ? (nightlyPrice * nights).toFixed(2) : '0.00'

        return next
      }),
    )
  }

  async function autoSaveReservation(reservation: EditableReservation) {
    if (!canAutoSaveReservation(reservation)) {
      return
    }

    savingReservations.current.add(reservation.id)
    setError('')

    const payload: ReservationPayload = {
      guestName: reservation.guestName,
      guestPhone: reservation.guestPhone,
      paymentDue: reservation.paymentDue,
      paid: reservation.paid,
      notes: reservation.notes,
      reservationType: reservation.reservationType,
      propertyId: reservation.propertyId,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      nightlyPrice: reservation.nightlyPrice,
    }

    try {
      const saved = reservation.isNew
        ? await createReservation(payload)
        : await updateReservationRequest(reservation.id, payload)

      setReservations((current) =>
        current.map((item) =>
          item.id === reservation.id ? { ...saved, isDirty: false } : item,
        ),
      )
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not save reservation.')
    } finally {
      savingReservations.current.delete(reservation.id)
    }
  }

  async function deleteThisMonthReservations() {
    const rowsToDelete = reservations
    if (rowsToDelete.length === 0) {
      return
    }

    const monthLabel = monthOptions.find((month) => month.value === selectedMonth)?.label || selectedMonth
    if (!window.confirm(`Delete all ${rowsToDelete.length} reservations for ${monthLabel} ${selectedYear}?`)) {
      return
    }

    setError('')

    try {
      await Promise.all(
        rowsToDelete
          .filter((reservation) => !reservation.isNew)
          .map((reservation) => deleteReservationRequest(reservation.id)),
      )
      setReservations([])
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not delete this month.')
      loadReservationData()
    }
  }

  async function deleteReservation(reservation: EditableReservation) {
    setError('')

    if (reservation.isNew) {
      setReservations((current) => current.filter((item) => item.id !== reservation.id))
      return
    }

    try {
      await deleteReservationRequest(reservation.id)
      setReservations((current) => current.filter((item) => item.id !== reservation.id))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not delete reservation.')
    }
  }

  function openInvoice(reservation: EditableReservation) {
    navigate('/invoice', { state: { reservation } })
  }

  return (
    <section className="panel reservations-table-panel page-panel">
      <PanelHeader icon={CalendarDays} title="Reservations" action="Add row" onAction={addReservation} />
      <div className="reservation-filters">
        <label>
          Year
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
          >
            {yearOptions().map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label>
          Month
          <select
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(Number(event.target.value))}
          >
            {monthOptions.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="danger-button reservation-bulk-delete"
          disabled={reservations.length === 0}
          type="button"
          onClick={deleteThisMonthReservations}
        >
          Delete this month
        </button>
      </div>
      {status === 'loading' && <p className="listings-message">Loading reservations...</p>}
      {status === 'error' && <p className="form-error">{error}</p>}
      {status === 'ready' && properties.length === 0 && (
        <p className="form-error">Add a property first. Reservations must belong to a property.</p>
      )}
      {error && status === 'ready' && <p className="form-error">{error}</p>}
      {status === 'ready' && (
        <ReservationsTable
          properties={properties}
          rows={sortedReservations}
          onDelete={deleteReservation}
          onInvoice={openInvoice}
          onPasteRows={handlePasteRows}
          onSort={updateSort}
          onUpdate={updateReservation}
          sort={sort}
        />
      )}
    </section>
  )
}

function getReservationSortValue(reservation: EditableReservation, key: ReservationSortKey) {
  return reservation[key] ?? ''
}

function canAutoSaveReservation(reservation: EditableReservation) {
  return Boolean(
    reservation.propertyId &&
      reservation.checkIn &&
      reservation.checkOut &&
      calculateNights(reservation.checkIn, reservation.checkOut) > 0 &&
      (reservation.guestName.trim() || reservation.guestPhone.trim()),
  )
}

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function normalizeDate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  // Already ISO: 2025-05-01
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // Excel "D-Mon-Weekday" format: "1-May-Fri" or "6-May-Wed"
  // Also handles "1-May" without weekday
  const monMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})(?:-[A-Za-z]{3})?$/)
  if (monMatch) {
    const day = parseInt(monMatch[1], 10)
    const monthIndex = MONTH_ABBR[monMatch[2].toLowerCase()]
    if (monthIndex !== undefined) {
      const now = new Date()
      let year = now.getFullYear()
      // If the date already passed by more than 60 days, push to next year
      const candidate = new Date(year, monthIndex - 1, day)
      if ((candidate.getTime() - now.getTime()) / 86_400_000 < -60) year++
      return `${year}-${String(monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (slashMatch) {
    const [, a, b, y] = slashMatch
    const year = y.length === 2 ? `20${y}` : y
    return `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
  }

  return trimmed
}

function parsePositiveFloat(value: string | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(',', '.').replace(/[^0-9.]/g, '')
  const parsed = parseFloat(cleaned)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function matchProperty(ref: string, properties: PropertyListing[]): PropertyListing | null {
  const cleaned = ref.trim()
  if (!cleaned) return null

  // 1. Exact name match
  const exact = properties.find((p) => p.name === cleaned)
  if (exact) return exact

  // 2. Name contains the ref (e.g. "2" matches "Apartamenti 2", "Banesa 2")
  const contains = properties.find((p) => {
    const digits = p.name.match(/\d+/g) || ([] as string[])
    return digits.includes(cleaned)
  })
  if (contains) return contains

  // 3. Partial case-insensitive name match
  const lower = cleaned.toLowerCase()
  const partial = properties.find((p) => p.name.toLowerCase().includes(lower))
  return partial || null
}
