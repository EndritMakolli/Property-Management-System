import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { fetchBookingProperties, type PublicProperty } from '../../api/bookingApi'
import { apiGet } from '../../api/client'
import ApartmentDetailModal from '../../components/client/ApartmentDetailModal'
import ClientBookingModal, { type BookingDraft } from '../../components/client/ClientBookingModal'
import type { HomeMarker, MapProperty } from '../../components/client/maps/PropertiesMap'
import { calculateNights } from '../../utils/date'
import { readClientSearch } from '../../utils/clientSearch'
import styles from './MapPage.module.css'

const PropertiesMap = lazy(() => import('../../components/client/maps/PropertiesMap'))

// Public split view: apartment cards on the left, price pins on the map.
export default function MapPage() {
  const [properties, setProperties] = useState<PublicProperty[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PublicProperty | null>(null)
  const [draft, setDraft] = useState<BookingDraft | null>(null)
  const [home, setHome] = useState<HomeMarker | null>(null)
  // One shared building location for every apartment (name, falling back to
  // address) — guests never see a per-apartment locationLabel.
  const [generalLocation, setGeneralLocation] = useState('')
  // Same remembered range as the home page search form.
  const { checkIn, checkOut, guests } = useMemo(readClientSearch, [])

  useEffect(() => {
    let ignore = false
    fetchBookingProperties(checkIn, checkOut)
      .then((rows) => {
        if (!ignore) {
          setProperties(rows)
          setStatus('ready')
        }
      })
      .catch(() => {
        if (!ignore) setStatus('error')
      })
    // The company/building marker, when a location is pinned in the Admin panel.
    apiGet<{
      companyName?: string
      companyLatitude?: string
      companyLongitude?: string
      buildingName?: string
      buildingAddress?: string
    }>('/api/booking/settings/')
      .then((settings) => {
        if (ignore) return
        const lat = Number(settings.companyLatitude)
        const lng = Number(settings.companyLongitude)
        if (Number.isFinite(lat) && Number.isFinite(lng) && settings.companyLatitude && settings.companyLongitude) {
          setHome({ lat, lng, name: settings.companyName || 'Our building' })
        }
        setGeneralLocation(settings.buildingName || settings.buildingAddress || '')
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [checkIn, checkOut])

  const pinnable = useMemo<MapProperty[]>(
    () =>
      properties
        .map((p) => ({ ...p, lat: Number(p.latitude), lng: Number(p.longitude) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.latitude !== '' && p.longitude !== ''),
    [properties],
  )

  function openDetail(property: PublicProperty) {
    setSelectedId(property.id)
    setDetail(property)
  }

  return (
    <div className={styles.page}>
      <div className={styles.listCol}>
        <h1 className={styles.heading}>Our apartments</h1>
        <p className={styles.subheading}>
          {pinnable.length > 0
            ? `${properties.length} apartment${properties.length !== 1 ? 's' : ''} — tap a price on the map or a card to explore.`
            : 'Browse our apartments and find your stay.'}
        </p>

        {status === 'loading' && <p className={styles.empty}>Loading apartments…</p>}
        {status === 'error' && <p className={styles.empty}>Could not load apartments. Try again shortly.</p>}
        {status === 'ready' && properties.length === 0 && <p className={styles.empty}>No apartments published yet.</p>}

        <div className={styles.cards}>
          {properties.map((property) => (
            <button
              key={property.id}
              className={`${styles.card}${selectedId === property.id ? ` ${styles.cardActive}` : ''}`}
              type="button"
              onClick={() => openDetail(property)}
            >
              {property.photos[0] ? (
                <img alt="" className={styles.cardPhoto} loading="lazy" src={property.photos[0]} />
              ) : (
                <span className={styles.cardPhoto} />
              )}
              <span className={styles.cardBody}>
                <span className={styles.cardName}>{property.name}</span>
                <span className={styles.cardMeta}>
                  {generalLocation ? `${generalLocation} · ` : ''}{property.apartmentType}
                </span>
                <span className={styles.cardMeta}>
                  {property.maxGuests} guests · {property.beds} bed{property.beds !== 1 ? 's' : ''} ·{' '}
                  {property.bathrooms} bath{property.bathrooms !== 1 ? 's' : ''}
                </span>
                <span className={styles.cardPrice}>
                  <strong>
                    €{Math.round(Number(property.priceBreakdown?.effective_nightly ?? property.basePriceEur))}
                  </strong>{' '}
                  / night
                  {property.minNights > 1 ? ` · min ${property.minNights} nights` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.mapCol}>
        <Suspense fallback={<p className={styles.empty}>Loading map…</p>}>
          <PropertiesMap home={home} properties={pinnable} selectedId={selectedId} onPinClick={openDetail} />
        </Suspense>
      </div>

      {detail && (
        <ApartmentDetailModal
          property={detail}
          checkIn={checkIn}
          checkOut={checkOut}
          guests={guests}
          generalLocation={generalLocation}
          onClose={() => setDetail(null)}
          onReserve={(ci, co, g, total) => {
            setDraft({ title: detail.name, checkIn: ci, checkOut: co, nights: calculateNights(ci, co), price: total, propertyId: detail.id, guests: g })
            setDetail(null)
          }}
        />
      )}

      {draft && <ClientBookingModal draft={draft} onClose={() => setDraft(null)} onBooked={() => setSelectedId(null)} />}
    </div>
  )
}
