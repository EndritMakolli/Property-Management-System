// The email the guest gets when their request is decided.
//
// Opens straight after approving or declining, with the wording already filled
// in from the template. Nothing is sent automatically: the draft is read and
// edited first, and Send is a deliberate press. Skipping it is allowed — the
// booking is already decided either way.
//
// Unlike the availability replies, which staff copy into WhatsApp, this really
// is sent. So the server refuses any placeholder that did not resolve, and this
// panel says which ones rather than letting Send fail mysteriously.

import { AlertTriangle, Check, Loader2, Mail, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  fetchBookingNotifyDraft,
  sendBookingNotification,
  type BookingOutcomeScenario,
  type DraftLanguage,
} from '../../api/messaging'

type Props = {
  requestId: string
  scenario: BookingOutcomeScenario
  guestName: string
  onClose: () => void
}

const TITLES: Record<BookingOutcomeScenario, string> = {
  booking_approved: 'Confirm the booking to the guest',
  booking_rejected: 'Let the guest know it was declined',
}

export function NotifyGuestPanel({ requestId, scenario, guestName, onClose }: Props) {
  const [language, setLanguage] = useState<DraftLanguage>('sq')
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [unresolved, setUnresolved] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError('')
    fetchBookingNotifyDraft(requestId, scenario, language)
      .then((draft) => {
        if (ignore) return
        setBody(draft.body)
        setSubject(draft.subject)
        setGuestEmail(draft.guestEmail)
        setUnresolved(draft.unresolved)
      })
      .catch((caught: unknown) => {
        if (!ignore) setError(caught instanceof Error ? caught.message : 'Could not build the draft.')
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [requestId, scenario, language])

  async function send() {
    setSending(true)
    setError('')
    try {
      await sendBookingNotification(requestId, { body, subject, language })
      setSent(true)
      window.setTimeout(onClose, 1200)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not send the email.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="notify-backdrop" onClick={onClose}>
      <section className="panel notify-panel" onClick={(event) => event.stopPropagation()}>
        <div className="notify-head">
          <h3>
            <Mail size={16} /> {TITLES[scenario]}
          </h3>
          <button className="notify-close" title="Close without sending" type="button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {guestEmail ? (
          <p className="notify-to">
            To <strong>{guestEmail}</strong> — {guestName}
          </p>
        ) : (
          <p className="form-error">
            {guestName} did not leave an email address, so there is nobody to write to.
            The booking is decided either way.
          </p>
        )}

        {error && <p className="form-error">{error}</p>}

        {guestEmail && (
          <>
            <div className="notify-controls">
              <div className="guest-reply-lang">
                {(['sq', 'en'] as DraftLanguage[]).map((code) => (
                  <button
                    key={code}
                    className={language === code ? 'active' : ''}
                    type="button"
                    onClick={() => setLanguage(code)}
                  >
                    {code === 'sq' ? 'Shqip' : 'English'}
                  </button>
                ))}
              </div>
              <input
                aria-label="Subject"
                className="notify-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>

            <textarea
              className="notify-body"
              disabled={loading}
              rows={16}
              value={loading ? 'Loading…' : body}
              onChange={(event) => setBody(event.target.value)}
            />

            {unresolved.length > 0 && (
              <p className="guest-reply-warning">
                <AlertTriangle size={13} /> {unresolved.join(', ')} could not be filled in — edit
                or remove {unresolved.length === 1 ? 'it' : 'them'} before sending.
              </p>
            )}

            <div className="notify-foot">
              <button className="btn btn-sm btn-outline" type="button" onClick={onClose}>
                Don&apos;t send
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={sending || sent || loading || !body.trim()}
                type="button"
                onClick={send}
              >
                {sent ? <Check size={14} /> : sending ? <Loader2 className="spin" size={14} /> : <Mail size={14} />}
                {sent ? 'Sent' : sending ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
