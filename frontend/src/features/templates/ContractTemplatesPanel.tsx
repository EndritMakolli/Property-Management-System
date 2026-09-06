// The rental agreements, edited in place.
//
// Same shape as the guest-reply editor beside it: two fixed rows, each in
// Albanian and English, no create and no delete. The wording belongs to the
// operator — these ship with a complete draft so the first edit is a change of
// wording rather than writing a contract from an empty box.

import { Check, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  fetchContractTemplates,
  updateContractTemplate,
  type ContractTemplateRecord,
} from '../../api/contracts'

// Grouped as the operator thinks about a contract, not as the renderer stores it.
const PLACEHOLDERS: { group: string; tokens: string[] }[] = [
  { group: 'Parties', tokens: ['(company name)', '(company tax id)', '(company address)', '(company city)'] },
  { group: 'Guest', tokens: ['(guest name)', '(guest phone)', '(guest email)', '(guest id number)', '(nationality)'] },
  { group: 'Apartment', tokens: ['(apartment)', '(apartment address)', '(apartment floor)'] },
  { group: 'Vehicle', tokens: ['(vehicle)', '(registration)', '(odometer)', '(licence number)'] },
  { group: 'Period', tokens: ['(check-in)', '(check-out)', '(nights)', '(guests)'] },
  { group: 'Money', tokens: ['(total price)', '(nightly price)', '(deposit)'] },
  { group: 'Other', tokens: ['(today)'] },
]

export function ContractTemplatesPanel() {
  const [templates, setTemplates] = useState<ContractTemplateRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchContractTemplates()
      .then(setTemplates)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load the contracts.'),
      )
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <p className="templates-lede">
        The agreement a guest signs, one per business. Placeholders in{' '}
        <code>(brackets)</code> are filled from the reservation; a segment in{' '}
        <code>[square brackets]</code> disappears when everything inside it is empty, which is
        how the deposit clause vanishes when no deposit is taken.{' '}
        <strong>Keep each [segment] on one line</strong> — the renderer works a line at a time,
        so a segment split over two never closes.
      </p>
      <p className="templates-lede">
        These are a starting draft, not legal advice. Read them through and make them yours
        before anyone signs one.
      </p>

      {error && <p className="pricing-error">{error}</p>}

      {loading ? (
        <p className="list-empty">Loading…</p>
      ) : (
        templates.map((template) => (
          <ContractCard
            key={template.kind}
            template={template}
            onSaved={(saved) =>
              setTemplates((prev) => prev.map((t) => (t.kind === saved.kind ? saved : t)))
            }
          />
        ))
      )}
    </>
  )
}

function ContractCard({
  template,
  onSaved,
}: {
  template: ContractTemplateRecord
  onSaved: (saved: ContractTemplateRecord) => void
}) {
  const [bodySq, setBodySq] = useState(template.bodySq)
  const [bodyEn, setBodyEn] = useState(template.bodyEn)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const sqRef = useRef<HTMLTextAreaElement>(null)
  const enRef = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState<'sq' | 'en'>('en')

  const dirty = bodySq !== template.bodySq || bodyEn !== template.bodyEn

  /** Drop a placeholder in at the cursor of whichever box was last focused. */
  function insert(token: string) {
    const ref = focused === 'sq' ? sqRef : enRef
    const field = ref.current
    if (!field) return
    const start = field.selectionStart ?? field.value.length
    const end = field.selectionEnd ?? start
    const next = `${field.value.slice(0, start)}${token}${field.value.slice(end)}`
    if (focused === 'sq') setBodySq(next)
    else setBodyEn(next)
    // Put the caret after what was just inserted, once React has repainted.
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(start + token.length, start + token.length)
    })
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      onSaved(await updateContractTemplate(template.kind, { bodySq, bodyEn }))
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the contract.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel template-card">
      <div className="template-card-head">
        <h3>{template.label}</h3>
        <button className="primary-button" disabled={!dirty || saving} type="button" onClick={save}>
          {saved ? <Check size={15} /> : <Save size={15} />}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="template-placeholders">
        {PLACEHOLDERS.map((group) => (
          <div key={group.group}>
            <span className="template-placeholder-group">{group.group}</span>
            {group.tokens.map((token) => (
              <button
                key={token}
                className="template-token"
                title={`Insert ${token}`}
                type="button"
                onClick={() => insert(token)}
              >
                {token}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="template-bodies">
        <label>
          English
          <textarea
            ref={enRef}
            rows={18}
            value={bodyEn}
            onChange={(event) => setBodyEn(event.target.value)}
            onFocus={() => setFocused('en')}
          />
        </label>
        <label>
          Shqip
          <textarea
            ref={sqRef}
            rows={18}
            value={bodySq}
            onChange={(event) => setBodySq(event.target.value)}
            onFocus={() => setFocused('sq')}
          />
        </label>
      </div>
    </section>
  )
}
