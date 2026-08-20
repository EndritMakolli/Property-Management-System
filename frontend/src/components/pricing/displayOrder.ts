// The order a group's rules are read in.
//
// Most groups are read in the order the operator arranged them. A best-price
// group is not: the engine picks whichever eligible rule takes the most money
// off, so a ladder stored 5-nights-first still prices correctly but READS as
// though the wrong tier won — five tiers marked "overridden" above the one
// that applied. Ordering it by discount instead makes the list say what the
// engine is doing, and removes a way to arrange it misleadingly.

import type { PricingGroupRecord, PricingRuleRecord } from '../../types/domain'

/** Whether the group orders itself rather than being arranged by hand. */
export function isAutoOrdered(behaviour: PricingGroupRecord['behaviour']): boolean {
  return behaviour === 'best'
}

/** How much this rule takes off, for ranking. Not a price — the real figure
 *  depends on the stay — but it ranks a homogeneous ladder the way the engine
 *  would, which is what a reader needs. */
function discountSize(rule: PricingRuleRecord): number {
  const value = Number(rule.adjustmentValue ?? 0)
  if (!Number.isFinite(value)) return 0
  return rule.adjustmentType === 'pct_increase' || rule.adjustmentType === 'fixed_increase'
    ? -value
    : value
}

export function displayOrder(
  behaviour: PricingGroupRecord['behaviour'],
  rules: PricingRuleRecord[],
): PricingRuleRecord[] {
  if (!isAutoOrdered(behaviour)) {
    return [...rules].sort((a, b) => a.sortOrder - b.sortOrder)
  }
  return [...rules].sort(
    (a, b) =>
      discountSize(b) - discountSize(a) ||
      // Equal discounts: the longer stay is the more specific offer.
      (b.minNights ?? 0) - (a.minNights ?? 0) ||
      a.sortOrder - b.sortOrder,
  )
}
