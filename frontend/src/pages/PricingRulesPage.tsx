import { useEffect, useMemo, useState } from 'react'
import {
  createPricingRule,
  createStayConstraint,
  deletePricingGroup,
  deletePricingRule,
  deleteStayConstraint,
  fetchPricingGroups,
  fetchPricingPreview,
  fetchPricingRules,
  fetchProperties,
  fetchStayConstraints,
  reorderPricingRules,
  updatePricingGroup,
  updatePricingRule,
  updateStayConstraint,
  type PricingGroupPayload,
  type PricingRulePayload,
  type StayConstraintPayload,
} from '../api/pmsApi'
import { BookingLimits } from '../components/pricing/BookingLimits'
import { displayOrder } from '../components/pricing/displayOrder'
import { GroupSection } from '../components/pricing/GroupSection'
import { TestStayBar, type TestStay } from '../components/pricing/TestStayBar'
import type {
  PricingGroupRecord,
  PricingQuote,
  PricingRuleRecord,
  PropertyListing,
  RuleReport,
  StayConstraintRecord,
} from '../types/domain'
import { activePlatform } from '../api/client'
import { toDateInputValue } from '../utils/date'
import '../styles/pricing-rules.css'

const PLATFORM_LABEL: Record<string, string> = { airstay: 'AirStay', fleet: 'Fleet' }

function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toDateInputValue(d)
}

// A week-long stay a month out: long enough to trip the seeded long-stay
// tiers, far enough out to leave last-minute rules alone. A first-time visitor
// therefore lands on a page where several rules are visibly doing something.
const DEFAULT_STAY: TestStay = {
  propertyId: '',
  checkIn: daysFromNow(30),
  checkOut: daysFromNow(37),
  promoCode: '',
}

