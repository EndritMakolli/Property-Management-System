// Guest sign-in: type your email, get a link, click it.
//
// No password, so there is none to store, reset or leak — and a guest who books
// once a year has nothing to forget.
//
// The screen deliberately never says whether an address is known. The server
// answers identically either way, and repeating that answer here is the point:
// "we have no booking for you" would turn this page into a way to ask whether
// someone else has stayed here.

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useGuestAuth } from '../../auth/GuestAuthContext'
import { useStreakCanvas } from '../auth/useStreakCanvas'

// Blue rather than the staff violet. Same motion, different family colour.
const GUEST_HUE = 205

export function GuestLoginPage() {
  const { account, checking, requestLink, verifyToken } = useGuestAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useStreakCanvas(canvasRef, GUEST_HUE)

  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // A link is single use. StrictMode double-invokes mount effects in
  // development, which would spend the token and then report failure on a link
  // that had just worked — hence the latch.
  const redeemed = useRef(false)
  const token = params.get('token')

  useEffect(() => {
    if (!token || redeemed.current) return
    redeemed.current = true
    setBusy(true)
    verifyToken(token)
      .then(() => navigate('/account', { replace: true }))
      .catch(() =>
        setError('This sign-in link is no longer valid. Please request a new one.'),
      )
      .finally(() => setBusy(false))
  }, [token, verifyToken, navigate])

  if (!checking && account.isAuthenticated && !token) {
    return <Navigate replace to="/account" />
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await requestLink(email.trim())
      // Shown whatever the server said. There is nothing to branch on.
      setSent(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="lp-root lp-root--guest">
      <canvas className="lp-canvas" ref={canvasRef} />

      <nav className="lp-nav">
        <button className="lp-logo" onClick={() => navigate('/')} type="button">
          AirStay
        </button>
        <span className="lp-nav-badge">Guest Portal</span>
      </nav>

      <div className="lp-hero">
        <div className="lp-slide lp-slide--in">
          <p className="lp-eyebrow">
            <i className="lp-eyebrow-gem" /> Your bookings
          </p>
          <h1 className="lp-headline">
            <span className="lp-headline-line">Everything you</span>
            <span className="lp-headline-line">booked with us</span>
          </h1>
          <p className="lp-sub">
            Sign in to see your stays, past and upcoming, and cancel one if your
            plans change.
          </p>
        </div>

        <form className="lp-card" onSubmit={submit}>
          <div className="lp-card-top">
            <p className="lp-card-eyebrow">Guest access</p>
            <h2 className="lp-card-title">Sign in</h2>
            <p className="lp-card-sub">
              We will email you a link. No password needed.
            </p>
          </div>

          {error && <p className="lp-error">{error}</p>}

          {sent ? (
            <>
              <p className="lp-notice">
                If that address has a booking with us, a sign-in link is on its
                way. It works once and expires in 20 minutes.
              </p>
              <button
                className="lp-link-btn"
                type="button"
                onClick={() => {
                  setSent(false)
                  setEmail('')
                }}
              >
                Use a different address
              </button>
            </>
          ) : (
            <>
              <label className="lp-label" htmlFor="guest-email">
                Email address
              </label>
              <input
                autoComplete="email"
                className="lp-input"
                id="guest-email"
                placeholder="you@example.com"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button className="lp-btn" disabled={busy || !email.trim()} type="submit">
                {busy ? 'Sending…' : 'Email me a link'}
                <span className="lp-btn-arrow">→</span>
              </button>
            </>
          )}
        </form>

        <p className="lp-card-alt">
          Work here?{' '}
          <button type="button" onClick={() => navigate('/staff-login')}>
            Staff sign-in
          </button>
        </p>
      </div>

      <footer className="lp-footer">© 2026 AirStay</footer>
    </main>
  )
}
