// A rule as the person configuring it sees it: one plain sentence saying what
// it does, and — once a stay is being tested — what it actually did to that
// stay, in the engine's own words.

import { ChevronDown, ChevronUp, Lock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { PricingRulePayload } from '../../api/bookingEngine'
import type { PricingGroupRecord, PricingRuleRecord, PropertyListing, RuleReport } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { RuleIntentPicker } from './RuleIntentPicker'
import {
  amountUnitsFor,
  applyIntent,
  intentFor,
  intentsForGroup,
  RULE_INTENTS,
  type RuleField,
  type RuleIntent,
} from './ruleIntents'
import { ruleSentence, scopeLabel } from './ruleSentence'
import { stackedRanges } from './stackedRanges'

function toPayload(rule: PricingRuleRecord): PricingRulePayload {
  const { id: _id, usageCount: _usageCount, createdAt: _createdAt, ...rest } = rule
  return rest
}

// ── Status chip — the engine's verdict on this rule for the tested stay ──────

const STATUS_LABEL: Record<RuleReport['status'], string> = {
  applied: 'applied',
  not_eligible: 'skipped',
  overridden: 'overridden',
  locked_out: 'locked out',
  skipped_invalid: 'unfinished',
}

function signedMoney(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  const sign = n < 0 ? '−' : '+'
  return `${sign}€${Math.abs(n).toLocaleString('en', { maximumFractionDigits: 2 })}`
}

function RuleStatusChip({ report }: { report: RuleReport }) {
  const amount = report.status === 'applied' ? signedMoney(report.amount) : ''
  return (
    <span className={`rule-status rule-status-${report.status}`}>
      {STATUS_LABEL[report.status]}
      {amount && <strong>{amount}</strong>}
    </span>
  )
}

// ── RuleForm — asks only for what the chosen intent actually uses ────────────

export function RuleForm({
  value,
  onChange,
  properties,
  groups,
  allRules,
  usageCount,
  startOnPicker = false,
}: {
  value: PricingRulePayload
  onChange: (next: PricingRulePayload) => void
  properties: PropertyListing[]
  groups: PricingGroupRecord[]
  /** Every rule on this platform, so an exclusion can name one of them. */
  allRules: PricingRuleRecord[]
  usageCount?: number
  startOnPicker?: boolean
}) {
  const [picking, setPicking] = useState(startOnPicker)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const intent = intentFor(value.ruleType)
  const shows = (field: RuleField) => intent.fields.includes(field)
  // Choosing an intent can send the rule to that kind's home group. Naming the
  // destination here keeps that from happening behind the user's back.
  const groupName = groups.find((g) => g.id === value.groupId)?.name ?? ''
  // A group offers only the kinds of rule it holds. A group the operator made
  // themselves matches no intent, so it falls back to the full list rather
  // than offering nothing at all.
  // What these dates will really come to once every stacking rule is counted.
  const stacking = stackedRanges(value, allRules)
  const groupIntents = intentsForGroup(groupName)
  const offered = groupIntents.length > 0 ? groupIntents : RULE_INTENTS.filter((i) => !i.hidden)
  const units = amountUnitsFor(value.application, value.ruleType)

  function set<K extends keyof PricingRulePayload>(key: K, val: PricingRulePayload[K]) {
    onChange({ ...value, [key]: val })
  }

  function pickIntent(next: RuleIntent) {
    // Send the rule to the group this kind of rule belongs in. Advanced still
    // lets the user override it afterwards.
    const target = groups.find((g) => g.name === next.groupName)
    const applied = applyIntent(value, next)
    onChange(target ? { ...applied, groupId: target.id } : applied)
    setPicking(false)
  }

  function setApplication(application: PricingRulePayload['application']) {
    // Mirror the validator: a whole-stay rule can hold neither a fixed nightly
    // price nor a final-price lock.
    const perNight = application === 'per_night'
    onChange({
      ...value,
      application,
      isFinal: perNight ? value.isFinal : false,
      adjustmentType:
        !perNight && value.adjustmentType === 'fixed_price' ? 'pct_decrease' : value.adjustmentType,
    })
  }

  if (picking) {
    return (
      <div className="rule-editor">
        <RuleIntentPicker intents={offered} current={value.ruleType} onPick={pickIntent} />
      </div>
    )
  }

  return (
    <div className="rule-editor">
      {!intent.minimal && (
        <div className="rule-editor-intent">
          <span>
            {intent.title}
            {groupName && <em> — lives in {groupName}</em>}
          </span>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setPicking(true)}>
            Change
          </button>
        </div>
      )}

      <div className="pricing-form">
        {!intent.minimal && (
          <div>
            <label>Name</label>
            <input
              type="text"
              value={value.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Early bird"
            />
          </div>
        )}

        {shows('minNights') && (
          <div>
            <label>Stays of at least</label>
            <div className="field-with-suffix">
              <input
                type="number"
                min={1}
                value={value.minNights ?? ''}
                onChange={(e) => set('minNights', e.target.value ? Number(e.target.value) : null)}
              />
              <span>nights</span>
            </div>
          </div>
        )}

        {shows('daysBeforeCheckin') && (
          <div>
            <label>Booked within</label>
            <div className="field-with-suffix">
              <input
                type="number"
                min={0}
                value={value.daysBeforeCheckin ?? ''}
                onChange={(e) => set('daysBeforeCheckin', e.target.value ? Number(e.target.value) : null)}
              />
              <span>days of check-in</span>
            </div>
          </div>
        )}

        {shows('dates') && (
          <>
            <div>
              <label>From</label>
              <input
                type="date"
                value={value.startDate ?? ''}
                onChange={(e) => set('startDate', e.target.value || null)}
              />
            </div>
            <div>
              <label>To</label>
              <input
                type="date"
                // An end before the start covers no nights, so the rule looks
                // ignored rather than wrong. The backend rejects it too.
                min={value.startDate ?? undefined}
                value={value.endDate ?? ''}
                onChange={(e) => set('endDate', e.target.value || null)}
              />
            </div>
          </>
        )}

        {shows('code') && (
          <div>
            <label>Code guests type</label>
            <input
              type="text"
              value={value.code ?? ''}
              onChange={(e) => set('code', e.target.value.toUpperCase() || null)}
              placeholder="SUMMER20"
            />
          </div>
        )}

        {!intent.hidesAmount && (
        <div>
          <label>{intent.amountLabel ?? 'Amount'}</label>
          <div className="field-amount">
            <input
              type="number"
              min={0}
              step="0.01"
              value={value.adjustmentValue ?? ''}
              onChange={(e) => set('adjustmentValue', e.target.value || null)}
            />
            {units.length === 1 ? (
              // One legal unit is not a choice — show it as a suffix rather
              // than a dropdown that can only ever say one thing.
              <span className="field-amount-unit">{units[0].label}</span>
            ) : (
              <select
                value={value.adjustmentType}
                onChange={(e) => set('adjustmentType', e.target.value as PricingRulePayload['adjustmentType'])}
              >
                {units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            )}
          </div>
        </div>
        )}

        {intent.hidesAmount && (
          <div className="field-wide">
            <label>Exclude</label>
            <select
              value={
                value.blocksRuleId
                  ? `rule:${value.blocksRuleId}`
                  : value.blocksGroupId
                    ? `group:${value.blocksGroupId}`
                    : ''
              }
              onChange={(e) => {
                const [kind, id] = e.target.value.split(':')
                onChange({
                  ...value,
                  blocksGroupId: kind === 'group' ? id : null,
                  blocksRuleId: kind === 'rule' ? id : null,
                })
              }}
            >
              <option value="">Every discount</option>
              {groups
                .filter((g) => g.id !== value.groupId)
                .map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    All of: {g.name}
                  </option>
                ))}
              {allRules
                .filter((r) => r.groupId !== value.groupId && r.application === 'whole_stay')
                .map((r) => (
                  <option key={r.id} value={`rule:${r.id}`}>
                    Just: {r.name || intentFor(r.ruleType).rowLabel}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div>
          <label>Applies to</label>
          <select
            value={value.scope}
            onChange={(e) => onChange({
              ...value,
              scope: e.target.value as PricingRulePayload['scope'],
              propertyId: null,
              bedroomGroup: null,
            })}
          >
            <option value="all">All properties</option>
            <option value="property">One property</option>
            <option value="bedroom_group">Every N-bedroom apartment</option>
          </select>
        </div>

        {value.scope === 'property' && (
          <div>
            <label>Property</label>
            <select value={value.propertyId ?? ''} onChange={(e) => set('propertyId', e.target.value || null)}>
              <option value="">— select —</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {value.scope === 'bedroom_group' && (
          <div>
            <label>Bedrooms</label>
            <input
              type="number"
              min={1}
              value={value.bedroomGroup ?? ''}
              onChange={(e) => set('bedroomGroup', e.target.value ? Number(e.target.value) : null)}
            />
          </div>
        )}

        {shows('usageLimit') && (
          <div>
            <label>Usage limit</label>
            <input
              type="number"
              min={1}
              placeholder="unlimited"
              value={value.usageLimit ?? ''}
              onChange={(e) => set('usageLimit', e.target.value ? Number(e.target.value) : null)}
            />
          </div>
        )}

        {shows('minSubtotal') && (
          <div>
            <label>Minimum spend (€)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="none"
              value={value.minSubtotalEur ?? ''}
              onChange={(e) => set('minSubtotalEur', e.target.value || null)}
            />
          </div>
        )}

        {usageCount !== undefined && shows('code') && (
          <div>
            <label>Used so far</label>
            <input type="text" value={usageCount} disabled readOnly />
          </div>
        )}
      </div>

      {intent.showsStacking && (
        <div className="rule-lock-choice">
          <label className="rule-toggle">
            <input
              type="checkbox"
              checked={value.stacks}
              onChange={(e) => set('stacks', e.target.checked)}
            />
            Stack with other increases on the same dates
          </label>
          <p>
            Stacked percentages add up rather than multiplying, so 10% and 15%
            over the same night make 25%.
          </p>
          {stacking.length > 0 && (
            <ul className="stack-summary">
              {stacking.map((range) => (
                <li key={range.from}>
                  <span>{formatDisplayDate(range.from)} – {formatDisplayDate(range.to)}</span>
                  <strong>{range.pct > 0 ? '+' : ''}{range.pct}%</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {intent.showsLock && (
        <div className="rule-lock-choice">
          <label className="rule-toggle">
            <input
              type="checkbox"
              checked={value.isFinal}
              onChange={(e) => set('isFinal', e.target.checked)}
            />
            Keep this price — no whole-stay discount applies to these nights
          </label>
          <p>
            Stops a length-of-stay tier, and any promo code, discounting the nights
            this rule covers.
          </p>
        </div>
      )}

      <p className="rule-preview-sentence">{ruleSentence(value, properties, allRules)}</p>

      {intent.minimal ? null : (
      <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Advanced — group, timing, final price
      </button>
      )}

      {showAdvanced && !intent.minimal && (
        <div className="pricing-form">
          <div>
            <label>Group</label>
            <select value={value.groupId} onChange={(e) => set('groupId', e.target.value)}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label>Adjusts</label>
            <select
              value={value.application}
              onChange={(e) => setApplication(e.target.value as PricingRulePayload['application'])}
            >
              <option value="per_night">Each night’s rate</option>
              <option value="whole_stay">The stay total</option>
            </select>
          </div>
          <div>
            <label>Final price</label>
            <label className="rule-toggle">
              <input
                type="checkbox"
                checked={value.isFinal}
                disabled={value.application !== 'per_night'}
                onChange={(e) => set('isFinal', e.target.checked)}
              />
              {value.application === 'per_night'
                ? 'Lock these nights against later discounts'
                : 'Only a per-night rule can lock a price'}
            </label>
          </div>
          <div>
            <label>Enabled</label>
            <label className="rule-toggle">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              This rule is live
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

// ── RuleRow — read-only summary + edit-in-place form ─────────────────────────

export function RuleRow({
  rule,
  properties,
  groups,
  allRules,
  report,
  onSave,
  onDelete,
  onMove,
  sortable,
  orderDecidesPrice,
  isFirst,
  isLast,
}: {
  rule: PricingRuleRecord
  properties: PropertyListing[]
  groups: PricingGroupRecord[]
  allRules: PricingRuleRecord[]
  report?: RuleReport
  onSave: (id: string, patch: Partial<PricingRulePayload>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onMove: (id: string, direction: 'up' | 'down') => void
  /** False where the group derives its own order, so there is nothing to
   *  arrange and the arrows would fight the sort. */
  sortable: boolean
  /** False in a group whose engine behaviour picks the winner itself. The
   *  arrows still work there — order is how the list reads — but they must
   *  not imply they change what a guest pays. */
  orderDecidesPrice: boolean
  isFirst: boolean
  isLast: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<PricingRulePayload>(() => toPayload(rule))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [rowError, setRowError] = useState('')

  function startEdit() {
    setForm(toPayload(rule))
    setFormError('')
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    setFormError('')
    try {
      await onSave(rule.id, form)
      setEditing(false)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to save rule.')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleEnabled(enabled: boolean) {
    setRowError('')
    try {
      await onSave(rule.id, { enabled })
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'Could not update rule.')
    }
  }

  async function handleDelete() {
    setRowError('')
    try {
      await onDelete(rule.id)
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'Could not delete rule.')
    }
  }

  return (
    <div className={`pricing-rule${rule.enabled ? '' : ' is-off'}`}>
      <div className="pricing-rule-row">
        {sortable && (
        <div className="reorder-controls">
          <button
            className="reorder-btn"
            onClick={() => onMove(rule.id, 'up')}
            disabled={isFirst}
            title={orderDecidesPrice ? 'Move up — this group applies rules in order' : 'Move up — display order only'}
          >
            <ChevronUp size={13} />
          </button>
          <button
            className="reorder-btn"
            onClick={() => onMove(rule.id, 'down')}
            disabled={isLast}
            title={orderDecidesPrice ? 'Move down — this group applies rules in order' : 'Move down — display order only'}
          >
            <ChevronDown size={13} />
          </button>
        </div>
        )}

        {report && <RuleStatusChip report={report} />}

        <div className="rule-main">
          <div className="rule-name">
            {rule.name || intentFor(rule.ruleType).rowLabel}
            {/* A promo's identity is its code, so show it rather than making
                the reader open the rule to find out what guests type. */}
            {rule.ruleType === 'promo' && rule.code && (
              <code className="rule-code">{rule.code}</code>
            )}
            {rule.isFinal && (
              <span className="rule-lock" title="Locks the nights it covers against later discounts">
                <Lock size={11} /> final price
              </span>
            )}
          </div>
          <div className="rule-sentence">{ruleSentence(rule, properties, allRules)}</div>
          {report && report.status !== 'applied' && report.reason && (
            <div className="rule-reason">{report.reason}</div>
          )}
        </div>

        <span className="rule-scope">{scopeLabel(rule, properties)}</span>
        <label className="rule-toggle">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => handleToggleEnabled(e.target.checked)} />
          On
        </label>
        <button className="btn btn-sm btn-outline" onClick={() => (editing ? setEditing(false) : startEdit())}>
          <Pencil size={13} /> {editing ? 'Close' : 'Edit'}
        </button>
        <button className="btn btn-sm btn-outline" onClick={handleDelete} title="Delete rule">
          <Trash2 size={13} />
        </button>
      </div>

      {rowError && <p className="pricing-error">{rowError}</p>}

      {editing && (
        <>
          {formError && <p className="pricing-error">{formError}</p>}
          <RuleForm
            value={form}
            onChange={setForm}
            properties={properties}
            groups={groups}
            allRules={allRules}
            usageCount={rule.usageCount}
          />
          <div className="pricing-form-actions standalone">
            <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
