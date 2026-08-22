// A guest's own page: what they booked, what they have stayed, what is next.
//
// Built to read as part of the main site rather than as an admin screen — same
// cream palette, same card shape, same lift on hover. Someone arriving here
// from the home page should not feel they have crossed into a different
// product.
//
// Apartments open the same detail card the home page uses, in place. A guest
// looking at their history is exactly the person most likely to book again, and
// bouncing them to another page to do it loses that.
//
// Nothing here mentions payment: guests pay at the property.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  cancelGuestBooking,
  fetchGuestBookings,
  fetchGuestStats,
} from '../../api/guestAccount'
import { fetchBookingProperties } from '../../api/bookingApi'
import type { PublicProperty } from '../../api/bookingApi'
import ApartmentDetailModal from '../../components/client/ApartmentDetailModal'
import ClientFooter from '../../components/client/ClientFooter'
import ClientBookingModal from '../../components/client/ClientBookingModal'
import type { BookingDraft } from '../../components/client/ClientBookingModal'
import { useBuildingLocation } from '../../components/client/useBuildingLocation'
import { useGuestAuth } from '../../auth/GuestAuthContext'
import { partitionStays, statTiles } from '../../features/guest/accountView'
import type { GuestBooking, GuestStats } from '../../types/domain'
import { calculateNights, formatDisplayDate, toDateInputValue } from '../../utils/date'
import styles from './GuestAccountPage.module.css'

const STATUS_LABEL: Record<GuestBooking['status'], string> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  declined: 'Not available',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

/** A week out, two nights — a starting point the detail card lets them change. */
function defaultStay() {
  const from = new Date()
  from.setDate(from.getDate() + 7)
  const to = new Date(from)
  to.setDate(to.getDate() + 2)
  return { checkIn: toDateInputValue(from), checkOut: toDateInputValue(to) }
}

