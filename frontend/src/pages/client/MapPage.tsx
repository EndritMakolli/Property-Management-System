import { formatBaths } from '../../utils/formatBaths'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { fetchBookingProperties, type PublicProperty } from '../../api/bookingApi'
import { useBuildingLocation } from '../../components/client/useBuildingLocation'
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
  // Same remembered range as the home page search form.
  const { checkIn, checkOut, guests } = useMemo(readClientSearch, [])
  // One shared building location for every apartment — guests never see a
  // per-apartment locationLabel, and the detail panel maps the same point.
  const building = useBuildingLocation()
  const home: HomeMarker | null =
    building.latitude !== null && building.longitude !== null
      ? { lat: building.latitude, lng: building.longitude, name: building.name }
      : null

  useEffect(() => {
    let ignore = false
    fetchBookingProperties(checkIn, checkOut, guests)
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
    return () => {
      ignore = true
    }
  }, [checkIn, checkOut, guests])

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
                  {building.label ? `${building.label} · ` : ''}{property.apartmentType}
                </span>
                <span className={styles.cardMeta}>
                  {property.maxGuests} guests · {property.beds} bed{property.beds !== 1 ? 's' : ''} ·{' '}
                  {formatBaths(property.bathrooms)}
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
          generalLocation={building.label}
          buildingLatitude={building.latitude}
          buildingLongitude={building.longitude}
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
