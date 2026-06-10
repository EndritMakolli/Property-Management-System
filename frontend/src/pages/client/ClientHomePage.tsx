import { useEffect, useRef, useState, type RefObject } from 'react'
import SearchForm from '../../components/client/SearchForm'
import PropertyCard from '../../components/client/PropertyCard'
import { PLACEHOLDER_PROPERTIES } from './clientData'
import styles from './ClientHomePage.module.css'

const SLIDES = [
  {
    eyebrow: 'PREMIUM APARTMENTS',
    headline: ['Explore your', 'perfect stay.'],
    sub: 'Real-time availability, premium apartments, best rates guaranteed — no platform fees.',
  },
  {
    eyebrow: 'DIRECT BOOKING',
    headline: ['Skip the fees.', 'Book direct.'],
    sub: "Unlock exclusive rates and long-stay deals you won't find on Airbnb or Booking.com.",
  },
]

const FEATURES = [
  { num: '01', title: 'See it all', desc: 'Browse every available apartment with real-time availability, photos, and pricing — all in one place.' },
  { num: '02', title: 'Book direct', desc: 'Skip Airbnb and Booking.com fees. Get the same quality stay at a lower price, direct from the host.' },
  { num: '03', title: 'Exclusive rates', desc: "Direct bookings unlock special discounts and long-stay deals you won't find on any other platform." },
]

const PROPERTY_TYPES = [
  { label: 'Studios', emoji: '🏢' },
  { label: '1 Bedroom', emoji: '🛏️' },
  { label: '2 Bedrooms', emoji: '🏠' },
  { label: 'Luxury', emoji: '✨' },
  { label: 'Suites', emoji: '🏨' },
]

const DESTINATIONS = ['Prishtina', 'Prizren', 'Peja', 'Gjakova']

function useStreakCanvas(
  canvasRef: RefObject<HTMLCanvasElement>,
  scrollRef: RefObject<number>,
) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let animId: number
    let W = 0, H = 0

    function resize() {
      W = canvas!.width = window.innerWidth
      H = canvas!.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    function draw(time: number) {
      const scrollY = scrollRef.current ?? 0

      ctx.fillStyle = 'rgba(4, 8, 16, 0.16)'
      ctx.fillRect(0, 0, W, H)

      // Focal point drifts slowly (moving light angles) + reacts to scroll.
      const tOsc = time * 0.00018
      const fx = W * (0.08 + Math.sin(tOsc * 0.55) * 0.032)
      const fy = H * (0.70 + Math.cos(tOsc * 0.78) * 0.07) - scrollY * 0.12

      const COUNT = 210
      const dist = Math.sqrt(W * W + H * H) * 1.1
      const angleSweep = Math.sin(tOsc * 0.38) * 0.14
      const scrollFactor = Math.min(scrollY / Math.max(H, 1), 1)

      for (let i = 0; i < COUNT; i++) {
        const t = i / COUNT
        const start = -0.55 + angleSweep - scrollFactor * 0.12
        const end = 1.85 + angleSweep + scrollFactor * 0.18
        const angle = start + t * (end - start)

        const s1 = 0.00026 + t * 0.00016
        const s2 = 0.00017 + t * 0.00011
        const wave1 = Math.sin(time * s1 + t * 7.3) * H * 0.12
        const wave2 = Math.sin(time * s2 + t * 4.8 + 1.2) * H * 0.065

        const ex = fx + Math.cos(angle) * dist
        const ey = fy + Math.sin(angle) * dist
        const cp1x = fx + (ex - fx) * 0.32 + wave1 * 0.2
        const cp1y = fy + (ey - fy) * 0.32 + wave1
        const cp2x = fx + (ex - fx) * 0.64 + wave2 * 0.15
        const cp2y = fy + (ey - fy) * 0.64 + wave2

        // Blue / cyan palette.
        const hue = 195 + t * 45
        const pulse = 0.05 + Math.abs(Math.sin(time * 0.00032 + t * 9.1)) * 0.20
        const isFeature = i % 10 === 0
        const alpha = isFeature ? Math.min(pulse * 3.5, 0.9) : pulse
        const lineW = isFeature ? 1.3 + Math.sin(time * 0.0005 + t) * 0.4 : 0.35

        const midX = fx + (ex - fx) * 0.5
        const midY = fy + (ey - fy) * 0.5
        const grad = ctx.createLinearGradient(
          fx, fy,
          midX + (ex - fx) * 0.15, midY + (ey - fy) * 0.15,
        )

        if (isFeature) {
          grad.addColorStop(0,    `hsla(${hue}, 100%, 95%, 0)`)
          grad.addColorStop(0.15, `hsla(${hue}, 100%, 90%, ${alpha * 0.5})`)
          grad.addColorStop(0.45, `hsla(${hue}, 95%, 82%, ${alpha})`)
          grad.addColorStop(0.72, `hsla(${hue + 15}, 85%, 70%, ${alpha * 0.5})`)
          grad.addColorStop(1,    `hsla(${hue + 30}, 75%, 60%, 0)`)
        } else {
          grad.addColorStop(0,    `hsla(${hue}, 85%, 70%, 0)`)
          grad.addColorStop(0.2,  `hsla(${hue}, 85%, 70%, ${alpha * 0.55})`)
          grad.addColorStop(0.5,  `hsla(${hue}, 90%, 72%, ${alpha})`)
          grad.addColorStop(0.78, `hsla(${hue + 18}, 80%, 65%, ${alpha * 0.5})`)
          grad.addColorStop(1,    `hsla(${hue + 35}, 70%, 60%, 0)`)
        }

        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey)
        ctx.strokeStyle = grad
        ctx.lineWidth = lineW
        ctx.stroke()
      }

      // Soft radial glow at the focal point.
      const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, W * 0.18)
      glow.addColorStop(0, 'rgba(56, 189, 248, 0.14)')
      glow.addColorStop(0.4, 'rgba(14, 165, 233, 0.06)')
      glow.addColorStop(1, 'rgba(56, 189, 248, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])
}

