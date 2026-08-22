import { useState, type FormEvent } from 'react'
import { formatDisplayDate } from '../../utils/date'
import { createBookingRequest } from '../../api/bookingApi'
import styles from './ClientBookingModal.module.css'

export interface BookingSegment {
  propertyId: string
  name: string
  checkIn: string
  checkOut: string
  nights: number
  price: number
}

export interface BookingDraft {
  title: string
  checkIn: string
  checkOut: string
  nights: number
  price: number
  guests?: number
  // Present for a single-apartment booking.
  propertyId?: string
  // For split stays: a per-apartment breakdown (each carries its own propertyId).
  segments?: BookingSegment[]
}

interface Props {
  draft: BookingDraft
  onClose: () => void
  // Called after at least one request was submitted, so the page behind the
  // modal can refresh availability instead of showing stale results.
  onBooked?: () => void
}

export default function ClientBookingModal({ draft, onClose, onBooked }: Props) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const guestsCount = draft.guests ?? 1

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    const first = firstName.trim()
    const last = lastName.trim()
    const guestPhone = phone.trim()
    const guestEmail = email.trim()
    if (!first || !last || !guestPhone || !guestEmail) {
      setError('Please enter your name, email address, and phone number.')
      return
    }

    // A split stay books each apartment for the same dates; everything else is a
    // single-apartment request.
    const targets = draft.segments?.length
      ? draft.segments.map((s) => ({ propertyId: s.propertyId, checkIn: s.checkIn, checkOut: s.checkOut }))
      : draft.propertyId
        ? [{ propertyId: draft.propertyId, checkIn: draft.checkIn, checkOut: draft.checkOut }]
        : []

    if (targets.length === 0) {
      setError('This apartment can no longer be booked here. Please refine your search and try again.')
      return
    }

    const guestName = `${first} ${last}`
    setSubmitting(true)
    let submittedCount = 0
    try {
      let lastMessage = ''
      // Sequential so a partial failure stops early and is reportable.
      for (const target of targets) {
        const result = await createBookingRequest({
          propertyId: target.propertyId,
          checkIn: target.checkIn,
          checkOut: target.checkOut,
          guestName,
          guestPhone,
          guestEmail,
          guestsCount,
        })
        submittedCount += 1
        lastMessage = result.message
      }
      setSuccessMessage(lastMessage || 'Your booking request has been received.')
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'We could not submit your request. Please try again.'
      if (submittedCount > 0) {
        const failed = draft.segments?.[submittedCount]?.name
        setError(
          `Your request for ${submittedCount} of ${targets.length} apartments was submitted, but ` +
            `${failed ? `"${failed}"` : 'the next apartment'} failed: ${reason} ` +
            'Please contact us so we can complete the remaining part of your stay.',
        )
      } else {
        setError(reason)
      }
    } finally {
      setSubmitting(false)
      if (submittedCount > 0) onBooked?.()
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>

        {successMessage ? (
          <div className={styles.success}>
            <div className={styles.successIcon}>✓</div>
            <h3>Request received</h3>
            <p>Thanks {firstName} — {successMessage}</p>
            <button className={styles.primaryBtn} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <p className={styles.eyebrow}>Confirm your booking</p>
            <h3 className={styles.title}>{draft.title}</h3>
            <p className={styles.dates}>
              {formatDisplayDate(draft.checkIn)} → {formatDisplayDate(draft.checkOut)} · {draft.nights}{' '}
              {draft.nights === 1 ? 'night' : 'nights'}
            </p>

            {draft.segments && (
              <div className={styles.segments}>
                {draft.segments.map((s, i) => (
                  <div key={i} className={styles.segmentRow}>
                    <span className={styles.segmentIndex}>{i + 1}</span>
                    <div className={styles.segmentInfo}>
                      <strong>{s.name}</strong>
                      <small>
                        {formatDisplayDate(s.checkIn)} → {formatDisplayDate(s.checkOut)} · {s.nights}{' '}
                        {s.nights === 1 ? 'night' : 'nights'}
                      </small>
                    </div>
                    <span className={styles.segmentPrice}>€{s.price}</span>
                  </div>
                ))}
              </div>
            )}

            <form className={styles.form} onSubmit={handleSubmit}>
              <label className={styles.label}>
                First name
                <input
                  className={styles.input}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                  autoComplete="given-name"
                  required
                />
              </label>
              <label className={styles.label}>
                Last name
                <input
                  className={styles.input}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  autoComplete="family-name"
                  required
                />
              </label>
              <label className={styles.label}>
                Email
                <input
                  className={styles.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label className={styles.label}>
                Phone number
                <input
                  className={styles.input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+383 4x xxx xxx"
                  type="tel"
                  autoComplete="tel"
                  required
                />
              </label>

              <div className={styles.totalRow}>
                <span>Total <small>(auto-calculated)</small></span>
                <strong>€{draft.price}</strong>
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                {submitting ? 'Sending…' : 'Request booking'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
