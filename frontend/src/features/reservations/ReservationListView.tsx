import { ArrowRight, Check, Pencil, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProperties, fetchReservations, updateReservation } from '../../api/pmsApi'
import { CalendarOverviewTimeline } from '../calendar/CalendarOverviewTimeline'
import { useCalendarReservationEditor } from '../calendar/useCalendarReservationEditor'
import { NewReservationModal } from './NewReservationModal'
import { scoreReservation, overlaps, stayCoversDate } from './reservationSearch'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { calculateNights, formatDisplayDate, parseDateValue, toDateInputValue } from '../../utils/date'

type FreeUpOption = {
  targetProperty: PropertyListing
  blockingReservation: ReservationRecord
  alternativeProperty: PropertyListing
}

// ── Two-level sort ──
type SortKey = 'apartment' | 'checkIn' | 'checkOut' | 'guest' | 'total'
type SortDir = 'asc' | 'desc'
type ListSort = { primaryKey: SortKey; primaryDir: SortDir; secondaryKey: SortKey; secondaryDir: SortDir }

const LIST_SORT_KEY = 'pms.reservations.listSort'
const defaultListSort: ListSort = {
  primaryKey: 'apartment',
  primaryDir: 'asc',
  secondaryKey: 'checkIn',
  secondaryDir: 'asc',
}

const sortKeyOptions: { value: SortKey; label: string }[] = [
  { value: 'apartment', label: 'Apartment' },
  { value: 'checkIn', label: 'Check-in' },
  { value: 'checkOut', label: 'Check-out' },
  { value: 'guest', label: 'Guest' },
  { value: 'total', label: 'Total paid' },
]

function sortValue(r: ReservationRecord, key: SortKey): string | number {
  switch (key) {
    case 'apartment': return r.apartment
    case 'checkIn': return r.checkIn
    case 'checkOut': return r.checkOut
    case 'guest': return r.guestName || r.guestPhone || ''
    case 'total': return Number(r.totalPaid)
  }
}

function compareBy(a: ReservationRecord, b: ReservationRecord, key: SortKey, dir: SortDir) {
  const mul = dir === 'asc' ? 1 : -1
  const av = sortValue(a, key)
  const bv = sortValue(b, key)
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * mul
}

function toMonthValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function readStoredSort(): ListSort {
  const stored = window.localStorage.getItem(LIST_SORT_KEY)
  if (!stored) return defaultListSort
  try {
    return { ...defaultListSort, ...JSON.parse(stored) } as ListSort
  } catch {
    return defaultListSort
  }
}

type ReservationListViewProps = {
  initialChanging?: ReservationRecord | null
}

