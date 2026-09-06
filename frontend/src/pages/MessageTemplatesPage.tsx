// The wording of the guest replies.
//
// Four fixed rows — one per situation the availability search can produce —
// each in Albanian and English. There is no create or delete: the scenarios
// are what can happen, not a list that grows.
//
// Preview renders through the same endpoint the real draft uses, against a
// sample stay. Writing a second renderer here would let the preview and the
// real message drift apart, which is the one thing a preview must never do.

import { AlertTriangle, Check, Eye, EyeOff, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  fetchMessageDraft,
  fetchMessageTemplates,
  updateMessageTemplate,
  type DraftLanguage,
  type MessageScenario,
  type MessageTemplateRecord,
} from '../api/messaging'
import { ContractTemplatesPanel } from '../features/templates/ContractTemplatesPanel'
import { toDateInputValue } from '../utils/date'
import '../styles/message-templates.css'

const WHEN_IT_FIRES: Record<MessageScenario, string> = {
  available: 'At least one apartment is free for the whole stay.',
  split_stay: 'Nothing is free throughout, but a split stay covers the dates.',
  alternative_dates: 'Nothing is free, no split works, but a later window fits.',
  no_availability: 'Nothing is free within the search horizon.',
  booking_approved: 'Emailed to the guest when you approve their booking request.',
  booking_rejected: 'Emailed to the guest when you decline their booking request.',
}

// The four availability replies are copied into WhatsApp by hand; the two
// booking outcomes are emailed. That difference matters here: an email is not
// proofread on its way out, so the sender refuses any placeholder that did not
// resolve rather than letting a guest read "Hello (guest name)".
const EMAILED: MessageScenario[] = ['booking_approved', 'booking_rejected']

// Grouped as staff think about them, not as the renderer stores them.
const PLACEHOLDERS: { group: string; tokens: string[] }[] = [
  { group: 'Stay', tokens: ['(check-in)', '(check-out)', '(nights)', '(guests)'] },
  {
    group: 'Apartment',
    tokens: ['(bedrooms)', '(capacity)', '(beds)', '(bathrooms)', '(apartment type)'],
  },
  {
    group: 'Money',
    tokens: ['(nightly price)', '(subtotal)', '(discount)', '(discount %)', '(total price)'],
  },
  {
    group: 'Alternatives',
    tokens: ['(next free date)', '(unavailable until)', '(change date)'],
  },
  { group: 'Other', tokens: ['(guest name)', '(location)'] },
  {
    group: 'Booking outcome',
    tokens: ['(apartment)', '(reason)'],
  },
]

function sampleDates() {
  const from = new Date()
  from.setDate(from.getDate() + 30)
  const to = new Date(from)
  to.setDate(to.getDate() + 7)
  return { checkIn: toDateInputValue(from), checkOut: toDateInputValue(to) }
}

type TemplatesView = 'replies' | 'contracts'
const VIEW_STORAGE_KEY = 'pms.templates.view'

export function MessageTemplatesPage() {
  const [templates, setTemplates] = useState<MessageTemplateRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<TemplatesView>(() =>
    window.localStorage.getItem(VIEW_STORAGE_KEY) === 'contracts' ? 'contracts' : 'replies',
  )

  function chooseView(next: TemplatesView) {
    setView(next)
    window.localStorage.setItem(VIEW_STORAGE_KEY, next)
  }

  useEffect(() => {
    fetchMessageTemplates()
      .then(setTemplates)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Could not load the templates.'),
      )
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="templates-page">
      <h2>Templates</h2>

      <div className="view-tabs">
        <button
          className={`view-tab${view === 'replies' ? ' active' : ''}`}
          type="button"
          onClick={() => chooseView('replies')}
        >
          Guest replies
        </button>
        <button
          className={`view-tab${view === 'contracts' ? ' active' : ''}`}
          type="button"
          onClick={() => chooseView('contracts')}
        >
          Contracts
        </button>
      </div>

      {view === 'contracts' ? (
        <ContractTemplatesPanel />
      ) : (
        <>
          <p className="templates-lede">
            One reply per situation the availability search can produce. Placeholders
            in <code>(brackets)</code> are filled from the search; a segment in{' '}
            <code>[square brackets]</code> disappears when the values inside it are
            empty, which is how the discount clause vanishes on a short stay.
          </p>

          {error && <p className="pricing-error">{error}</p>}

          {loading ? (
            <p className="list-empty">Loading…</p>
          ) : (
            templates.map((template) => (
              <TemplateCard
                key={template.scenario}
                template={template}
                onSaved={(saved) =>
                  setTemplates((prev) =>
                    prev.map((t) => (t.scenario === saved.scenario ? saved : t)),
                  )
                }
              />
            ))
          )}
        </>
      )}
    </div>
  )
}

