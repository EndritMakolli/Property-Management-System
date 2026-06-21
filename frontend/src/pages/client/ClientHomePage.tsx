import { useEffect, useRef, useState, type FormEvent } from 'react'
import { calculateNights, formatDisplayDate, toDateInputValue } from '../../utils/date'
import {
  fetchBookingAvailability,
  type AvailabilityResponse,
  type PublicProperty,
} from '../../api/bookingApi'
import ClientBookingModal, { type BookingDraft } from '../../components/client/ClientBookingModal'
import ApartmentDetailModal from '../../components/client/ApartmentDetailModal'
import styles from './ClientHomePage.module.css'

const FEATURES = [
  { num: '01', title: 'Direct booking', desc: 'Book straight with us — no Airbnb or Booking.com fees, just the best rate for your stay.' },
  { num: '02', title: 'Premium comfort', desc: 'Modern, fully-equipped apartments cleaned to hotel standards and ready the moment you arrive.' },
  { num: '03', title: 'Always available', desc: 'Real-time availability and instant confirmation, with a local team a message away around the clock.' },
]

function defaultRange() {
  const a = new Date()
  a.setDate(a.getDate() + 2)
  const b = new Date()
  b.setDate(b.getDate() + 5)
  return { checkIn: toDateInputValue(a), checkOut: toDateInputValue(b) }
}

function priceOf(property: PublicProperty) {
  return Math.round(Number(property.priceBreakdown?.total ?? property.basePriceEur))
}

