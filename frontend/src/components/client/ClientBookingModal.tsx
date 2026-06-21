import { useState, type FormEvent } from 'react'
import { formatDisplayDate } from '../../utils/date'
import styles from './ClientBookingModal.module.css'

export interface BookingDraft {
  title: string
  checkIn: string
  checkOut: string
  nights: number
  price: number
  // For split stays: a per-apartment breakdown.
  segments?: { name: string; checkIn: string; checkOut: string; nights: number; price: number }[]
}

interface Props {
  draft: BookingDraft
  onClose: () => void
}

export default function ClientBookingModal({ draft, onClose }: Props) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) return
    // Placeholder — no backend call yet.
    setSubmitted(true)
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>

        {submitted ? (
          <div className={styles.success}>
            <div className={styles.successIcon}>✓</div>
            <h3>Request received</h3>
            <p>
              Thanks {name.split(' ')[0]} — we'll call you on {phone} shortly to confirm your stay.
            </p>
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
                Full name
                <input
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
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
                  required
                />
              </label>

              <div className={styles.totalRow}>
                <span>Total <small>(auto-calculated)</small></span>
                <strong>€{draft.price}</strong>
              </div>

              <button type="submit" className={styles.primaryBtn}>
                Request booking
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