export function ReservationListView({ initialChanging }: ReservationListViewProps) {
  const navigate = useNavigate()

  const [allReservations, setAllReservations] = useState<ReservationRecord[]>([])
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [query, setQuery] = useState('')
  const [apartmentFilter, setApartmentFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState(() => toMonthValue(new Date()))
  const [dateFilter, setDateFilter] = useState('')
  const [sort, setSort] = useState<ListSort>(readStoredSort)
  const [editing, setEditing] = useState<ReservationRecord | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const inputRef = useRef<HTMLInputElement>(null)
  const changePanelRef = useRef<HTMLDivElement>(null)

  // ── Change-apartment inline panel ──
  const [changing, setChanging] = useState<ReservationRecord | null>(initialChanging ?? null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [timelineStart, setTimelineStart] = useState(() =>
    parseDateValue(initialChanging?.checkIn ?? toDateInputValue(new Date())),
  )

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
    Promise.all([fetchReservations(), fetchProperties()])
      .then(([resRows, propRows]) => {
        if (!ignore) {
          setAllReservations(resRows)
          setProperties(propRows)
          setStatus('ready')
        }
      })
      .catch(() => { if (!ignore) setStatus('error') })
    return () => { ignore = true }
  }, [])

  async function refetchReservations() {
    try {
      setAllReservations(await fetchReservations())
    } catch {
      /* keep the current list if the refresh fails */
    }
  }

  useEffect(() => { window.localStorage.setItem(LIST_SORT_KEY, JSON.stringify(sort)) }, [sort])
  useEffect(() => { inputRef.current?.focus() }, [status])

  // Open the change panel when the parent hands us a reservation (Table view "Change apt.")
  useEffect(() => {
    if (initialChanging) {
      setChanging(initialChanging)
      setSaved(false)
      setSaveError('')
    }
  }, [initialChanging])

  useEffect(() => {
    if (changing && changePanelRef.current) {
      setTimeout(() => changePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    }
  }, [changing])

  useEffect(() => {
    if (changing) setTimelineStart(parseDateValue(changing.checkIn))
  }, [changing])

  // ── Results ──
  const results = useMemo(() => {
    let pool = allReservations
    if (apartmentFilter) pool = pool.filter((r) => r.propertyId === apartmentFilter)
    if (dateFilter) {
      // A picked day takes precedence over the month filter.
      pool = pool.filter((r) => stayCoversDate(r, dateFilter))
    } else if (monthFilter) {
      pool = pool.filter(
        (r) => r.checkIn.slice(0, 7) <= monthFilter && r.checkOut.slice(0, 7) >= monthFilter,
      )
    }

    const q = query.trim()
    if (q.length >= 2) {
      return pool
        .map((r) => ({ r, score: scoreReservation(q, r) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.r.checkIn.localeCompare(b.r.checkIn))
        .slice(0, 200)
        .map(({ r }) => r)
    }

    return [...pool]
      .sort(
        (a, b) =>
          compareBy(a, b, sort.primaryKey, sort.primaryDir) ||
          compareBy(a, b, sort.secondaryKey, sort.secondaryDir),
      )
      .slice(0, 300)
  }, [query, apartmentFilter, monthFilter, dateFilter, allReservations, sort])

  const propMap = useMemo(() => {
    const m = new Map<string, PropertyListing>()
    properties.forEach((p) => m.set(p.id, p))
    return m
  }, [properties])

  const isEmpty = results.length === 0 && status === 'ready'

  // ── Change-apartment availability logic ──
  const changeCheckIn = changing?.checkIn ?? ''
  const changeCheckOut = changing?.checkOut ?? ''
  const changeNights = changing ? calculateNights(changeCheckIn, changeCheckOut) : 0

  const reservationsWithoutChanging = useMemo(
    () => allReservations.filter((r) => r.id !== changing?.id),
    [allReservations, changing],
  )

  const availableProperties = useMemo(() => {
    if (!changing || changeNights < 1) return []
    return properties.filter((p) => {
      if (p.id === changing.propertyId) return false
      return !reservationsWithoutChanging.some((r) => r.propertyId === p.id && overlaps(r, changeCheckIn, changeCheckOut))
    })
  }, [changing, changeNights, properties, reservationsWithoutChanging, changeCheckIn, changeCheckOut])

  const freeUpOptions = useMemo<FreeUpOption[]>(() => {
    if (!changing || changeNights < 1 || availableProperties.length > 0) return []
    const suggestions: FreeUpOption[] = []
    for (const prop of properties) {
      if (prop.id === changing.propertyId) continue
      const blocking = reservationsWithoutChanging.find(
        (r) => r.propertyId === prop.id && overlaps(r, changeCheckIn, changeCheckOut),
      )
      if (!blocking) continue
      const alt = properties.find(
        (a) =>
          a.id !== prop.id &&
          a.id !== changing.propertyId &&
          !reservationsWithoutChanging.some(
            (r) => r.propertyId === a.id && r.id !== blocking.id && overlaps(r, blocking.checkIn, blocking.checkOut),
          ),
      )
      if (alt) suggestions.push({ targetProperty: prop, blockingReservation: blocking, alternativeProperty: alt })
    }
    return suggestions
  }, [changing, changeNights, availableProperties.length, properties, reservationsWithoutChanging, changeCheckIn, changeCheckOut])

  const calendarProps = useMemo(() => {
    if (!changing) return properties
    if (availableProperties.length > 0) return availableProperties
    if (freeUpOptions.length > 0) return freeUpOptions.map((o) => o.targetProperty)
    return properties
  }, [changing, availableProperties, freeUpOptions, properties])

  async function doChange(newPropertyId: string) {
    if (!changing) return
    setSaving(newPropertyId)
    setSaveError('')
    try {
      await updateReservation(changing.id, {
        guestName: changing.guestName, guestPhone: changing.guestPhone,
        paymentDue: changing.paymentDue, paid: changing.paid, notes: changing.notes,
        reservationType: changing.reservationType, propertyId: newPropertyId,
        checkIn: changing.checkIn, checkOut: changing.checkOut, nightlyPrice: changing.nightlyPrice,
      })
      setSaved(true)
      setAllReservations(await fetchReservations())
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not update reservation.')
    } finally { setSaving(null) }
  }

  async function doSwap(opt: FreeUpOption) {
    if (!changing) return
    setSaving(opt.targetProperty.id + '-swap')
    setSaveError('')
    try {
      await updateReservation(opt.blockingReservation.id, {
        guestName: opt.blockingReservation.guestName, guestPhone: opt.blockingReservation.guestPhone,
        paymentDue: opt.blockingReservation.paymentDue, paid: opt.blockingReservation.paid,
        notes: opt.blockingReservation.notes, reservationType: opt.blockingReservation.reservationType,
        propertyId: opt.alternativeProperty.id,
        checkIn: opt.blockingReservation.checkIn, checkOut: opt.blockingReservation.checkOut,
        nightlyPrice: opt.blockingReservation.nightlyPrice,
      })
      await updateReservation(changing.id, {
        guestName: changing.guestName, guestPhone: changing.guestPhone,
        paymentDue: changing.paymentDue, paid: changing.paid, notes: changing.notes,
        reservationType: changing.reservationType, propertyId: opt.targetProperty.id,
        checkIn: changing.checkIn, checkOut: changing.checkOut, nightlyPrice: changing.nightlyPrice,
      })
      setSaved(true)
      setAllReservations(await fetchReservations())
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not complete swap.')
    } finally { setSaving(null) }
  }

  function closeChange() {
    setChanging(null)
    setSaved(false)
    setSaveError('')
  }

  function moveTimeline(days: number) {
    setTimelineStart((cur) => {
      if (days === 0) return parseDateValue(changing?.checkIn ?? toDateInputValue(new Date()))
      const next = new Date(cur)
      next.setDate(cur.getDate() + days)
      return next
    })
  }

  function updateSort(patch: Partial<ListSort>) {
    setSort((current) => ({ ...current, ...patch }))
  }

  return (
    <div className="search-res-page">
      {/* ── Search input ── */}
      <div className="search-res-input-wrap">
        <Search size={18} className="search-res-icon" />
        <input
          ref={inputRef}
          autoComplete="off"
          className="search-res-input"
          placeholder="Name, phone, apartment, platform, amount…"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-res-clear" type="button" onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Filters + sort ── */}
      <div className="search-res-filters">
        <select
          aria-label="Filter by apartment"
          className="search-res-filter"
          value={apartmentFilter}
          onChange={(e) => setApartmentFilter(e.target.value)}
        >
          <option value="">All apartments</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          aria-label="Filter by month"
          className="search-res-filter"
          disabled={!!dateFilter}
          type="month"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
        />
        {monthFilter && !dateFilter && (
          <button
            className="search-res-filter-clear"
            type="button"
            onClick={() => setMonthFilter('')}
          >
            <X size={14} /> All months
          </button>
        )}

        <input
          aria-label="Show reservations on a specific day"
          className="search-res-filter"
          title="Show reservations on a specific day"
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
        {dateFilter && (
          <button
            className="search-res-filter-clear"
            type="button"
            onClick={() => setDateFilter('')}
          >
            <X size={14} /> Any day
          </button>
        )}

        <div className="search-res-sort">
          <span className="search-res-sort-label">Sort</span>
          <select
            aria-label="Sort by"
            className="search-res-filter"
            value={sort.primaryKey}
            onChange={(e) => updateSort({ primaryKey: e.target.value as SortKey })}
          >
            {sortKeyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            aria-label="Sort direction"
            className="search-res-filter"
            value={sort.primaryDir}
            onChange={(e) => updateSort({ primaryDir: e.target.value as SortDir })}
          >
            <option value="asc">↑ Asc</option>
            <option value="desc">↓ Desc</option>
          </select>
          <span className="search-res-sort-label">then</span>
          <select
            aria-label="Secondary sort by"
            className="search-res-filter"
            value={sort.secondaryKey}
            onChange={(e) => updateSort({ secondaryKey: e.target.value as SortKey })}
          >
            {sortKeyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            aria-label="Secondary sort direction"
            className="search-res-filter"
            value={sort.secondaryDir}
            onChange={(e) => updateSort({ secondaryDir: e.target.value as SortDir })}
          >
            <option value="asc">↑ Asc</option>
            <option value="desc">↓ Desc</option>
          </select>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading reservations…</p>}
      {status === 'error' && <p className="form-error">Could not load reservations.</p>}
      {isEmpty && (
        <p className="search-res-hint">
          No reservations match{query.trim() ? <> <strong>"{query}"</strong></> : ' those filters'}.
          Try a different name, date, apartment, or month.
        </p>
      )}

      {/* ── Results ── */}
      {results.length > 0 && (
        <>
          <p className="search-res-count">{results.length} reservation{results.length !== 1 ? 's' : ''}</p>
          <div className="search-res-card-list">
            {results.map((r) => {
              const prop = propMap.get(r.propertyId)
              const isChanging = changing?.id === r.id
              return (
                <div key={r.id} className={`search-res-card${isChanging ? ' search-res-card-active' : ''}`}>
                  {prop?.photoUrl
                    ? <img alt="" className="search-res-card-photo" src={prop.photoUrl} />
                    : <span className="search-res-card-photo search-res-card-photo-placeholder" />}

                  <div
                    className="search-res-card-main search-res-card-main-clickable"
                    role="button"
                    tabIndex={0}
                    title="Edit reservation"
                    onClick={() => setEditing(r)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(r) } }}
                  >
                    <strong className="search-res-card-guest">{r.guestName || r.guestPhone || 'Guest'}</strong>
                    {r.guestName && r.guestPhone && <span className="search-res-card-phone">{r.guestPhone}</span>}
                    <span className="search-res-card-apt">{r.apartment}</span>
                  </div>

                  <div className="search-res-card-dates">
                    <span>{formatDisplayDate(r.checkIn)}</span>
                    <ArrowRight size={12} className="search-res-card-date-arrow" />
                    <span>{formatDisplayDate(r.checkOut)}</span>
                    <small>{r.totalNights} night{r.totalNights !== 1 ? 's' : ''}</small>
                  </div>

                  <div className="search-res-card-badges">
                    <span className={`search-res-platform search-res-platform-${r.reservationType}`}>
                      {r.reservationType}
                    </span>
                    <span className={`payment-badge ${r.paid ? 'paid' : 'unpaid'}`}>
                      {r.paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </div>

                  <div className="search-res-card-total">
                    <strong>{Number(r.totalPaid).toFixed(0)} EUR</strong>
                    <small>{r.nightlyPrice} / night</small>
                  </div>

                  <div className="search-res-card-actions">
                    <button className="search-res-action-btn" type="button" onClick={() => setEditing(r)}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      className="search-res-action-btn"
                      type="button"
                      onClick={() => navigate('/invoice', { state: { reservation: r } })}
                    >
                      Invoice
                    </button>
                    {r.reservationType !== 'maintenance' && (
                      <button
                        className={`search-res-action-btn${isChanging ? ' active' : ''}`}
                        type="button"
                        onClick={() => isChanging ? closeChange() : setChanging(r)}
                      >
                        {isChanging ? 'Cancel' : 'Change apt.'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Inline change panel ── */}
      {changing && (
        <div ref={changePanelRef} className="search-res-change-panel">
          <div className="search-res-change-header">
            <div className="search-res-change-who">
              <p className="eyebrow">Smart Change</p>
              <h3>
                {changing.guestName || changing.guestPhone || 'Guest'}
                <span> · currently in {changing.apartment}</span>
              </h3>
              <p className="search-res-change-dates">
                {formatDisplayDate(changing.checkIn)} – {formatDisplayDate(changing.checkOut)}
                {' · '}{changeNights} night{changeNights !== 1 ? 's' : ''}
              </p>
            </div>
            <button className="icon-button" type="button" onClick={closeChange}>
              <X size={18} />
            </button>
          </div>

          {saveError && <p className="form-error">{saveError}</p>}

          {saved ? (
            <div className="search-res-change-saved">
              <Check size={20} />
              <span>Apartment changed successfully.</span>
              <button type="button" onClick={closeChange}>Done</button>
            </div>
          ) : (
            <>
              <div className="availability-summary">
                <strong>{availableProperties.length}</strong>
                <span>
                  free apartment{availableProperties.length !== 1 ? 's' : ''} for {changeNights} night{changeNights !== 1 ? 's' : ''}
                </span>
              </div>

              {availableProperties.length > 0 && (
                <div className="availability-results">
                  {availableProperties.map((prop) => (
                    <article className="availability-card" key={prop.id}>
                      {prop.photoUrl ? <img alt="" src={prop.photoUrl} /> : <span />}
                      <div>
                        <strong>{prop.name}</strong>
                        <p>{prop.apartmentType}</p>
                        <small>{Number(prop.basePriceEur || 0).toFixed(0)} EUR / night</small>
                      </div>
                      <button
                        className="primary-button availability-book-btn"
                        disabled={saving === prop.id}
                        type="button"
                        onClick={() => doChange(prop.id)}
                      >
                        {saving === prop.id ? 'Saving…' : 'Change here'}
                      </button>
                    </article>
                  ))}
                </div>
              )}

              {availableProperties.length === 0 && freeUpOptions.length > 0 && (
                <section className="availability-recommendations">
                  <div>
                    <p className="eyebrow">Recommendation</p>
                    <h3>Free up a property by moving another guest</h3>
                  </div>
                  <div className="recommendation-route">
                    {freeUpOptions.map((opt) => (
                      <article
                        className="recommendation-segment change-apt-swap-card"
                        key={`${opt.targetProperty.id}-${opt.blockingReservation.id}`}
                      >
                        <div className="change-apt-swap-detail">
                          <p className="change-apt-swap-label">Move this guest out first:</p>
                          <strong>{opt.blockingReservation.guestName || opt.blockingReservation.guestPhone || 'Guest'}</strong>
                          <p>
                            <span className="change-apt-from">{opt.targetProperty.name}</span>
                            <ArrowRight size={13} className="change-apt-arrow" />
                            <span className="change-apt-to">{opt.alternativeProperty.name}</span>
                          </p>
                          <small>
                            {formatDisplayDate(opt.blockingReservation.checkIn)} – {formatDisplayDate(opt.blockingReservation.checkOut)}
                          </small>
                          <p className="change-apt-then">
                            Then move <strong>{changing.guestName || 'your guest'}</strong> into{' '}
                            <strong>{opt.targetProperty.name}</strong>
                          </p>
                        </div>
                        <button
                          className="primary-button availability-book-btn"
                          disabled={saving === opt.targetProperty.id + '-swap'}
                          type="button"
                          onClick={() => doSwap(opt)}
                        >
                          {saving === opt.targetProperty.id + '-swap' ? 'Swapping…' : 'Do this swap'}
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {availableProperties.length === 0 && freeUpOptions.length === 0 && (
                <p className="listings-message">No free apartments or swappable options for these dates.</p>
              )}

              <CalendarOverviewTimeline
                emptyMessage="No apartments to display."
                onDayClick={handleCalendarDayClick}
                onMoveRange={moveTimeline}
                onReservationClick={handleReservationClick}
                properties={calendarProps}
                reservations={allReservations}
                selectedDateKey={selectedDateKey}
                selectedPropertyId={selectedRangePropertyId}
                startDate={timelineStart}
                status={status}
                subtitle={`${formatDisplayDate(changeCheckIn)} – ${formatDisplayDate(changeCheckOut)}`}
                title={
                  availableProperties.length > 0
                    ? `${availableProperties.length} available options`
                    : freeUpOptions.length > 0
                      ? `${freeUpOptions.length} swap suggestion${freeUpOptions.length !== 1 ? 's' : ''}`
                      : 'All apartments'
                }
                visibleDays={Math.max(changeNights, 7)}
              />
            </>
          )}
        </div>
      )}

      <NewReservationModal
        open={!!editing}
        mode="edit"
        reservation={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refetchReservations() }}
      />

      {modalState && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
