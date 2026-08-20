import { describe, expect, it } from 'vitest'
import type { PricingRuleRecord } from '../../types/domain'
import { displayOrder, isAutoOrdered } from './displayOrder'

function tier(minNights: number, pct: string, sortOrder: number): PricingRuleRecord {
  return {
    id: `t${minNights}`,
    name: `${minNights}+ nights`,
    groupId: 'g',
    ruleType: 'long_stay',
    scope: 'all',
    propertyId: null,
    bedroomGroup: null,
    enabled: true,
    sortOrder,
    application: 'whole_stay',
    isFinal: false,
    stacks: false,
    blocksGroupId: null,
    blocksRuleId: null,
    minNights,
    daysBeforeCheckin: null,
    startDate: null,
    endDate: null,
    adjustmentType: 'pct_decrease',
    adjustmentValue: pct,
    code: null,
    usageLimit: null,
    usageCount: 0,
    minSubtotalEur: null,
    createdAt: '2026-01-01T00:00:00Z',
  } as PricingRuleRecord
}

// Stored smallest-first, which is how the ladder ends up after a reorder.
const LADDER = [
  tier(5, '10.00', 0),
  tier(7, '15.00', 1),
  tier(10, '20.00', 2),
  tier(14, '25.00', 3),
  tier(21, '28.00', 4),
  tier(28, '30.00', 5),
]

describe('isAutoOrdered', () => {
  it('orders a best-price group for itself', () => {
    expect(isAutoOrdered('best')).toBe(true)
  })

  it('leaves every other group to be ordered by hand', () => {
    expect(isAutoOrdered('stack')).toBe(false)
    expect(isAutoOrdered('exclusive')).toBe(false)
    expect(isAutoOrdered('specific')).toBe(false)
  })
})

describe('displayOrder', () => {
  it('reads a best-price ladder biggest discount first', () => {
    // The engine picks the biggest applicable discount, so the list should
    // read in the order the engine prefers, whatever sortOrder says.
    expect(displayOrder('best', LADDER).map((r) => r.minNights)).toEqual([
      28, 21, 14, 10, 7, 5,
    ])
  })

  it('does not care what sortOrder says', () => {
    const shuffled = [LADDER[3], LADDER[0], LADDER[5], LADDER[1]]
    expect(displayOrder('best', shuffled).map((r) => r.minNights)).toEqual([28, 14, 7, 5])
  })

  it('ranks by the discount, not by the night threshold', () => {
    // A short stay given a bigger cut really does beat a longer one, and the
    // engine would pick it, so it must read first.
    const odd = [tier(28, '20.00', 0), tier(10, '50.00', 1)]
    expect(displayOrder('best', odd).map((r) => r.minNights)).toEqual([10, 28])
  })

  it('breaks a tie on the longer stay, then on sortOrder', () => {
    const tied = [tier(7, '20.00', 5), tier(21, '20.00', 9)]
    expect(displayOrder('best', tied).map((r) => r.minNights)).toEqual([21, 7])
  })

  it('puts a rule with no amount last rather than first', () => {
    const unfinished = { ...tier(9, '0', 0), adjustmentValue: null }
    expect(displayOrder('best', [unfinished, LADDER[0]]).map((r) => r.minNights)).toEqual([
      5, 9,
    ])
  })

  it('keeps hand-sorted groups in their sortOrder', () => {
    const shuffled = [LADDER[3], LADDER[0], LADDER[5], LADDER[1]]
    expect(displayOrder('stack', shuffled).map((r) => r.sortOrder)).toEqual([0, 1, 3, 5])
  })

  it('never mutates the list it was given', () => {
    const original = [...LADDER]
    displayOrder('best', LADDER)
    expect(LADDER).toEqual(original)
  })
})
