import { useEffect, useState } from 'react'
import { calculateNights, formatDisplayDate } from '../../utils/date'
import {
  fetchBookingPropertyDetail,
  fetchBookingPropertyCalendar,
  calculateBookingPrice,
  type PublicProperty,
  type PublicPropertyDetail,
  type PublicPriceBreakdown,
  type BlockedRange,
} from '../../api/bookingApi'
import AvailabilityCalendar from './AvailabilityCalendar'
import styles from './ApartmentDetailModal.module.css'

interface Props {
  property: PublicProperty
  checkIn: string
  checkOut: string
  guests: number
  onClose: () => void
  onReserve: (checkIn: string, checkOut: string, guests: number, total: number) => void
}

const HOST_NAME = 'AirStay'

const HIGHLIGHTS = [
  { icon: '🔑', title: 'Self check-in', desc: 'Check yourself in with the smart lock.' },
  { icon: '📍', title: 'Great location', desc: 'Recent guests rated the location highly.' },
  { icon: '🗓️', title: 'Free cancellation', desc: 'Cancel before check-in for a partial refund.' },
]

export default function ApartmentDetailModal({
  property, checkIn, checkOut, guests, onClose, onReserve,
}: Props) {
  const [detail, setDetail] = useState<PublicPropertyDetail | null>(null)
  const [showAllPhotos, setShowAllPhotos] = useState(false)

  const [ci, setCi] = useState(checkIn)
  const [co, setCo] = useState(checkOut)
  const [g, setG] = useState(guests)
  const [calOpen, setCalOpen] = useState(false)
  const [blocked, setBlocked] = useState<BlockedRange[]>([])
  const [liveBd, setLiveBd] = useState<PublicPriceBreakdown | null>(property.priceBreakdown)

  useEffect(() => {
    let ignore = false
    fetchBookingPropertyDetail(property.id).then((d) => { if (!ignore) setDetail(d) }).catch(() => {})
    fetchBookingPropertyCalendar(property.id).then((b) => { if (!ignore) setBlocked(b) }).catch(() => {})
    return () => { ignore = true }
  }, [property.id])

  function applyDates(nextCi: string, nextCo: string) {
    setCi(nextCi)
    setCo(nextCo)
    if (nextCi && nextCo) {
      setCalOpen(false)
      calculateBookingPrice(property.id, nextCi, nextCo).then(setLiveBd).catch(() => {})
    }
  }

  const nights = calculateNights(ci, co)
  const hasDates = Boolean(ci && co && nights > 0)

  const bd = liveBd ?? property.priceBreakdown
  const n = Math.max(nights, 1)
  const nightly = Math.round(Number(bd?.effective_nightly ?? property.basePriceEur))
  const subtotal = Math.round(Number(bd?.subtotal ?? nightly * n))
  const total = Math.round(Number(bd?.total ?? subtotal))
  const longStay = Math.round(Number(bd?.long_stay_amount ?? 0))
  const lastMinute = Math.round(Number(bd?.last_minute_amount ?? 0))
  const promo = Math.round(Number(bd?.promo_amount ?? 0))

  const ratingNum = property.rating ? Number(property.rating) : null
  const reviewCount = property.reviewCount
  const amenities = detail?.amenities ?? []
  const reviews = detail?.reviews ?? []
  const description = property.description?.trim() ||
    'A bright, modern apartment finished to a hotel standard, close to everything you need for a comfortable stay.'
  const location = property.locationLabel?.trim() || 'Prishtina, Kosovo'
  const beds = property.beds || 1
  const baths = property.bathrooms || 1
  const maxGuests = property.maxGuests || 8

  const photos = property.photos.length ? property.photos : []
  const mainPhoto = photos[0]
  const sidePhotos = photos.slice(1, 5)

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.topbar}>
          <button className={styles.close} onClick={onClose} aria-label="Close">←</button>
          <div className={styles.topActions}>
            <button>↗ Share</button>
            <button>♡ Save</button>
          </div>
        </div>

        <div className={styles.scroll}>
          <h1 className={styles.title}>{property.name}</h1>
          <div className={styles.subRow}>
            {ratingNum !== null ? (
              <>
                <span className={styles.subStar}>★ {ratingNum.toFixed(2)}</span>
                <span className={styles.dot}>·</span>
                <span className={styles.subUnderline}>{reviewCount} reviews</span>
                <span className={styles.dot}>·</span>
              </>
            ) : (
              <>
                <span className={styles.subStar}>★ New</span>
                <span className={styles.dot}>·</span>
              </>
            )}
            <span className={styles.superhost}>◆ Superhost</span>
            <span className={styles.dot}>·</span>
            <span className={styles.subUnderline}>{location}</span>
          </div>

          {/* Gallery */}
          {mainPhoto ? (
            <div className={sidePhotos.length ? styles.gallery : styles.gallerySingle}>
              <div className={styles.galleryMain} style={{ backgroundImage: `url(${mainPhoto})` }} />
              {sidePhotos.length > 0 && (
                <div className={styles.gallerySide}>
                  {sidePhotos.map((src, i) => (
                    <div key={i} className={styles.galleryCell} style={{ backgroundImage: `url(${src})` }} />
                  ))}
                  {Array.from({ length: Math.max(0, 4 - sidePhotos.length) }).map((_, i) => (
                    <div key={`e${i}`} className={`${styles.galleryCell} ${styles.galleryEmpty}`}>🏠</div>
                  ))}
                </div>
              )}
              <button className={styles.showAll} onClick={() => setShowAllPhotos(true)}>
                ⊞ Show all photos
              </button>
            </div>
          ) : (
            <div className={`${styles.galleryMain} ${styles.gallerySingle} ${styles.galleryEmpty}`}>🏠</div>
          )}

          {/* Body */}
          <div className={styles.bodyGrid}>
            <div className={styles.bodyMain}>
              <div className={styles.hostRow}>
                <div>
                  <h2 className={styles.h2}>Entire apartment hosted by {HOST_NAME}</h2>
                  <p className={styles.specs}>
                    {g} guests · {property.bedrooms} {property.bedrooms === 1 ? 'bedroom' : 'bedrooms'} · {beds} {beds === 1 ? 'bed' : 'beds'} · {baths} {baths === 1 ? 'bath' : 'baths'}
                  </p>
                </div>
                <div className={styles.avatar}>{HOST_NAME[0]}</div>
              </div>

              <hr className={styles.hr} />

              <div className={styles.highlights}>
                {HIGHLIGHTS.map((h) => (
                  <div key={h.title} className={styles.highlight}>
                    <span className={styles.highlightIcon}>{h.icon}</span>
                    <div>
                      <strong>{h.title}</strong>
                      <p>{h.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <hr className={styles.hr} />

              <p className={styles.desc}>{description}</p>

              <hr className={styles.hr} />

              <h2 className={styles.h2}>What this place offers</h2>
              {amenities.length > 0 ? (
                <div className={styles.amenities}>
                  {amenities.map((a) => (
                    <div key={a.id} className={styles.amenity}>
                      <span>{a.icon || '•'}</span> {a.name}
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>Amenities will be listed soon.</p>
              )}
            </div>

            {/* Reserve card */}
            <aside className={styles.reserveWrap}>
              <div className={styles.reserveCard}>
                <div className={styles.priceRow}>
                  <span className={styles.priceBig}>€{nightly}</span>
                  <span className={styles.priceNight}>night</span>
                  {ratingNum !== null && (
                    <span className={styles.reserveStar}>★ {ratingNum.toFixed(2)} · {reviewCount} reviews</span>
                  )}
                </div>

                <div className={styles.reserveDates}>
                  <button type="button" className={styles.reserveCell} onClick={() => setCalOpen((o) => !o)}>
                    <span>Check-in</span>
                    <strong>{ci ? formatDisplayDate(ci) : 'Add date'}</strong>
                  </button>
                  <button type="button" className={styles.reserveCell} onClick={() => setCalOpen((o) => !o)}>
                    <span>Checkout</span>
                    <strong>{co ? formatDisplayDate(co) : 'Add date'}</strong>
                  </button>
                  <label className={`${styles.reserveCell} ${styles.reserveCellFull}`}>
                    <span>Guests</span>
                    <select className={styles.guestSelect} value={g} onChange={(e) => setG(Number(e.target.value))}>
                      {Array.from({ length: maxGuests }, (_, i) => i + 1).map((num) => (
                        <option key={num} value={num}>{num} {num === 1 ? 'guest' : 'guests'}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {calOpen && (
                  <div className={styles.calPop}>
                    <AvailabilityCalendar blocked={blocked} checkIn={ci} checkOut={co} onChange={applyDates} />
                  </div>
                )}

                <button
                  className={styles.reserveBtn}
                  disabled={!hasDates}
                  onClick={() => onReserve(ci, co, g, total)}
                >
                  {hasDates ? 'Reserve' : 'Select dates'}
                </button>
                <p className={styles.noCharge}>You won't be charged yet</p>

                {hasDates && (
                  <div className={styles.breakdown}>
                    <div className={styles.bdRow}>
                      <span className={styles.bdLabel}>€{nightly} × {n} {n === 1 ? 'night' : 'nights'}</span>
                      <span>€{subtotal}</span>
                    </div>
                    {longStay > 0 && (
                      <div className={styles.bdRow}><span className={styles.bdLabel}>Long-stay discount</span><span>−€{longStay}</span></div>
                    )}
                    {lastMinute > 0 && (
                      <div className={styles.bdRow}><span className={styles.bdLabel}>Last-minute discount</span><span>−€{lastMinute}</span></div>
                    )}
                    {promo > 0 && (
                      <div className={styles.bdRow}><span className={styles.bdLabel}>Promo</span><span>−€{promo}</span></div>
                    )}
                    <div className={styles.bdTotal}>
                      <span>Total</span>
                      <span>€{total}</span>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>

          <hr className={styles.hr} />

          {/* Reviews */}
          <h2 className={styles.h2}>
            {ratingNum !== null ? `★ ${ratingNum.toFixed(2)} · ${reviewCount} reviews` : 'Reviews'}
          </h2>
          {reviews.length > 0 ? (
            <div className={styles.reviews}>
              {reviews.map((r) => (
                <div key={r.id} className={styles.review}>
                  <div className={styles.reviewHead}>
                    <div className={styles.reviewAvatar}>{r.guestName[0]}</div>
                    <div>
                      <strong>{r.guestName}</strong>
                      <span>{r.stayLabel || `${'★'.repeat(r.rating)}`}</span>
                    </div>
                  </div>
                  <p>{r.comment}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>No reviews yet — be the first to stay here.</p>
          )}

          <hr className={styles.hr} />

          {/* Location */}
          <h2 className={styles.h2}>Where you'll be</h2>
          <div className={styles.mapBox}>
            <span>📍 {location}</span>
          </div>
        </div>

        {/* Full photo viewer */}
        {showAllPhotos && photos.length > 0 && (
          <div className={styles.allPhotos}>
            <div className={styles.allBar}>
              <button className={styles.allClose} onClick={() => setShowAllPhotos(false)}>← Back</button>
              <span>{photos.length} photo{photos.length === 1 ? '' : 's'}</span>
            </div>
            <div className={styles.allGrid}>
              {photos.map((src, i) => (
                <div key={i} className={styles.allCell}>
                  <img src={src} alt={`${property.name} photo ${i + 1}`} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