export default function ClientHomePage() {
  const [slideIndex, setSlideIndex] = useState(0)
  const [slideVisible, setSlideVisible] = useState(true)
  const carouselRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef(0)

  useStreakCanvas(canvasRef, scrollRef)

  useEffect(() => {
    function onScroll() { scrollRef.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setSlideVisible(false)
      setTimeout(() => {
        setSlideIndex((i) => (i + 1) % SLIDES.length)
        setSlideVisible(true)
      }, 550)
    }, 5500)
    return () => clearInterval(id)
  }, [])

  function scrollCarousel(dir: -1 | 1) {
    if (!carouselRef.current) return
    carouselRef.current.scrollBy({ left: dir * 280, behavior: 'smooth' })
  }

  const [email, setEmail] = useState('')
  const slide = SLIDES[slideIndex]

  return (
    <div className={styles.root}>
      {/* Fixed canvas behind the entire page */}
      <canvas ref={canvasRef} className={styles.globalCanvas} />

      {/* ── Hero ── */}
      <section className={styles.hero}>
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <div className={styles.heroLeft}>
            <div className={`${styles.heroSlide} ${slideVisible ? styles.slideIn : styles.slideOut}`}>
              <p className={styles.heroEyebrow}>
                <span className={styles.eyebrowGem} />
                {slide.eyebrow}
              </p>
              <h1 className={styles.heroTitle}>
                {slide.headline.map((line, i) => (
                  <span key={i} className={styles.heroTitleLine}>{line}</span>
                ))}
              </h1>
              <p className={styles.heroSub}>{slide.sub}</p>
            </div>

            <div className={styles.heroSearchBar}>
              <SearchForm />
            </div>

            <div className={styles.heroIndicators}>
              {SLIDES.map((_, i) => (
                <span
                  key={i}
                  className={`${styles.indicator} ${i === slideIndex ? styles.indicatorActive : ''}`}
                />
              ))}
            </div>
          </div>

          <div className={styles.heroRight}>
            <p className={styles.heroTagline}>Premium apartments, unbeatable comfort.</p>
            <p className={styles.heroTaglineSub}>Direct bookings · Best rates guaranteed</p>
          </div>
        </div>
      </section>

      {/* ── Apartments carousel ── */}
      <section className={styles.apartmentsSection}>
        <div className="container">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>Available now</p>
              <h2 className={styles.sectionTitle}>Apartments in your area</h2>
            </div>
            <button className={styles.seeAllBtn}>See all →</button>
          </div>

          <div className={styles.carouselWrap}>
            <button className={`${styles.carouselArrow} ${styles.carouselPrev}`} onClick={() => scrollCarousel(-1)} aria-label="Previous">‹</button>
            <div className={styles.carousel} ref={carouselRef}>
              {PLACEHOLDER_PROPERTIES.map((p) => <PropertyCard key={p.id} property={p} />)}
            </div>
            <button className={`${styles.carouselArrow} ${styles.carouselNext}`} onClick={() => scrollCarousel(1)} aria-label="Next">›</button>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className={styles.featuresSection}>
        <div className="container">
          <div className={styles.featuresGrid}>
            {FEATURES.map((f) => (
              <div key={f.num} className={styles.featureItem}>
                <div className={styles.featureNumber}>{f.num}</div>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Browse by type ── */}
      <section className={styles.browseSection}>
        <div className="container">
          <div className={styles.browseSplit}>
            <div className={styles.browseLeft}>
              <p className={styles.sectionEyebrow}>Filter by category</p>
              <h2>Browse by property type</h2>
              <p>
                Select apartments based on your preferences — studios, luxury suites, or multi-bedroom homes for every stay.
              </p>
            </div>
            <div className={styles.browseYear}>2018–2025</div>
          </div>

          <div className={styles.typeGrid}>
            {PROPERTY_TYPES.map((t) => (
              <div key={t.label} className={styles.typeCard} role="button" tabIndex={0}>
                <div className={styles.typePlaceholder}>{t.emoji}</div>
                <div className={styles.typeOverlay} />
                <span className={styles.typeLabel}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className={styles.ctaSection}>
        <div className="container">
          <div className={styles.ctaSplit}>
            <div className={styles.ctaLeft}>
              <p className={styles.sectionEyebrow}>Stay in the loop</p>
              <h2>Never miss a great stay</h2>
              <p>
                Get notified about exclusive deals, new apartments, and last-minute availability. Subscribe and save.
              </p>
              <form className={styles.ctaForm} onSubmit={(e) => { e.preventDefault(); setEmail('') }}>
                <input
                  className={styles.ctaInput}
                  type="email"
                  placeholder="Your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button type="submit" className={styles.ctaSubmit}>Subscribe</button>
              </form>
            </div>

            <div className={styles.ctaRight}>
              <h3>Trending destinations</h3>
              <div className={styles.destinationsGrid}>
                {DESTINATIONS.map((city) => (
                  <div key={city} className={styles.destinationCard} role="button" tabIndex={0}>
                    <div className={styles.destinationPlaceholder}>🏙️</div>
                    <span className={styles.destinationName}>{city}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
