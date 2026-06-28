import { ArrowRight, Clock, Pencil } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProperties, fetchReservations } from '../../api/pmsApi'
import { NewReservationModal } from './NewReservationModal'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'

const MAX_ROWS = 100

// "Added just now" / "Added 3 hours ago" / "Added 12-Jun-2024"
function formatAdded(value?: string): string {
  if (!value) return 'Added date unknown'
  const created = new Date(value)
  const time = created.getTime()
  if (Number.isNaN(time)) return 'Added date unknown'

  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return 'Added just now'
  if (minutes < 60) return `Added ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Added ${hours} hour${hours !== 1 ? 's' : ''} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `Added ${days} day${days !== 1 ? 's' : ''} ago`

  const day = String(created.getDate()).padStart(2, '0')
  const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(created)
  return `Added ${day}-${month}-${created.getFullYear()}`
}

export function LatestAddedView() {
  const navigate = useNavigate()
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [editing, setEditing] = useState<ReservationRecord | null>(null)

  async function load() {
    setStatus('loading')
    try {
      const [resRows, propRows] = await Promise.all([fetchReservations(), fetchProperties()])
      setReservations(resRows)
      setProperties(propRows)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const propMap = useMemo(() => {
    const m = new Map<string, PropertyListing>()
    properties.forEach((p) => m.set(p.id, p))
    return m
  }, [properties])

  // Newest first. Reservations without a creation timestamp sink to the bottom.
  const latest = useMemo(
    () =>
      [...reservations]
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .slice(0, MAX_ROWS),
    [reservations],
  )

  return (
    <div className="search-res-page latest-added-view">
      <p className="search-res-hint latest-added-intro">
        The most recently added reservations, newest first.
      </p>

      {status === 'loading' && <p className="listings-message">Loading latest reservations…</p>}
      {status === 'error' && <p className="form-error">Could not load reservations.</p>}
      {status === 'ready' && latest.length === 0 && (
        <p className="search-res-hint">No reservations have been added yet.</p>
      )}

      {latest.length > 0 && (
        <>
          <p className="search-res-count">
            {latest.length} most recently added reservation{latest.length !== 1 ? 's' : ''}
          </p>
          <div className="search-res-card-list">
            {latest.map((r) => {
              const prop = propMap.get(r.propertyId)
              return (
                <div key={r.id} className="search-res-card">
                  {prop?.photoUrl ? (
                    <img alt="" className="search-res-card-photo" src={prop.photoUrl} />
                  ) : (
                    <span className="search-res-card-photo search-res-card-photo-placeholder" />
                  )}

                  <div
                    className="search-res-card-main search-res-card-main-clickable"
                    role="button"
                    tabIndex={0}
                    title="Edit reservation"
                    onClick={() => setEditing(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setEditing(r)
                      }
                    }}
                  >
                    <strong className="search-res-card-guest">
                      {r.guestName || r.guestPhone || 'Guest'}
                    </strong>
                    <span className="search-res-card-apt">{r.apartment}</span>
                    <span className="latest-added-stamp">
                      <Clock size={12} /> {formatAdded(r.createdAt)}
                    </span>
                  </div>

                  <div className="search-res-card-dates">
                    <span>{formatDisplayDate(r.checkIn)}</span>
                    <ArrowRight size={12} className="search-res-card-date-arrow" />
                    <span>{formatDisplayDate(r.checkOut)}</span>
                    <small>
                      {r.totalNights} night{r.totalNights !== 1 ? 's' : ''}
                    </small>
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
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <NewReservationModal
        open={!!editing}
        mode="edit"
        reservation={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
    </div>
  )
}
