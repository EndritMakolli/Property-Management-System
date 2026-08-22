import { useStreakCanvas } from './auth/useStreakCanvas'
import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth, type PendingTwoFactor } from '../auth/AuthContext'
import { defaultPathForRole } from '../auth/roleAccess'
import { resendLoginCode } from '../api/pmsApi'

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

export function LoginPage() {
  const { login, verifyCode, user } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [slideIndex, setSlideIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Second factor: set once the password step reports a pending challenge.
  const [pending, setPending] = useState<PendingTwoFactor | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

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

  // `user.role` as well as isAuthenticated: a session with no role resolves to
  // /staff-login, which is this page — redirecting to it would loop.
  if (user.isAuthenticated && user.role) {
    return <Navigate replace to={defaultPathForRole(user.role)} />
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const challenge = await login(username, password)
      if (challenge) {
        setPending(challenge)
        setPassword('') // the password is done — don't keep it in memory
        setNotice(`We sent a 6-digit code to ${challenge.emailHint || 'your verification email'}.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in.')
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pending) return
    setError('')
    setBusy(true)
    try {
      await verifyCode(pending.challengeToken, code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the code.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function requestNewCode() {
    if (!pending) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const result = await resendLoginCode(pending.challengeToken)
      if (result.challengeToken) {
        setPending({ ...pending, challengeToken: result.challengeToken })
      }
      setCode('')
      setNotice('If that request is still valid, a new code is on its way.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a new code.')
    } finally {
      setBusy(false)
    }
  }

  function cancelTwoFactor() {
    setPending(null)
    setCode('')
    setError('')
    setNotice('')
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

        {pending ? (
          <form className="lp-card" onSubmit={submitCode}>
            <div className="lp-card-top">
              <p className="lp-card-eyebrow">Two-Step Verification</p>
              <h2 className="lp-card-title">Enter your code</h2>
              <p className="lp-card-sub">
                For your security we emailed a 6-digit code to{' '}
                <strong>{pending.emailHint || 'your verification address'}</strong>. It expires in
                10 minutes.
              </p>
            </div>

            {error && <p className="lp-error">{error}</p>}
            {notice && <p className="lp-notice">{notice}</p>}

            <label className="lp-label">
              Verification code
              <input
                className="lp-input lp-input--code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
              />
            </label>

            <button className="lp-btn" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Verifying…' : 'Verify and continue'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="lp-btn-arrow">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <div className="lp-2fa-actions">
              <button type="button" className="lp-link-btn" disabled={busy} onClick={requestNewCode}>
                Send a new code
              </button>
              <button type="button" className="lp-link-btn" onClick={cancelTwoFactor}>
                Use a different account
              </button>
            </div>
          </form>
        ) : (
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

            <button className="lp-btn" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Access Dashboard'}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="lp-btn-arrow">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </form>
        )}
      </div>

      <footer className="lp-footer">
        <span>© 2026 Luxe PMS · Hotel Management Platform</span>
        <span>Secure · Encrypted · GDPR Compliant</span>
      </footer>
    </main>
  )
}