export function GuestAccountPage() {
  const { account, logout } = useGuestAuth()
  const navigate = useNavigate()
  const building = useBuildingLocation()

  const [bookings, setBookings] = useState<GuestBooking[]>([])
  const [stats, setStats] = useState<GuestStats | null>(null)
  const [properties, setProperties] = useState<PublicProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [detail, setDetail] = useState<PublicProperty | null>(null)
  const [draft, setDraft] = useState<BookingDraft | null>(null)
  const stay = useMemo(defaultStay, [])

  const load = useCallback(async () => {
    const [rows, numbers] = await Promise.all([fetchGuestBookings(), fetchGuestStats()])
    setBookings(rows)
    setStats(numbers)
  }, [])

  useEffect(() => {
    load()
      .catch(() => setError('We could not load your bookings just now.'))
      .finally(() => setLoading(false))
    // Best effort — the page is still useful without the browse strip.
    fetchBookingProperties()
      .then((rows) =>
        setProperties(
          [...rows].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0)).slice(0, 6),
        ),
      )
      .catch(() => {})
  }, [load])

  const today = toDateInputValue(new Date())
  const { upcoming, past } = useMemo(() => partitionStays(bookings, today), [bookings, today])

  async function cancel(booking: GuestBooking) {
    if (!window.confirm('Cancel this booking? We cannot always hold the dates again.')) return
    setBusyId(booking.id)
    setError('')
    try {
      await cancelGuestBooking(booking.id)
      // Refetch both, so the list and the numbers cannot disagree.
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not cancel that booking.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Your account</p>
          <h1 className={styles.heroTitle}>{account.email}</h1>
          <p className={styles.heroSub}>
            Everything you have booked with us, and everything still to come.
          </p>
        </div>

        <div className={styles.heroActions}>
          <button className={styles.browseBtn} type="button" onClick={() => navigate('/')}>
            Browse apartments →
          </button>
          <button
            className={styles.signOut}
            type="button"
            onClick={() => logout().then(() => navigate('/'))}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {stats && (
        <section className={styles.stats}>
          {statTiles(stats).map((tile) => (
            <div className={styles.tile} key={tile.label}>
              <span>{tile.label}</span>
              <strong>{tile.value}</strong>
            </div>
          ))}
        </section>
      )}

      <Section title="Upcoming">
        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className={styles.empty}>
            Nothing booked at the moment — have a look at what is free below.
          </p>
        ) : (
          <div className={styles.stayList}>
            {upcoming.map((booking) => (
              <BookingCard
                booking={booking}
                busy={busyId === booking.id}
                key={booking.id}
                onCancel={() => cancel(booking)}
              />
            ))}
          </div>
        )}
      </Section>

      {past.length > 0 && (
        <Section title="Past stays">
          <div className={styles.stayList}>
            {past.map((booking) => (
              <BookingCard booking={booking} busy={false} key={booking.id} />
            ))}
          </div>
        </Section>
      )}

      {properties.length > 0 && (
        <Section title="Book again">
          <div className={styles.grid}>
            {properties.map((property) => (
              <article
                className={styles.card}
                key={property.id}
                role="button"
                tabIndex={0}
                onClick={() => setDetail(property)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setDetail(property)
                }}
              >
                <div className={styles.cardImg}>
                  {property.photos?.[0] ? (
                    <img alt={property.name} loading="lazy" src={property.photos[0]} />
                  ) : (
                    <span>🏠</span>
                  )}
                </div>
                <div className={styles.cardBody}>
                  <h3>{property.name}</h3>
                  <p>
                    {property.apartmentType}
                    {property.maxGuests ? ` · up to ${property.maxGuests} guests` : ''}
                  </p>
                  {property.rating && <span className={styles.rating}>{property.rating}★</span>}
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}

      {/* The same card the home page opens, right here — a guest looking at
          their history is the person most likely to book again. */}
      {detail && (
        <ApartmentDetailModal
          buildingLatitude={building.latitude}
          buildingLongitude={building.longitude}
          checkIn={stay.checkIn}
          checkOut={stay.checkOut}
          generalLocation={building.label}
          guests={2}
          property={detail}
          onClose={() => setDetail(null)}
          onReserve={(checkIn, checkOut, guests, total) => {
            setDraft({
              title: detail.name,
              checkIn,
              checkOut,
              nights: calculateNights(checkIn, checkOut),
              price: total,
              propertyId: detail.id,
              guests,
            })
            setDetail(null)
          }}
        />
      )}

      </div>

      <ClientFooter />

      {draft && (
        <ClientBookingModal
          draft={draft}
          onClose={() => setDraft(null)}
          // A new request should appear in their list straight away.
          onBooked={() => load().catch(() => {})}
        />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

function BookingCard({
  booking,
  busy,
  onCancel,
}: {
  booking: GuestBooking
  busy: boolean
  onCancel?: () => void
}) {
  return (
    <article className={styles.stay}>
      <div className={styles.stayImg}>
        {booking.property.photoUrl ? (
          <img alt="" src={booking.property.photoUrl} />
        ) : (
          <span>🏠</span>
        )}
      </div>

      <div className={styles.stayBody}>
        <div className={styles.stayTop}>
          <strong>{booking.property.name}</strong>
          <span className={`${styles.status} ${styles[booking.status]}`}>
            {STATUS_LABEL[booking.status]}
          </span>
        </div>

        <p className={styles.dates}>
          {formatDisplayDate(booking.checkIn)} → {formatDisplayDate(booking.checkOut)} ·{' '}
          {booking.nights} night{booking.nights === 1 ? '' : 's'} · {booking.guestsCount} guest
          {booking.guestsCount === 1 ? '' : 's'}
        </p>

        {/* Only ever populated once the booking is confirmed. */}
        {booking.property.address && (
          <p className={styles.address}>
            {booking.property.address}
            {booking.property.floor ? `, ${booking.property.floor}` : ''}
          </p>
        )}

        {booking.declineReason && <p className={styles.reason}>{booking.declineReason}</p>}

        <div className={styles.stayFoot}>
          <span className={styles.price}>€{booking.totalPriceEur}</span>
          <span className={styles.payNote}>paid at the property</span>
          {booking.canCancel && onCancel && (
            <button className={styles.cancel} disabled={busy} type="button" onClick={onCancel}>
              {busy ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