function TemplateCard({
  template,
  onSaved,
}: {
  template: MessageTemplateRecord
  onSaved: (saved: MessageTemplateRecord) => void
}) {
  const [bodySq, setBodySq] = useState(template.bodySq)
  const [bodyEn, setBodyEn] = useState(template.bodyEn)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<{ body: string; unresolved: string[] } | null>(null)

  const sqRef = useRef<HTMLTextAreaElement>(null)
  const enRef = useRef<HTMLTextAreaElement>(null)
  // Which box a placeholder click should land in — whichever was last focused.
  const [focused, setFocused] = useState<DraftLanguage>('sq')

  const dirty = bodySq !== template.bodySq || bodyEn !== template.bodyEn

  function insert(token: string) {
    const ref = focused === 'sq' ? sqRef : enRef
    const box = ref.current
    const setter = focused === 'sq' ? setBodySq : setBodyEn
    const current = focused === 'sq' ? bodySq : bodyEn
    if (!box) {
      setter(current + token)
      return
    }
    const start = box.selectionStart ?? current.length
    const end = box.selectionEnd ?? start
    setter(current.slice(0, start) + token + current.slice(end))
    // Put the caret after what was just inserted, not back at the start.
    window.requestAnimationFrame(() => {
      box.focus()
      box.setSelectionRange(start + token.length, start + token.length)
    })
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const result = await updateMessageTemplate(template.scenario, { bodySq, bodyEn })
      onSaved(result)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const isEmailed = EMAILED.includes(template.scenario)

  async function togglePreview() {
    if (previewing) {
      setPreviewing(false)
      return
    }
    setPreviewing(true)
    setError('')
    try {
      const { checkIn, checkOut } = sampleDates()
      // Through the real endpoint, against a sample stay — so what is
      // previewed is what a guest would receive.
      const result = await fetchMessageDraft({
        checkIn,
        checkOut,
        guests: 2,
        language: focused,
        freeTypes: [1, 2],
        splitCovers: template.scenario === 'split_stay',
        nextFree: template.scenario === 'alternative_dates' ? checkOut : '',
        scenario: template.scenario,
      })
      setPreview({ body: result.body, unresolved: result.unresolved })
    } catch (e: unknown) {
      setPreview(null)
      setError(e instanceof Error ? e.message : 'Could not build a preview.')
    }
  }

  return (
    <section className="panel template-card">
      <div className="template-head">
        <div>
          <h3>{template.label}</h3>
          <span className="template-when">
            {WHEN_IT_FIRES[template.scenario]}
            {isEmailed && ' Every placeholder must resolve, or the send is refused.'}
          </span>
        </div>
        <div className="template-actions">
          <button
            className="btn btn-sm btn-outline"
            disabled={isEmailed}
            title={
              isEmailed
                ? 'Previewed against a real booking on the Booking requests page, where it is sent from'
                : undefined
            }
            onClick={togglePreview}
          >
            {previewing ? <EyeOff size={13} /> : <Eye size={13} />}
            {previewing ? 'Hide preview' : 'Preview'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || !dirty}>
            {saved ? <Check size={13} /> : <Save size={13} />}
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <p className="pricing-error">{error}</p>}

      <div className="template-bodies">
        <label>
          <span>Shqip</span>
          <textarea
            ref={sqRef}
            value={bodySq}
            rows={14}
            onFocus={() => setFocused('sq')}
            onChange={(e) => setBodySq(e.target.value)}
          />
        </label>
        <label>
          <span>English</span>
          <textarea
            ref={enRef}
            value={bodyEn}
            rows={14}
            onFocus={() => setFocused('en')}
            onChange={(e) => setBodyEn(e.target.value)}
          />
        </label>
      </div>

      <div className="template-tokens">
        {PLACEHOLDERS.map(({ group, tokens }) => (
          <div key={group}>
            <span className="template-token-group">{group}</span>
            {tokens.map((token) => (
              <button
                key={token}
                type="button"
                className="template-token"
                onClick={() => insert(token)}
                title={`Insert into the ${focused === 'sq' ? 'Albanian' : 'English'} box`}
              >
                {token}
              </button>
            ))}
          </div>
        ))}
      </div>

      {previewing && preview && (
        <div className="template-preview">
          <span className="template-token-group">
            Preview — sample stay, {focused === 'sq' ? 'Albanian' : 'English'}
          </span>
          <pre>{preview.body}</pre>
          {preview.unresolved.length > 0 && (
            <span className="guest-reply-warning">
              <AlertTriangle size={13} /> {preview.unresolved.join(', ')}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
