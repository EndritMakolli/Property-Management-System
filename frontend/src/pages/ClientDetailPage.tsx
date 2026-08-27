// One client: who they are, what they have spent, and every stay.
//
// The numbers come from `statTiles`, the same helper the guest sees in their
// own portal, so a staff member and a guest are never shown a different total
// for the same person. The upcoming/past split is `partitionStays`, also
// shared. Nothing here recomputes what those already answer.

import { ArrowLeft, ArrowRight, Mail, Phone, RotateCcw, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchClientStays, fetchGuest } from '../api/guests'
import { fetchProperties } from '../api/pmsApi'
import { Metric } from '../components/shared/Metric'
import { splitStays } from '../features/clients/clientStats'
import { statTiles } from '../features/guest/accountView'
import { useReservationTypes } from '../context/ReservationTypesContext'
import type {
  ClientStayBreakdown,
  GuestRecord,
  PropertyListing,
  ReservationRecord,
} from '../types/domain'
import { formatDisplayDate, toDateInputValue } from '../utils/date'
import '../styles/clients.css'

export function ClientDetailPage() {
  const { clientId = '' } = useParams()
  const navigate = useNavigate()
  const { labelFor } = useReservationTypes()
  const [client, setClient] = useState<GuestRecord | null>(null)
  const [breakdown, setBreakdown] = useState<ClientStayBreakdown | null>(null)
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let ignore = false
    setStatus('loading')
    // The stays endpoint returns stays and numbers only; who the client *is*
    // comes from their own record, which carries the returning flag too.
    Promise.all([fetchGuest(clientId), fetchClientStays(clientId)])
      .then(([record, stays]) => {
        if (ignore) return
        setClient(record)
        setBreakdown(stays)
        setStatus('ready')
      })
      .catch(() => {
        if (!ignore) setStatus('error')
      })
    // Only for the apartment photo on each card; a failure here must not stop
    // the page rendering the stays.
    fetchProperties()
      .then((rows) => {
        if (!ignore) setProperties(rows)
      })
      .catch(() => {})

    return () => {
      ignore = true
    }
  }, [clientId])

  const propertyPhotos = useMemo(
    () => new Map(properties.map((property) => [property.id, property.photoUrl])),
    [properties],
  )

  const today = toDateInputValue(new Date())
  const split = useMemo(
    () => splitStays(breakdown?.stays ?? [], today),
    [breakdown, today],
  )

  if (status === 'loading') return <p className="clients-empty">Loading client…</p>
  if (status === 'error' || !breakdown) {
    return (
      <div className="clients-page">
        <p className="form-error">Could not load this client.</p>
        <button className="pill-button" type="button" onClick={() => navigate('/clients')}>
          <ArrowLeft size={14} /> Back to clients
        </button>
      </div>
    )
  }

  const { stats } = breakdown
  const name = client?.fullName || breakdown.stays[0]?.guestName || 'Client'
  const phone = client?.phone || breakdown.stays.find((s) => s.guestPhone)?.guestPhone || ''
  const email = client?.email || breakdown.stays.find((s) => s.guestEmail)?.guestEmail || ''
  const isReturning = client?.isReturning ?? stats.stays > 1

  return (
    <div className="clients-page client-detail">
      <Link className="client-detail-back" to="/clients">
        <ArrowLeft size={14} /> Back to clients
      </Link>

      <div className="client-detail-head">
        <span className="client-card-avatar client-detail-avatar" aria-hidden="true">
          <UserRound size={26} />
        </span>
        <div>
          <h1 className="page-title">{name}</h1>
          <p className="client-card-contact">
            {phone && (
              <span>
                <Phone size={12} /> {phone}
              </span>
            )}
            {email && (
              <span>
                <Mail size={12} /> {email}
              </span>
            )}
            {isReturning && (
              <span className="returning-badge">
                <RotateCcw size={11} /> Returning guest
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="metric-row">
        {statTiles(stats).map((tile) => (
          <Metric key={tile.label} label={tile.label} value={tile.value} />
        ))}
      </div>

      <p className="client-detail-basis">
        Lifetime totals. {stats.finished.stays} stay{stats.finished.stays === 1 ? '' : 's'} finished
        ({stats.finished.nights} night{stats.finished.nights === 1 ? '' : 's'}), {stats.upcoming.stays}{' '}
        still to come ({stats.upcoming.nights} night{stats.upcoming.nights === 1 ? '' : 's'}).
      </p>

      <StaySection
        emptyText="Nothing booked ahead."
        labelFor={labelFor}
        photos={propertyPhotos}
        stays={split.upcoming}
        title="Upcoming"
      />
      <StaySection
        emptyText="No completed stays yet."
        labelFor={labelFor}
        photos={propertyPhotos}
        stays={split.past}
        title="Past stays"
      />
    </div>
  )
}

/** The reservations page's own card, reused verbatim so the two pages read the
 *  same. The guest is constant here, so the card leads with the apartment
 *  rather than repeating the name at the top of every row. */
function StaySection({
  emptyText,
  labelFor,
  photos,
  stays,
  title,
}: {
  emptyText: string
  labelFor: (code: string) => string
  photos: Map<string, string>
  stays: ReservationRecord[]
  title: string
}) {
  const navigate = useNavigate()

  return (
    <section className="panel">
      <h3 className="stats-section-title">
        {title} ({stays.length})
      </h3>
      {stays.length === 0 ? (
        <p className="clients-empty">{emptyText}</p>
      ) : (
        <div className="search-res-card-list">
          {stays.map((stay) => {
            const photo = photos.get(stay.propertyId)
            return (
              <div className="search-res-card" key={stay.id}>
                {photo ? (
                  <img alt="" className="search-res-card-photo" src={photo} />
                ) : (
                  <span className="search-res-card-photo search-res-card-photo-placeholder" />
                )}

                <div
                  className="search-res-card-main search-res-card-main-clickable"
                  role="button"
                  tabIndex={0}
                  title="Open in reservations"
                  onClick={() => navigate(`/reservations?focus=${stay.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      navigate(`/reservations?focus=${stay.id}`)
                    }
                  }}
                >
                  <strong className="search-res-card-guest">{stay.apartment}</strong>
                  <span className="search-res-card-apt">{stay.apartmentType}</span>
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

                <div className="search-res-card-total money">
                  <strong>{Number(stay.totalPaid).toFixed(0)} EUR</strong>
                  <small>{stay.nightlyPrice} / night</small>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
