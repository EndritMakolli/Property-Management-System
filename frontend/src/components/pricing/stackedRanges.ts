// What a stacking date adjustment actually adds up to.
//
// Stacking percentages ADD rather than compound (see _pricing_engine pass 1),
// so three overlapping loadings of 10%, 15% and 30% make 55%. The overlaps
// rarely line up, though: each rule has its own window, so the combined figure
// changes partway through. This works out the sub-ranges and their totals, so
// the form can say what the rule being written will really do.

import type { PricingRuleRecord } from '../../types/domain'

export type StackedRange = {
  from: string
  to: string
  /** Combined percentage, signed: 55 raises, -20 lowers. */
  pct: number
  /** The OTHER rules in force over this sub-range, named for a reader.
   *  Empty means the rule is on its own here. */
  partners: string[]
}

/** The subset of a rule this needs. Satisfied by a saved rule and a draft. */
export type StackableLike = Pick<
  PricingRuleRecord,
  | 'ruleType'
  | 'scope'
  | 'propertyId'
  | 'bedroomGroup'
  | 'startDate'
  | 'endDate'
  | 'adjustmentType'
  | 'adjustmentValue'
  | 'stacks'
> & { id?: string; enabled?: boolean; name?: string }

/** How to refer to a partner rule. Unnamed rules are common — most of these
 *  forms do not ask for a name — so fall back to what it actually does. */
function partnerLabel(rule: StackableLike): string {
  const named = (rule.name ?? '').trim()
  if (named) return named
  const pct = signedPct(rule)
  return `${pct > 0 ? '+' : ''}${pct}%`
}

function signedPct(rule: StackableLike): number {
  const value = Number(rule.adjustmentValue ?? 0)
  if (!Number.isFinite(value)) return 0
  if (rule.adjustmentType === 'pct_increase') return value
  if (rule.adjustmentType === 'pct_decrease') return -value
  return 0
}

function isStackingAdjustment(rule: StackableLike): boolean {
  return (
    rule.ruleType === 'date_adjust' &&
    rule.stacks === true &&
    (rule.adjustmentType === 'pct_increase' || rule.adjustmentType === 'pct_decrease') &&
    rule.adjustmentValue !== null &&
    Boolean(rule.startDate) &&
    Boolean(rule.endDate)
  )
}

/** Two rules can both reach a property when neither aims somewhere the other
 *  cannot follow. 'all' reaches everything, so it always overlaps. */
function aimsOverlap(a: StackableLike, b: StackableLike): boolean {
  if (a.scope === 'all' || b.scope === 'all') return true
  if (a.scope !== b.scope) return false
  if (a.scope === 'property') return a.propertyId === b.propertyId
  return a.bedroomGroup === b.bedroomGroup
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function toIso(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(iso: string, days: number): string {
  const date = toDate(iso)
  date.setDate(date.getDate() + days)
  return toIso(date)
}

/** Sub-ranges of `rule`'s window, each with the total percentage in force. */
export function stackedRanges(rule: StackableLike, others: StackableLike[]): StackedRange[] {
  if (!isStackingAdjustment(rule)) return []
  const from = rule.startDate as string
  const to = rule.endDate as string

  const overlapping = others.filter(
    (other) =>
      (other.id === undefined || other.id !== rule.id) &&
      other.enabled !== false &&
      isStackingAdjustment(other) &&
      aimsOverlap(rule, other) &&
      // Windows touch at all: neither ends before the other begins.
      (other.startDate as string) <= to &&
      (other.endDate as string) >= from,
  )

  const all = [rule, ...overlapping]

  // Every point where the set of rules in force can change, clipped to this
  // rule's own window since that is all the form is describing.
  const boundaries = new Set<string>([from])
  for (const other of all) {
    for (const edge of [other.startDate as string, addDays(other.endDate as string, 1)]) {
      if (edge > from && edge <= to) boundaries.add(edge)
    }
  }

  const starts = [...boundaries].sort()
  const ranges: StackedRange[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const segmentFrom = starts[i]
    const segmentTo = i + 1 < starts.length ? addDays(starts[i + 1], -1) : to
    const inForce = all.filter(
      (r) => (r.startDate as string) <= segmentFrom && (r.endDate as string) >= segmentTo,
    )
    const pct = inForce.reduce((sum, r) => sum + signedPct(r), 0)
    const partners = inForce.filter((r) => r !== rule).map(partnerLabel)

    const previous = ranges[ranges.length - 1]
    if (previous && previous.pct === pct) {
      // Adjacent segments with the same total are one range to a reader.
      previous.to = segmentTo
    } else {
      ranges.push({ from: segmentFrom, to: segmentTo, pct, partners })
    }
  }
  return ranges
}
