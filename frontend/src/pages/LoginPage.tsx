import { useState, useEffect, useRef, type RefObject, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { defaultPathForRole } from '../auth/roleAccess'

const SLIDES = [
  {
    eyebrow: 'HOTEL MANAGEMENT PLATFORM',
    headline: ['One Platform.', 'Endless Hospitality.'],
    sub: 'Manage every guest, room, and revenue stream from a single, elegant dashboard.',
  },
  {
    eyebrow: 'NEXT-GENERATION PMS',
    headline: ['Complete Visibility.', 'Total Control.'],
    sub: 'Real-time analytics, reservation intelligence, and operations built for modern hotels.',
  },
]

function useStreakCanvas(canvasRef: RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let animId: number
    let W = 0
    let H = 0

    function resize() {
      W = canvas!.width = window.innerWidth
      H = canvas!.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    function draw(time: number) {
      ctx.fillStyle = 'rgba(5, 5, 16, 0.14)'
      ctx.fillRect(0, 0, W, H)

      const fx = W * 0.07
      const fy = H * 0.68
      const COUNT = 190
      const dist = Math.sqrt(W * W + H * H) * 1.1

      for (let i = 0; i < COUNT; i++) {
        const t = i / COUNT
        const angle = -0.55 + t * 1.85
        const s1 = 0.00028 + t * 0.00018
        const s2 = 0.00019 + t * 0.00012

        const wave1 = Math.sin(time * s1 + t * 7.3) * H * 0.13
        const wave2 = Math.sin(time * s2 + t * 4.8 + 1.2) * H * 0.07

        const ex = fx + Math.cos(angle) * dist
        const ey = fy + Math.sin(angle) * dist

        const cp1x = fx + (ex - fx) * 0.32 + wave1 * 0.2
        const cp1y = fy + (ey - fy) * 0.32 + wave1
        const cp2x = fx + (ex - fx) * 0.64 + wave2 * 0.15
        const cp2y = fy + (ey - fy) * 0.64 + wave2

        const hue = 248 + t * 55
        const pulse = 0.06 + Math.abs(Math.sin(time * 0.00035 + t * 9.1)) * 0.22
        const isFeature = i % 11 === 0
        const alpha = isFeature ? Math.min(pulse * 3.2, 0.85) : pulse
        const lineW = isFeature ? 1.1 + Math.sin(time * 0.0006 + t) * 0.4 : 0.35

        const midX = fx + (ex - fx) * 0.5
        const midY = fy + (ey - fy) * 0.5
        const grad = ctx.createLinearGradient(fx, fy, midX + (ex - fx) * 0.15, midY + (ey - fy) * 0.15)
        grad.addColorStop(0, `hsla(${hue}, 85%, 72%, 0)`)
        grad.addColorStop(0.18, `hsla(${hue}, 85%, 72%, ${alpha * 0.6})`)
        grad.addColorStop(0.5, `hsla(${hue}, 90%, 75%, ${alpha})`)
        grad.addColorStop(0.78, `hsla(${hue + 18}, 80%, 68%, ${alpha * 0.55})`)
        grad.addColorStop(1, `hsla(${hue + 35}, 70%, 62%, 0)`)

        ctx.beginPath()
        ctx.moveTo(fx, fy)
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey)
        ctx.strokeStyle = grad
        ctx.lineWidth = lineW
        ctx.stroke()
      }

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [canvasRef])
}

export function LoginPage() {
  const { login, user } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [slideIndex, setSlideIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useStreakCanvas(canvasRef)

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setSlideIndex(i => (i + 1) % SLIDES.length)
        setVisible(true)
      }, 550)
    }, 5500)
    return () => clearInterval(id)
  }, [])

  if (user.isAuthenticated) {
    return <Navigate replace to={defaultPathForRole(user.role)} />
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    try {
      await login(username, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in.')
    }
  }

  const slide = SLIDES[slideIndex]

  return (
    <main className="lp-root">
      <canvas ref={canvasRef} className="lp-canvas" />

      <nav className="lp-nav">
        <div className="lp-logo">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <polygon points="9,1 17,5 17,13 9,17 1,13 1,5" stroke="#a78bfa" strokeWidth="1.4" fill="none"/>
            <polygon points="9,5 13,7 13,11 9,13 5,11 5,7" fill="#a78bfa" opacity="0.5"/>
          </svg>
          <span>LUXE PMS</span>
        </div>
        <div className="lp-nav-links">
          <span>Properties</span>
          <span className="lp-dot-sep">·</span>
          <span>Reservations</span>
          <span className="lp-dot-sep">·</span>
          <span>Analytics</span>
        </div>
        <div className="lp-nav-badge">Staff Portal</div>
      </nav>

      <div className="lp-hero">
        <div className={`lp-slide ${visible ? 'lp-slide--in' : 'lp-slide--out'}`}>
          <p className="lp-eyebrow">
            <span className="lp-eyebrow-gem" />
            {slide.eyebrow}
          </p>
          <h1 className="lp-headline">
            {slide.headline.map((line, i) => (
              <span key={i} className="lp-headline-line">{line}</span>
            ))}
          </h1>
          <p className="lp-sub">{slide.sub}</p>
          <div className="lp-indicators">
            {SLIDES.map((_, i) => (
              <span key={i} className={`lp-indicator ${i === slideIndex ? 'lp-indicator--active' : ''}`} />
            ))}
          </div>
        </div>

        <form className="lp-card" onSubmit={submitLogin}>
          <div className="lp-card-top">
            <p className="lp-card-eyebrow">Staff Access</p>
            <h2 className="lp-card-title">Sign in to PMS</h2>
            <p className="lp-card-sub">Enter your credentials to access the hotel management dashboard.</p>
          </div>

          {error && <p className="lp-error">{error}</p>}

          <label className="lp-label">
            Username
            <input
              className="lp-input"
              autoComplete="username"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="your.username"
            />
          </label>

          <label className="lp-label">
            Password
            <input
              className="lp-input"
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          <button className="lp-btn" type="submit">
            Access Dashboard
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="lp-btn-arrow">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
      </div>

      <footer className="lp-footer">
        <span>© 2026 Luxe PMS · Hotel Management Platform</span>
        <span>Secure · Encrypted · GDPR Compliant</span>
      </footer>
    </main>
  )
}