export default function ClientHomePage() {
  const fallback = defaultRange()
  const [checkIn, setCheckIn] = useState(fallback.checkIn)
  const [checkOut, setCheckOut] = useState(fallback.checkOut)
  const [guests, setGuests] = useState(2)
  const [email, setEmail] = useState('')

  const [result, setResult] = useState<AvailabilityResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [draft, setDraft] = useState<BookingDraft | null>(null)
  const [detail, setDetail] = useState<PublicProperty | null>(null)

  const resultsRef = useRef<HTMLDivElement>(null)

  function runSearch(ci: string, co: string, g: number) {
    setStatus('loading')
    setErrorMsg('')
    fetchBookingAvailability(ci, co, g)
      .then((data) => { setResult(data); setStatus('ready') })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : 'Could not load availability.')
        setStatus('error')
      })
  }

  // Initial availability so apartments show right away.
  useEffect(() => {
    runSearch(fallback.checkIn, fallback.checkOut, 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    runSearch(checkIn, checkOut, guests)
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function scrollToResults() {
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const today = new Date().toISOString().split('T')[0]
  const heroPhoto = '/cover.jpg'
  const welcomePhoto = '/welcome.png'

  const available = result?.available ?? []
  const combinations = result?.combinations ?? []
  const nights = result?.nights ?? 0

  return (
    <div className={styles.root}>
      {/* ── Hero ── */}
      <section className={styles.hero}>
        <div
          className={styles.heroBg}
          style={heroPhoto ? { backgroundImage: `url(${heroPhoto})` } : undefined}
        />
        <div className={styles.heroOverlay} />

        <div className={styles.heroInner}>
          <div className={styles.rating}>
            <span className={styles.stars}>★★★★★</span>
            <span className={styles.score}>(5.0)</span>
          </div>
          <h1 className={styles.heroTitle}>
            Luxury Living,<br />One Booking Away
          </h1>
          <button className={styles.exploreBtn} onClick={scrollToResults}>
            Explore Now
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Search bar overlapping the hero bottom */}
        <form className={styles.searchBar} onSubmit={submitSearch}>
          <label className={styles.searchField}>
            <span className={styles.searchLabel}>Arrival Date</span>
            <input type="date" min={today} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </label>
          <div className={styles.searchDivider} />
          <label className={styles.searchField}>
            <span className={styles.searchLabel}>Departure Date</span>
            <input type="date" min={checkIn || today} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </label>
          <div className={styles.searchDivider} />
          <label className={styles.searchField}>
            <span className={styles.searchLabel}>Number of People</span>
            <select value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n} {n === 1 ? 'person' : 'people'}</option>
              ))}
            </select>
          </label>
          <button type="submit" className={styles.bookBtn}>
            Book A Hotel
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </section>

      {/* ── Availability results ── */}
      <section className={styles.results} ref={resultsRef}>
        <div className={styles.sectionInner}>
          <div className={styles.apHead}>
            <div>
              <p className={styles.eyebrow}>Available now</p>
              <h2 className={styles.apTitle}>Apartments in your area</h2>
            </div>
            {status === 'ready' && (
              <span className={styles.summary}>
                <strong>{available.length}</strong> available for {nights} {nights === 1 ? 'night' : 'nights'}
              </span>
            )}
          </div>

          {status === 'loading' ? (
            <p className={styles.notice}>Searching for apartments…</p>
          ) : status === 'error' ? (
            <p className={styles.notice}>{errorMsg}</p>
          ) : (
            <>
              {available.length > 0 && (
                <div className={styles.resultsGrid}>
                  {available.map(({ property: p }) => {
                    const price = priceOf(p)
                    const photo = p.photos[0]
                    return (
                      <article
                        className={styles.resCard}
                        key={p.id}
                        onClick={() => setDetail(p)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') setDetail(p) }}
                      >
                        <div className={styles.resImg}>
                          {photo ? <img src={photo} alt={p.name} loading="lazy" /> : <span>🏠</span>}
                        </div>
                        <div className={styles.resBody}>
                          <h3 className={styles.resName}>{p.name}</h3>
                          <p className={styles.resMeta}>
                            {p.apartmentType}{p.maxGuests ? ` · up to ${p.maxGuests} guests` : ''}
                          </p>
                          <div className={styles.resFoot}>
                            <div className={styles.priceBlock}>
                              <span className={styles.price}>€{price}</span>
                              <span className={styles.priceSub}> · {nights} {nights === 1 ? 'night' : 'nights'}</span>
                            </div>
                            <button
                              className={styles.resBookBtn}
                              onClick={(e) => { e.stopPropagation(); setDraft({ title: p.name, checkIn, checkOut, nights, price }) }}
                            >
                              Book
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}

              {/* Split stay */}
              {available.length === 0 && combinations.length > 0 && (
                <div className={styles.splitSection}>
                  <p className={styles.splitLead}>No single apartment fits your group — combine apartments:</p>
                  {combinations.map((combo, ci) => {
                    const total = Math.round(Number(combo.combinedTotal))
                    const segments = combo.apartments.map(({ property: a }) => ({
                      name: a.name, checkIn, checkOut, nights, price: priceOf(a),
                    }))
                    return (
                      <div className={styles.splitCombo} key={ci}>
                        <div className={styles.splitRoute}>
                          {segments.map((s, i) => (
                            <div className={styles.splitSegment} key={`${s.name}-${i}`}>
                              <span className={styles.splitIndex}>{i + 1}</span>
                              <div>
                                <strong>{s.name}</strong>
                                <p>{formatDisplayDate(checkIn)} → {formatDisplayDate(checkOut)} · {nights} {nights === 1 ? 'night' : 'nights'}</p>
                              </div>
                              <span className={styles.splitPrice}>€{s.price}</span>
                            </div>
                          ))}
                        </div>
                        <div className={styles.splitFoot}>
                          <div className={styles.priceBlock}>
                            <span className={styles.price}>€{total}</span>
                            <span className={styles.priceSub}> total · {combo.apartments.length} apartments</span>
                          </div>
                          <button
                            className={styles.resBookBtn}
                            onClick={() => setDraft({ title: 'Split stay', checkIn, checkOut, nights, price: total, segments })}
                          >
                            Book split stay
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {available.length === 0 && combinations.length === 0 && (
                <p className={styles.notice}>No apartments are available for these dates. Try a different range.</p>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Welcome ── */}
      <section className={styles.welcome}>
        <div className={styles.welcomeInner}>
          <div className={styles.welcomeText}>
            <p className={styles.eyebrow}>Welcome to AirStay</p>
            <h2 className={styles.welTitle}>Premium apartments in the heart of the city</h2>
            <p className={styles.welPara}>
              AirStay brings together comfort, location, and value in a curated collection of modern apartments.
              Whether you are visiting for business or leisure, every stay is finished to a hotel standard and
              booked directly with us — so you always get the best rate.
            </p>
            <button className={styles.moreBtn} onClick={scrollToResults}>View Apartments</button>
          </div>
          <div
            className={styles.welcomePhoto}
            style={welcomePhoto ? { backgroundImage: `url(${welcomePhoto})` } : undefined}
          />
        </div>
      </section>

      {/* ── Why book direct ── */}
      <section className={styles.features}>
        <div className={styles.sectionInner}>
          <div className={styles.featuresGrid}>
            {FEATURES.map((f) => (
              <div key={f.num} className={styles.featureItem}>
                <span className={styles.featureNum}>{f.num}</span>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Newsletter ── */}
      <section className={styles.cta}>
        <div className={styles.sectionInner}>
          <div className={styles.ctaInner}>
            <div>
              <h2 className={styles.ctaTitle}>Stay in the know</h2>
              <p className={styles.ctaSub}>Exclusive deals, new apartments and last-minute availability — straight to your inbox.</p>
            </div>
            <form className={styles.ctaForm} onSubmit={(e) => { e.preventDefault(); setEmail('') }}>
              <input
                className={styles.ctaInput}
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className={styles.ctaBtn}>Subscribe</button>
            </form>
          </div>
        </div>
      </section>

      {detail && (
        <ApartmentDetailModal
          property={detail}
          checkIn={checkIn}
          checkOut={checkOut}
          guests={guests}
          onClose={() => setDetail(null)}
          onReserve={(ci, co, _g, total) => {
            setDraft({ title: detail.name, checkIn: ci, checkOut: co, nights: calculateNights(ci, co), price: total })
            setDetail(null)
          }}
        />
      )}

      {draft && <ClientBookingModal draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}
