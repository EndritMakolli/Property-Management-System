// Booking limits. Not prices — gates. A stay that breaks one is refused
// outright, which is why this reads as "Booking limits" and sits after the
// pricing steps rather than among them.
//
// Two kinds: the shortest stay guests may book, and the latest date they may
// book to. They carry their limit in different fields — `value` counts nights,
// `endDate` holds the cutoff — so the form asks for one or the other.

import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { StayConstraintPayload } from '../../api/bookingEngine'
import type { PropertyListing, StayConstraintRecord } from '../../types/domain'
import { constraintSentence, scopeLabel } from './ruleSentence'

const EMPTY: StayConstraintPayload = {
  kind: 'min_nights',
  value: 2,
  scope: 'all',
  propertyId: null,
  bedroomGroup: null,
  startDate: null,
  endDate: null,
  enabled: true,
}

export function BookingLimits({
  constraints,
  properties,
  blocking,
  onAdd,
  onToggle,
  onDelete,
}: {
  constraints: StayConstraintRecord[]
  properties: PropertyListing[]
  blocking: boolean
  onAdd: (payload: StayConstraintPayload) => Promise<void>
  onToggle: (id: string, enabled: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<StayConstraintPayload>({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleAdd() {
    setSaving(true)
    setError('')
    try {
      await onAdd(form)
      setForm({ ...EMPTY })
      setShowForm(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save this limit.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pricing-panel">
      <div className="pricing-panel-header">
        <div className="group-heading static">
          <span className="group-title">
            <span className="group-name">Booking limits</span>
            <span className="group-strapline">
              checked before pricing — a stay that breaks one is refused
            </span>
          </span>
        </div>
        <div className="group-actions">
          <button className="btn btn-sm btn-primary" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} /> Add limit
          </button>
        </div>
      </div>

      {blocking && (
        <p className="pricing-blocking">
          <AlertTriangle size={14} /> A limit below refuses the stay you are testing.
        </p>
      )}

      {error && <p className="pricing-error">{error}</p>}

      {showForm && (
        <>
          <div className="pricing-form">
            <div>
              <label>Limit</label>
              <select
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value as StayConstraintPayload['kind']
                  // Each kind carries its limit in a different field, so the
                  // one the other kind used is cleared rather than left to be
                  // rejected on save.
                  setForm((f) => ({
                    ...f,
                    kind,
                    value: kind === 'min_nights' ? f.value ?? 2 : null,
                    startDate: kind === 'min_nights' ? f.startDate : null,
                    endDate: null,
                  }))
                }}
              >
                <option value="min_nights">Shortest stay guests may book</option>
                <option value="max_advance">Latest date guests may book</option>
              </select>
            </div>

            {form.kind === 'min_nights' ? (
              <div>
                <label>Minimum nights</label>
                <input
                  type="number"
                  min={1}
                  value={form.value ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) || 1 }))}
                />
              </div>
            ) : (
              <div>
                <label>Bookable until</label>
                <input
                  type="date"
                  value={form.endDate ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value || null }))}
                />
              </div>
            )}
            <div>
              <label>Applies to</label>
              <select
                value={form.scope}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  scope: e.target.value as StayConstraintPayload['scope'],
                  propertyId: null,
                  bedroomGroup: null,
                }))}
              >
                <option value="all">All properties</option>
                <option value="property">One property</option>
                <option value="bedroom_group">Every N-bedroom apartment</option>
              </select>
            </div>
            {form.scope === 'property' && (
              <div>
                <label>Property</label>
                <select
                  value={form.propertyId ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, propertyId: e.target.value || null }))}
                >
                  <option value="">— select —</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {form.scope === 'bedroom_group' && (
              <div>
                <label>Bedrooms</label>
                <input
                  type="number"
                  min={1}
                  value={form.bedroomGroup ?? ''}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    bedroomGroup: e.target.value ? Number(e.target.value) : null,
                  }))}
                />
              </div>
            )}
            {form.kind === 'min_nights' && (
              <>
                <div>
                  <label>From (optional)</label>
                  <input
                    type="date"
                    value={form.startDate ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value || null }))}
                  />
                </div>
                <div>
                  <label>To (optional)</label>
                  <input
                    type="date"
                    min={form.startDate ?? undefined}
                    value={form.endDate ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value || null }))}
                  />
                </div>
              </>
            )}
          </div>

          <p className="rule-preview-sentence">{constraintSentence(form, properties)}</p>

          <div className="pricing-form-actions standalone">
            <button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? 'Saving…' : 'Save limit'}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </>
      )}

      {constraints.length === 0 ? (
        <div className="pricing-empty">
          No limits. Guests can book a stay of any length, any time ahead.
        </div>
      ) : (
        <div className="pricing-rule-list">
          {constraints.map((c) => (
            <div key={c.id} className={`pricing-rule${c.enabled ? '' : ' is-off'}`}>
              <div className="pricing-rule-row">
                <div className="rule-main">
                  <div className="rule-name">
                    {c.kind === 'max_advance'
                      ? `Bookable until ${c.endDate ?? '—'}`
                      : `Minimum ${c.value} nights`}
                  </div>
                  <div className="rule-sentence">{constraintSentence(c, properties)}</div>
                </div>
                <span className="rule-scope">{scopeLabel(c, properties)}</span>
                <label className="rule-toggle">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => onToggle(c.id, e.target.checked)}
                  />
                  On
                </label>
                <button className="btn btn-sm btn-outline" onClick={() => onDelete(c.id)} title="Delete limit">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
