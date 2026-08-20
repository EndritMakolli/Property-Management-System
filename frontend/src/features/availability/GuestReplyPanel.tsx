// The reply to send back, already written.
//
// Sits under the search results. The page hands it the availability facts it
// has already worked out on screen; the backend decides which of the four
// situations applies, prices it, and renders the template. Delivery is
// copy-to-clipboard — nothing is sent from here, and staff always read the
// draft before it goes anywhere.

import { AlertTriangle, Check, Copy, MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchMessageDraft,
  type DraftLanguage,
  type DraftResponse,
  type MessageScenario,
} from '../../api/messaging'

const SCENARIO_LABELS: Record<MessageScenario, string> = {
  available: 'Apartments available',
  split_stay: 'Split stay possible',
  alternative_dates: 'Free on nearby dates',
  no_availability: 'Fully booked',
}

type Props = {
  checkIn: string
  checkOut: string
  guests?: number
  /** Bedroom counts free for the whole stay. */
  freeTypes: number[]
  /** Whether a split-stay plan covers the requested dates. */
  splitCovers: boolean
  /** Earliest later date something is free, '' if nothing is. */
  nextFree: string
  /** The dates a split stay moves the guest between apartments. */
  changeDate: string[]
  /** Bedroom counts of the apartments in the split plan. */
  splitTypes: number[]
}

export function GuestReplyPanel({
  checkIn,
  checkOut,
  guests,
  freeTypes,
  splitCovers,
  nextFree,
  changeDate,
  splitTypes,
}: Props) {
  const [language, setLanguage] = useState<DraftLanguage>('sq')
  const [override, setOverride] = useState<MessageScenario | ''>('')
  const [draft, setDraft] = useState<DraftResponse | null>(null)
  // Staff edits live here. Regenerating replaces them, which is why every
  // input that changes the draft resets it.
  const [edited, setEdited] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const key = `${checkIn}|${checkOut}|${language}|${override}|${freeTypes.join(',')}|${splitCovers}|${nextFree}|${changeDate.join(',')}|${splitTypes.join(',')}`

  const load = useCallback(async () => {
    setError('')
    try {
      const result = await fetchMessageDraft({
        checkIn,
        checkOut,
        guests,
        language,
        freeTypes,
        splitCovers,
        nextFree,
        changeDate,
        splitTypes,
        ...(override ? { scenario: override } : {}),
      })
      setDraft(result)
      setEdited(result.body)
    } catch (e: unknown) {
      setDraft(null)
      setError(e instanceof Error ? e.message : 'Could not build a draft.')
    }
    // freeTypes is a new array each render; `key` carries its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!checkIn || !checkOut) return
    load()
  }, [checkIn, checkOut, load])

  async function copy() {
    try {
      await navigator.clipboard.writeText(edited)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure origin, or permission denied). Select the
      // text so Ctrl+C still works rather than leaving no way to copy.
      const box = document.getElementById('guest-reply-body') as HTMLTextAreaElement | null
      box?.select()
      setError('Press Ctrl+C to copy.')
    }
  }

  if (!checkIn || !checkOut) return null

  return (
    <section className="panel guest-reply">
      <div className="guest-reply-head">
        <h3><MessageSquare size={16} /> Reply to the guest</h3>

        <div className="guest-reply-controls">
          <select
            value={override || draft?.detected || 'available'}
            onChange={(e) => setOverride(e.target.value as MessageScenario)}
            title="Detected from the search — change it if the guess is wrong"
          >
            {(Object.keys(SCENARIO_LABELS) as MessageScenario[]).map((scenario) => (
              <option key={scenario} value={scenario}>
                {SCENARIO_LABELS[scenario]}
                {draft?.detected === scenario ? ' (detected)' : ''}
              </option>
            ))}
          </select>

          <div className="guest-reply-lang">
            {(['sq', 'en'] as DraftLanguage[]).map((code) => (
              <button
                key={code}
                type="button"
                className={language === code ? 'active' : ''}
                onClick={() => setLanguage(code)}
              >
                {code === 'sq' ? 'Shqip' : 'English'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="pricing-error">{error}</p>}

      {draft?.empty ? (
        <p className="list-empty">
          No template yet for “{SCENARIO_LABELS[draft.scenario]}” in{' '}
          {language === 'sq' ? 'Albanian' : 'English'}.
        </p>
      ) : (
        <>
          <textarea
            id="guest-reply-body"
            className="guest-reply-body"
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            rows={16}
          />

          <div className="guest-reply-foot">
            <button className="btn btn-sm btn-primary" onClick={copy} disabled={!edited.trim()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>

            <span className="guest-reply-count">{edited.length} characters</span>

            {draft && draft.unresolved.length > 0 && (
              <span className="guest-reply-warning" title={draft.unresolved.join(', ')}>
                <AlertTriangle size={13} />
                {draft.unresolved.length} placeholder
                {draft.unresolved.length === 1 ? '' : 's'} couldn’t be filled
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