export function PricingRulesPage() {
  const platform = activePlatform()
  const [groups, setGroups] = useState<PricingGroupRecord[]>([])
  const [rules, setRules] = useState<PricingRuleRecord[]>([])
  const [constraints, setConstraints] = useState<StayConstraintRecord[]>([])
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [stay, setStay] = useState<TestStay>(DEFAULT_STAY)
  const [quote, setQuote] = useState<PricingQuote | null>(null)
  const [promoError, setPromoError] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [g, r, c, props] = await Promise.all([
        fetchPricingGroups(),
        fetchPricingRules(),
        fetchStayConstraints(),
        fetchProperties(true),
      ])
      setGroups([...g].sort((a, b) => a.sortOrder - b.sortOrder))
      setRules(r)
      setConstraints(c)
      setProperties(props)
      // Test the first property by default, so the page explains itself
      // without the user having to set anything up first.
      setStay((s) => (s.propertyId || props.length === 0 ? s : { ...s, propertyId: props[0].id }))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load pricing data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  // ── The tested stay ─────────────────────────────────────────────────────
  // Re-priced whenever the stay OR the rules change, so an edit is reflected
  // the moment it saves. Debounced because typing a promo code fires this on
  // every keystroke. `ignore` drops a slow response that a newer one has
  // already superseded.

  useEffect(() => {
    if (!stay.propertyId || !stay.checkIn || !stay.checkOut) {
      setQuote(null)
      setPromoError('')
      setPreviewError('')
      setPreviewing(false)
      return
    }

    let ignore = false
    setPreviewing(true)
    const timer = setTimeout(async () => {
      try {
        const result = await fetchPricingPreview({
          propertyId: stay.propertyId,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          promoCode: stay.promoCode || undefined,
        })
        if (ignore) return
        setQuote(result.preview)
        setPromoError(result.promoError)
        setPreviewError('')
      } catch (e: unknown) {
        if (ignore) return
        setQuote(null)
        setPreviewError(e instanceof Error ? e.message : 'Could not price this stay.')
      } finally {
        if (!ignore) setPreviewing(false)
      }
    }, 350)

    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [stay, rules, constraints])

  /** The engine's verdict on each rule, keyed by rule id. */
  const reports = useMemo(() => {
    const map = new Map<string, RuleReport>()
    for (const report of quote?.rules ?? []) map.set(report.id, report)
    return map
  }, [quote])

  const testing = quote !== null

  function rulesForGroup(group: PricingGroupRecord): PricingRuleRecord[] {
    // A best-price group orders itself by discount; the rest keep the order
    // they were arranged in. See displayOrder.
    return displayOrder(group.behaviour, rules.filter((r) => r.groupId === group.id))
  }

  // ── Groups ──────────────────────────────────────────────────────────────

  async function handleEditGroup(groupId: string, patch: Partial<PricingGroupPayload>) {
    const updated = await updatePricingGroup(groupId, patch)
    setGroups((prev) => [...prev.map((g) => (g.id === groupId ? updated : g))].sort((a, b) => a.sortOrder - b.sortOrder))
  }

  async function handleDeleteGroup(groupId: string) {
    await deletePricingGroup(groupId)
    setGroups((prev) => prev.filter((g) => g.id !== groupId))
  }

  // ── Rules ───────────────────────────────────────────────────────────────

  async function handleMoveRule(groupId: string, ruleId: string, direction: 'up' | 'down') {
    const group = groups.find((g) => g.id === groupId)
    if (!group) return
    const sorted = rulesForGroup(group)
    const idx = sorted.findIndex((r) => r.id === ruleId)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return
    const ids = sorted.map((r) => r.id)
    ;[ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]]
    try {
      await reorderPricingRules(groupId, ids)
      await loadAll()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not reorder rules.')
    }
  }

  async function handleSaveRule(id: string, patch: Partial<PricingRulePayload>) {
    const updated = await updatePricingRule(id, patch)
    setRules((prev) => prev.map((r) => (r.id === id ? updated : r)))
  }

  async function handleDeleteRule(id: string) {
    await deletePricingRule(id)
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  async function handleAddRule(groupId: string, payload: PricingRulePayload) {
    // The form's Advanced section can move a rule to another group, so trust
    // the payload's groupId over the group the Add button belonged to.
    const created = await createPricingRule({ ...payload, groupId: payload.groupId || groupId })
    setRules((prev) => [...prev, created])
  }

  // ── Booking limits ──────────────────────────────────────────────────────

  async function handleAddConstraint(payload: StayConstraintPayload) {
    const created = await createStayConstraint(payload)
    setConstraints((prev) => [...prev, created])
  }

  async function handleToggleConstraint(id: string, enabled: boolean) {
    const updated = await updateStayConstraint(id, { enabled })
    setConstraints((prev) => prev.map((c) => (c.id === id ? updated : c)))
  }

  async function handleDeleteConstraint(id: string) {
    try {
      await deleteStayConstraint(id)
      setConstraints((prev) => prev.filter((c) => c.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete this limit.')
    }
  }

  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="pricing-page">
      {/* AirStay and Fleet keep separate rule sets, so the page has to say
          which one is on screen — editing the wrong one looks identical. */}
      <h2>
        Pricing <span className="pricing-platform">{PLATFORM_LABEL[platform] ?? platform}</span>
      </h2>

      <TestStayBar
        properties={properties}
        stay={stay}
        onChange={setStay}
        quote={quote}
        promoError={promoError}
        loading={previewing}
        error={previewError}
      />

      {error && <p className="pricing-error">{error}</p>}

      {loading ? (
        <div className="pricing-panel"><div className="pricing-empty">Loading…</div></div>
      ) : (
        <>
          <p className="pricing-lede">
            Every stay starts at the property’s base price. These steps then run in order,
            each one taking the price the step before it produced.
          </p>

          {sortedGroups.map((group, index) => (
            <GroupSection
              key={group.id}
              group={group}
              step={index + 1}
              rules={rulesForGroup(group)}
              properties={properties}
              groups={sortedGroups}
              allRules={rules}
              reports={reports}
              testing={testing}
              onEditGroup={handleEditGroup}
              onDeleteGroup={handleDeleteGroup}
              onSaveRule={handleSaveRule}
              onDeleteRule={handleDeleteRule}
              onMoveRule={handleMoveRule}
              onAddRule={handleAddRule}
            />
          ))}

          <BookingLimits
            constraints={constraints}
            properties={properties}
            blocking={(quote?.errors.length ?? 0) > 0}
            onAdd={handleAddConstraint}
            onToggle={handleToggleConstraint}
            onDelete={handleDeleteConstraint}
          />
        </>
      )}
    </div>
  )
}
