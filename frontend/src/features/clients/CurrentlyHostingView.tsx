// Who is in the building right now.
//
// The cards are the reservations page's own `search-res-card` markup, so this
// list and that one read identically — apartment photo, guest, dates, badges,
// total — with the garage-card tick added on the end.

import { ArrowRight, Car, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchProperties,
  fetchReservations,
  updateReservationGarageCard,
} from '../../api/pmsApi'
import { SortControl } from '../../components/shared/SortControl'
import { useReservationTypes } from '../../context/ReservationTypesContext'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { formatDisplayDate, toDateInputValue } from '../../utils/date'
import {
  GARAGE_FILTERS,
  HOSTING_SORT_OPTIONS,
  applyGarageFilter,
  currentlyHosting,
  garageCounts,
  sortHosting,
  type GarageFilter,
  type HostingSortKey,
  type SortDirection,
} from './hostingView'

const SORT_STORAGE_KEY = 'pms.clients.hostingSort'

function readStoredSort(): { key: HostingSortKey; direction: SortDirection } {
  const fallback = { key: 'apartment' as HostingSortKey, direction: 'asc' as SortDirection }
  try {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY)
    if (!stored) return fallback
    const parsed = JSON.parse(stored) as { key?: string; direction?: string }
    const known = HOSTING_SORT_OPTIONS.some((option) => option.value === parsed.key)
    if (!known) return fallback
    return {
      key: parsed.key as HostingSortKey,
      direction: parsed.direction === 'desc' ? 'desc' : 'asc',
    }
  } catch {
    return fallback
  }
}

export function CurrentlyHostingView() {
  const { labelFor } = useReservationTypes()
  const [stays, setStays] = useState<ReservationRecord[]>([])
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sort, setSort] = useState(readStoredSort)
  const [garageFilter, setGarageFilter] = useState<GarageFilter>('all')
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const today = toDateInputValue(new Date())

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [rows, props] = await Promise.all([
        fetchReservations({ hosting: true }),
        fetchProperties(),
      ])
      setStays(rows)
      setProperties(props)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort))
  }, [sort])

  const photos = useMemo(
    () => new Map(properties.map((property) => [property.id, property.photoUrl])),
    [properties],
  )

  // The server already narrowed this, but filtering again is what lets the list
  // stay right as the day rolls over without a reload.
  const hosting = useMemo(() => currentlyHosting(stays, today), [stays, today])
  const counts = useMemo(() => garageCounts(hosting), [hosting])
  const visible = useMemo(
    () => sortHosting(applyGarageFilter(hosting, garageFilter), sort.key, sort.direction),
    [hosting, garageFilter, sort],
  )

  async function toggleGarage(stay: ReservationRecord) {
    const next = !stay.garageCard
    setError('')
    setSaving((current) => new Set(current).add(stay.id))
    // Optimistic: a checkbox that waits for a round trip feels broken when you
    // are ticking your way down a list.
    setStays((current) =>
      current.map((row) => (row.id === stay.id ? { ...row, garageCard: next } : row)),
    )
    try {
      await updateReservationGarageCard(stay.id, next)
    } catch (caught) {
      setStays((current) =>
        current.map((row) => (row.id === stay.id ? { ...row, garageCard: stay.garageCard } : row)),
      )
      setError(caught instanceof Error ? caught.message : 'Could not save the garage card.')
    } finally {
      setSaving((current) => {
        const next = new Set(current)
        next.delete(stay.id)
        return next
      })
    }
  }

  if (status === 'loading') return <p className="clients-empty">Loading…</p>
  if (status === 'error') return <p className="form-error">Could not load who is hosting.</p>

  return (
    <>
      <div className="client-filter-bar">
        <p className="hosting-counts">
          <strong>{counts.total}</strong> hosting ·{' '}
          <span className="hosting-count-has">
            <Car size={13} /> {counts.withCard} with a garage card
          </span>{' '}
          · <span className="hosting-count-missing">{counts.withoutCard} without</span>
        </p>

        <select
          aria-label="Garage card"
          value={garageFilter}
          onChange={(event) => setGarageFilter(event.target.value as GarageFilter)}
        >
          {GARAGE_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>

        <SortControl
          direction={sort.direction}
          options={HOSTING_SORT_OPTIONS}
          sortKey={sort.key}
          onChange={(key, direction) => setSort({ key, direction })}
        />

        <button className="pill-button" type="button" title="Refresh" onClick={load}>
          <RefreshCw size={14} />
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {visible.length === 0 ? (
        <p className="clients-empty">
          {counts.total === 0
            ? 'Nobody is staying tonight.'
            : 'No guests match this garage-card filter.'}
        </p>
      ) : (
        <div className="search-res-card-list">
          {visible.map((stay) => {
            const photo = photos.get(stay.propertyId)
            return (
              <div className="search-res-card" key={stay.id}>
                {photo ? (
                  <img alt="" className="search-res-card-photo" src={photo} />
                ) : (
                  <span className="search-res-card-photo search-res-card-photo-placeholder" />
                )}

                <div className="search-res-card-main">
                  <strong className="search-res-card-guest">
                    {stay.guestName || stay.guestPhone || 'Guest'}
                  </strong>
                  {stay.guestName && stay.guestPhone && (
                    <span className="search-res-card-phone">{stay.guestPhone}</span>
                  )}
                  <span className="search-res-card-apt">{stay.apartment}</span>
                </div>

                <div className="search-res-card-dates">
                  <span>{formatDisplayDate(stay.checkIn)}</span>
                  <ArrowRight size={12} className="search-res-card-date-arrow" />
                  <span>{formatDisplayDate(stay.checkOut)}</span>
                  <small>
                    {stay.totalNights} night{stay.totalNights === 1 ? '' : 's'}
                  </small>
                </div>

                <div className="search-res-card-badges">
                  <span className={`search-res-platform search-res-platform-${stay.reservationType}`}>
                    {labelFor(stay.reservationType)}
                  </span>
                  <span className={`payment-badge ${stay.paid ? 'paid' : 'unpaid'}`}>
                    {stay.paid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>

                <label
                  className={`garage-check${stay.garageCard ? ' has-card' : ''}`}
                  title={
                    stay.garageCard
                      ? 'Holding a garage card — untick when it comes back'
                      : 'No garage card issued for this stay'
                  }
                >
                  <input
                    checked={Boolean(stay.garageCard)}
                    disabled={saving.has(stay.id)}
                    type="checkbox"
                    onChange={() => toggleGarage(stay)}
                  />
                  <Car size={14} />
                  <span>Garage</span>
                </label>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
