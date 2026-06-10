import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createPricingRule,
  createPromoCode,
  deletePricingRule,
  deletePromoCode,
  fetchPricingRules,
  fetchPromoCodes,
  fetchProperties,
  updatePricingRule,
  updatePromoCode,
  type PricingRulePayload,
  type PromoCodePayload,
} from '../api/pmsApi'
import type { PricingRuleRecord, PromoCodeRecord, PropertyListing } from '../types/domain'
import '../styles/pricing-rules.css'

type Tab = 'long_stay' | 'seasonal' | 'last_minute' | 'minimum_nights' | 'promo_codes'

const TABS: { id: Tab; label: string }[] = [
  { id: 'long_stay', label: 'Long-stay Discounts' },
  { id: 'seasonal', label: 'Seasonal Pricing' },
  { id: 'last_minute', label: 'Last-minute Discounts' },
  { id: 'minimum_nights', label: 'Minimum Nights' },
  { id: 'promo_codes', label: 'Promo Codes' },
]

const DEFAULT_LONG_STAY_TIERS = [
  { minNights: 5, discountPct: '10' },
  { minNights: 7, discountPct: '15' },
  { minNights: 10, discountPct: '20' },
  { minNights: 14, discountPct: '25' },
  { minNights: 21, discountPct: '35' },
  { minNights: 28, discountPct: '50' },
]

const EMPTY_RULE: PricingRulePayload = {
  ruleType: 'long_stay',
  scope: 'all',
  propertyId: null,
  bedroomGroup: null,
  enabled: true,
  minNights: null,
  discountPct: null,
  daysBeforeCheckin: null,
  startDate: null,
  endDate: null,
  adjustmentType: 'pct_decrease',
  adjustmentValue: null,
}

const EMPTY_PROMO: PromoCodePayload = {
  code: '',
  discountType: 'percentage',
  discountValue: '',
  scope: 'all',
  propertyId: null,
  bedroomGroup: null,
  usageLimit: null,
  active: true,
}

