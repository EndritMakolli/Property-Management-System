import { ArrowRight, Check, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchProperties, fetchReservations, updateReservation } from '../api/pmsApi'
import { CalendarOverviewTimeline } from '../features/calendar/CalendarOverviewTimeline'
import { useCalendarReservationEditor } from '../features/calendar/useCalendarReservationEditor'
import type { PropertyListing, ReservationRecord } from '../types/domain'
import { calculateNights, formatDisplayDate, parseDateValue, toDateInputValue } from '../utils/date'

// ─────────────────────────────────────────────────────────
// Fuzzy search helpers (unchanged)
// ─────────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j])
    }
  }
  return matrix[b.length][a.length]
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[–—]/g, '-').split(/[\s,./]+/).filter((t) => t.length > 0)
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
}

function normaliseToken(t: string): string { return MONTH_MAP[t] ?? t }

function buildHaystack(r: ReservationRecord): string {
  return [r.guestName, r.guestPhone, r.apartment, r.reservationType, r.checkIn, r.checkOut, r.notes,
    String(Math.round(Number(r.totalPaid)))]
    .filter(Boolean).join(' ').toLowerCase()
}

function scoreReservation(query: string, r: ReservationRecord): number {
  const tokens = tokenize(query).map(normaliseToken)
  if (tokens.length === 0) return 0
  const haystack = buildHaystack(r)
  const words = haystack.split(/\s+/)
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) { score += 3 } else {
      let best = Infinity
      for (const word of words) {
        if (word.length < 2) continue
        if (token.length >= 3) best = Math.min(best, levenshtein(token, word))
      }
      if (best <= 1) score += 2
      else if (best <= 2) score += 1
    }
  }
  return score
}

// ─────────────────────────────────────────────────────────
// Change-apartment helpers
// ─────────────────────────────────────────────────────────
type FreeUpOption = {
  targetProperty: PropertyListing
  blockingReservation: ReservationRecord
  alternativeProperty: PropertyListing
}

function overlaps(r: ReservationRecord, ci: string, co: string) {
  return r.checkIn < co && r.checkOut > ci
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────
export function SearchReservationsPage() {
  const location = useLocation()
  const navigate = useNavigate()

  // Incoming state from ReservationsTable "Change apt." button
  const incomingReservation =
    (location.state as { reservation?: ReservationRecord } | null)?.reservation ?? null

  const [allReservations, setAllReservations] = useState<ReservationRecord[]>([])
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const inputRef = useRef<HTMLInputElement>(null)
  const changePanelRef = useRef<HTMLDivElement>(null)

  // ── Change-apartment inline panel ──
  const [changing, setChanging] = useState<ReservationRecord | null>(incomingReservation)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [timelineStart, setTimelineStart] = useState(() =>
    parseDateValue(incomingReservation?.checkIn ?? toDateInputValue(new Date())),
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

  useEffect(() => { inputRef.current?.focus() }, [status])

  // Scroll change panel into view when it opens
  useEffect(() => {
    if (changing && changePanelRef.current) {
      setTimeout(() => changePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    }
  }, [changing])

  // Sync timeline when reservation changes
  useEffect(() => {
    if (changing) setTimelineStart(parseDateValue(changing.checkIn))
  }, [changing])

  // ── Search results ──
  const results = useMemo(() => {
    const q = query.trim()
    if (q.length < 2) return []
    return allReservations
      .map((r) => ({ r, score: scoreReservation(q, r) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.r.checkIn.localeCompare(b.r.checkIn))
      .slice(0, 60)
      .map(({ r }) => r)
  }, [query, allReservations])

  const propMap = useMemo(() => {
    const m = new Map<string, PropertyListing>()
    properties.forEach((p) => m.set(p.id, p))
    return m
  }, [properties])

  const isEmpty = query.trim().length >= 2 && results.length === 0 && status === 'ready'

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

  // ── Change actions ──
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
      // Refresh reservation list
      const rows = await fetchReservations()
      setAllReservations(rows)
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
      const rows = await fetchReservations()
      setAllReservations(rows)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not complete swap.')
    } finally { setSaving(null) }
  }

  function openChange(r: ReservationRecord) {
    setSaved(false)
    setSaveError('')
    setChanging(r)
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

  return (
    <div className="search-res-page">
      <div className="search-res-header">
        <div>
          <p className="eyebrow">Smart search</p>
          <h2>Find a reservation</h2>
        </div>
      </div>

      {/* ── Search input ── */}
      <div className="search-res-input-wrap">
        <Search size={18} className="search-res-icon" />
        <input
          ref={inputRef}
          autoComplete="off"
          className="search-res-input"
          placeholder="Name, phone, apartment, date (e.g. May 2024), platform, amount…"
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

      {status === 'loading' && <p className="listings-message">Loading reservations…</p>}
      {status === 'error' && <p className="form-error">Could not load reservations.</p>}

      {status === 'ready' && query.trim().length < 2 && !changing && (
        <p className="search-res-hint">
          Type at least 2 characters to search. Typos are OK — we'll find the closest match.
        </p>
      )}
      {isEmpty && (
        <p className="search-res-hint">
          No reservations match <strong>"{query}"</strong>. Try a different name, phone, or date.
        </p>
      )}

      {/* ── Results ── */}
      {results.length > 0 && (
        <>
          <p className="search-res-count">{results.length} result{results.length !== 1 ? 's' : ''}</p>
          <div className="search-res-card-list">
            {results.map((r) => {
              const prop = propMap.get(r.propertyId)
              const isChanging = changing?.id === r.id
              return (
                <div key={r.id} className={`search-res-card${isChanging ? ' search-res-card-active' : ''}`}>
                  {prop?.photoUrl
                    ? <img alt="" className="search-res-card-photo" src={prop.photoUrl} />
                    : <span className="search-res-card-photo search-res-card-photo-placeholder" />}

                  <div className="search-res-card-main">
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
                        onClick={() => isChanging ? closeChange() : openChange(r)}
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
          {/* Panel header */}
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
              {/* Summary */}
              <div className="availability-summary">
                <strong>{availableProperties.length}</strong>
                <span>
                  free apartment{availableProperties.length !== 1 ? 's' : ''} for {changeNights} night{changeNights !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Direct options */}
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

              {/* Swap recommendations */}
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

              {/* Calendar */}
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

      {modalState && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