export function PricingRulesPage() {
  const [tab, setTab] = useState<Tab>('long_stay')
  const [rules, setRules] = useState<PricingRuleRecord[]>([])
  const [promos, setPromos] = useState<PromoCodeRecord[]>([])
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showRuleForm, setShowRuleForm] = useState(false)
  const [ruleForm, setRuleForm] = useState<PricingRulePayload>({ ...EMPTY_RULE })
  const [savingRule, setSavingRule] = useState(false)

  const [showPromoForm, setShowPromoForm] = useState(false)
  const [promoForm, setPromoForm] = useState<PromoCodePayload>({ ...EMPTY_PROMO })
  const [savingPromo, setSavingPromo] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [r, p, props] = await Promise.all([
        fetchPricingRules(),
        fetchPromoCodes(),
        fetchProperties(true),
      ])
      setRules(r)
      setPromos(p)
      setProperties(props)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load pricing data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const tabRules = rules.filter((r) => r.ruleType === tab)

  async function handleAddDefaultTiers() {
    setSavingRule(true)
    try {
      for (const tier of DEFAULT_LONG_STAY_TIERS) {
        await createPricingRule({
          ...EMPTY_RULE,
          ruleType: 'long_stay',
          minNights: tier.minNights,
          discountPct: tier.discountPct,
        })
      }
      await loadAll()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add default tiers.')
    } finally {
      setSavingRule(false)
    }
  }

  async function handleAddRule() {
    setSavingRule(true)
    try {
      await createPricingRule({ ...ruleForm, ruleType: tab as PricingRulePayload['ruleType'] })
      setShowRuleForm(false)
      setRuleForm({ ...EMPTY_RULE })
      await loadAll()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save rule.')
    } finally {
      setSavingRule(false)
    }
  }

  async function toggleRule(id: string, enabled: boolean) {
    try {
      await updatePricingRule(id, { enabled })
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)))
    } catch {
      /* silent */
    }
  }

  async function handleDeleteRule(id: string) {
    try {
      await deletePricingRule(id)
      setRules((prev) => prev.filter((r) => r.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete rule.')
    }
  }

  async function handleAddPromo() {
    setSavingPromo(true)
    try {
      await createPromoCode(promoForm)
      setShowPromoForm(false)
      setPromoForm({ ...EMPTY_PROMO })
      await loadAll()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save promo code.')
    } finally {
      setSavingPromo(false)
    }
  }

  async function togglePromo(id: string, active: boolean) {
    try {
      await updatePromoCode(id, { active })
      setPromos((prev) => prev.map((p) => (p.id === id ? { ...p, active } : p)))
    } catch {
      /* silent */
    }
  }

  async function handleDeletePromo(id: string) {
    try {
      await deletePromoCode(id)
      setPromos((prev) => prev.filter((p) => p.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete promo code.')
    }
  }

  function scopeLabel(rule: PricingRuleRecord | PromoCodeRecord) {
    if (rule.scope === 'property') {
      const p = properties.find((pr) => pr.id === rule.propertyId)
      return `Property: ${p?.name ?? rule.propertyId}`
    }
    if (rule.scope === 'bedroom_group') return `${rule.bedroomGroup}-bedroom`
    return 'All'
  }

  function ruleDescription(rule: PricingRuleRecord) {
    if (rule.ruleType === 'long_stay') return `≥ ${rule.minNights} nights → ${rule.discountPct}% off`
    if (rule.ruleType === 'last_minute') return `≤ ${rule.daysBeforeCheckin} days before → ${rule.discountPct}% off`
    if (rule.ruleType === 'minimum_nights') return `Min. ${rule.minNights} nights`
    if (rule.ruleType === 'seasonal') {
      return `${rule.startDate} – ${rule.endDate}: ${rule.adjustmentType} ${rule.adjustmentValue}`
    }
    return ''
  }

  return (
    <div className="pricing-page">
      <h2>Pricing Rules</h2>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <div className="pricing-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`pricing-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => { setTab(t.id); setShowRuleForm(false); setShowPromoForm(false) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'promo_codes' ? (
        <div className="pricing-panel">
          <div className="pricing-panel-header">
            <h3>{TABS.find((t) => t.id === tab)?.label}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {tab === 'long_stay' && tabRules.length === 0 && (
                <button
                  className="btn btn-sm btn-outline"
                  onClick={handleAddDefaultTiers}
                  disabled={savingRule}
                >
                  Add default tiers
                </button>
              )}
              <button className="btn btn-sm btn-primary" onClick={() => setShowRuleForm((v) => !v)}>
                <Plus size={14} /> Add rule
              </button>
            </div>
          </div>

          {tab === 'long_stay' && tabRules.length === 0 && (
            <div className="default-tiers-note">
              Default tiers: 5→10%, 7→15%, 10→20%, 14→25%, 21→35%, 28→50%. Click "Add default tiers" to create them.
            </div>
          )}

          {loading ? (
            <div className="pricing-empty">Loading…</div>
          ) : tabRules.length === 0 ? (
            <div className="pricing-empty">No rules yet. Add one above.</div>
          ) : (
            <div className="pricing-rule-list">
              {tabRules.map((rule) => (
                <div key={rule.id} className="pricing-rule-row">
                  <div className="rule-main">{ruleDescription(rule)}</div>
                  <span className="rule-scope">{scopeLabel(rule)}</span>
                  <label className="rule-toggle">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => toggleRule(rule.id, e.target.checked)}
                    />
                    Enabled
                  </label>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => handleDeleteRule(rule.id)}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showRuleForm && (
            <div className="pricing-form">
              <div>
                <label>Scope</label>
                <select value={ruleForm.scope} onChange={(e) => setRuleForm((f) => ({ ...f, scope: e.target.value as 'all' | 'property' | 'bedroom_group', propertyId: null, bedroomGroup: null }))}>
                  <option value="all">All properties</option>
                  <option value="property">Specific property</option>
                  <option value="bedroom_group">Bedroom group</option>
                </select>
              </div>
              {ruleForm.scope === 'property' && (
                <div>
                  <label>Property</label>
                  <select value={ruleForm.propertyId ?? ''} onChange={(e) => setRuleForm((f) => ({ ...f, propertyId: e.target.value || null }))}>
                    <option value="">— select —</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              {ruleForm.scope === 'bedroom_group' && (
                <div>
                  <label>Bedrooms</label>
                  <input type="number" min={1} placeholder="e.g. 2" value={ruleForm.bedroomGroup ?? ''} onChange={(e) => setRuleForm((f) => ({ ...f, bedroomGroup: e.target.value ? Number(e.target.value) : null }))} />
                </div>
              )}
              {(tab === 'long_stay' || tab === 'minimum_nights') && (
                <div>
                  <label>Min. nights</label>
                  <input type="number" min={1} value={ruleForm.minNights ?? ''} onChange={(e) => setRuleForm((f) => ({ ...f, minNights: e.target.value ? Number(e.target.value) : null }))} />
                </div>
              )}
              {(tab === 'long_stay' || tab === 'last_minute') && (
                <div>
                  <label>Discount %</label>
                  <input type="number" min={0} max={100} step="0.01" value={ruleForm.discountPct ?? ''} onChange={(e) => setRuleForm((f) => ({ ...f, discountPct: e.target.value || null }))} />
                </div>
              )}
              {tab === 'last_minute' && (
                <div>
                  <label>Days before check-in</label>
                  <input type="number" min={0} value={ruleForm.daysBeforeCheckin ?? ''} onChange={(e) => setRuleForm((f) => ({ ...f, daysBeforeCheckin: e.target.value ? Number(e.target.value) : null }))} />
                </div>
              )}
              {tab === 'seasonal' && (
                <>
                  <div>
                    <label>Start date</label>
                    <input type="date" value={ruleForm.startDate ?? ''} onChange={(e) => setRuleForm((f) => ({ ...f, startDate: e.target.value || null }))} />
                  </div>
                  <div>
                    <label>End date</label>
                    <input type="date" value={ruleForm.endDate ?? ''} onChange={(e) => setRuleForm((f) => ({ ...f, endDate: e.target.value || null }))} />
                  </div>
                  <div>
                    <label>Adjustment type</label>
                    <select value={ruleForm.adjustmentType} onChange={(e) => setRuleForm((f) => ({ ...f, adjustmentType: e.target.value }))}>
                      <option value="pct_increase">% increase</option>
                      <option value="pct_decrease">% decrease</option>
                      <option value="fixed_price">Fixed price</option>
                      <option value="fixed_increase">Fixed increase</option>
                      <option value="fixed_decrease">Fixed decrease</option>
                    </select>
                  </div>
                  <div>
                    <label>Value</label>
                    <input type="number" min={0} step="0.01" value={ruleForm.adjustmentValue ?? ''} onChange={(e) => setRuleForm((f) => ({ ...f, adjustmentValue: e.target.value || null }))} />
                  </div>
                </>
              )}
              <div className="pricing-form-actions">
                <button className="btn btn-sm btn-primary" onClick={handleAddRule} disabled={savingRule}>
                  {savingRule ? 'Saving…' : 'Save rule'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => setShowRuleForm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="pricing-panel">
          <div className="pricing-panel-header">
            <h3>Promo Codes</h3>
            <button className="btn btn-sm btn-primary" onClick={() => setShowPromoForm((v) => !v)}>
              <Plus size={14} /> Add promo
            </button>
          </div>

          {showPromoForm && (
            <div className="pricing-form">
              <div>
                <label>Code</label>
                <input type="text" value={promoForm.code} onChange={(e) => setPromoForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="SUMMER20" />
              </div>
              <div>
                <label>Discount type</label>
                <select value={promoForm.discountType} onChange={(e) => setPromoForm((f) => ({ ...f, discountType: e.target.value as 'percentage' | 'fixed_amount' }))}>
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed_amount">Fixed amount (€)</option>
                </select>
              </div>
              <div>
                <label>Value</label>
                <input type="number" min={0} step="0.01" value={promoForm.discountValue} onChange={(e) => setPromoForm((f) => ({ ...f, discountValue: e.target.value }))} />
              </div>
              <div>
                <label>Scope</label>
                <select value={promoForm.scope} onChange={(e) => setPromoForm((f) => ({ ...f, scope: e.target.value as 'all' | 'property' | 'bedroom_group', propertyId: null, bedroomGroup: null }))}>
                  <option value="all">All properties</option>
                  <option value="property">Specific property</option>
                  <option value="bedroom_group">Bedroom group</option>
                </select>
              </div>
              {promoForm.scope === 'property' && (
                <div>
                  <label>Property</label>
                  <select value={promoForm.propertyId ?? ''} onChange={(e) => setPromoForm((f) => ({ ...f, propertyId: e.target.value || null }))}>
                    <option value="">— select —</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              {promoForm.scope === 'bedroom_group' && (
                <div>
                  <label>Bedrooms</label>
                  <input type="number" min={1} value={promoForm.bedroomGroup ?? ''} onChange={(e) => setPromoForm((f) => ({ ...f, bedroomGroup: e.target.value ? Number(e.target.value) : null }))} />
                </div>
              )}
              <div>
                <label>Usage limit (blank = unlimited)</label>
                <input type="number" min={1} value={promoForm.usageLimit ?? ''} onChange={(e) => setPromoForm((f) => ({ ...f, usageLimit: e.target.value ? Number(e.target.value) : null }))} />
              </div>
              <div className="pricing-form-actions">
                <button className="btn btn-sm btn-primary" onClick={handleAddPromo} disabled={savingPromo}>
                  {savingPromo ? 'Saving…' : 'Save promo'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => setShowPromoForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="pricing-empty">Loading…</div>
          ) : promos.length === 0 ? (
            <div className="pricing-empty">No promo codes yet.</div>
          ) : (
            <table className="promo-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Scope</th>
                  <th>Usage</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {promos.map((promo) => (
                  <tr key={promo.id}>
                    <td><strong>{promo.code}</strong></td>
                    <td>
                      {promo.discountType === 'percentage'
                        ? `${promo.discountValue}%`
                        : `€${parseFloat(promo.discountValue).toFixed(2)}`}
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>{scopeLabel(promo)}</td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {promo.usageCount} / {promo.usageLimit ?? '∞'}
                    </td>
                    <td>
                      <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={promo.active}
                          onChange={(e) => togglePromo(promo.id, e.target.checked)}
                        />
                        <span className={`promo-active-badge ${promo.active ? 'promo-active' : 'promo-inactive'}`}>
                          {promo.active ? 'Active' : 'Inactive'}
                        </span>
                      </label>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline" onClick={() => handleDeletePromo(promo.id)} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
