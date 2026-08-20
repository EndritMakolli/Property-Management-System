import { describe, expect, it } from 'vitest'
import type { PricingRuleRecord } from '../../types/domain'
import { stackedRanges } from './stackedRanges'

function adjust(overrides: Partial<PricingRuleRecord> = {}): PricingRuleRecord {
  return {
    id: 'r1',
    name: '',
    groupId: 'seasonal',
    ruleType: 'date_adjust',
    scope: 'all',
    propertyId: null,
    bedroomGroup: null,
    enabled: true,
    sortOrder: 0,
    application: 'per_night',
    isFinal: false,
    blocksGroupId: null,
    blocksRuleId: null,
    stacks: true,
    minNights: null,
    daysBeforeCheckin: null,
    startDate: '2026-07-10',
    endDate: '2026-08-10',
    adjustmentType: 'pct_increase',
    adjustmentValue: '10.00',
    code: null,
    usageLimit: null,
    usageCount: 0,
    minSubtotalEur: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as PricingRuleRecord
}

const SUMMER = adjust({ id: 'a', adjustmentValue: '10.00', startDate: '2026-07-10', endDate: '2026-08-10' })
const PEAK = adjust({ id: 'b', adjustmentValue: '15.00', startDate: '2026-07-25', endDate: '2026-08-05' })

/** Just the arithmetic, for tests that are not about who contributed. */
function totals(ranges: ReturnType<typeof stackedRanges>) {
  return ranges.map(({ from, to, pct }) => ({ from, to, pct }))
}

describe('stackedRanges', () => {
  it('is empty for a rule that does not stack', () => {
    expect(stackedRanges(adjust({ stacks: false }), [SUMMER])).toEqual([])
  })

  it('is empty for a rule with no dates', () => {
    expect(stackedRanges(adjust({ startDate: null, endDate: null }), [SUMMER])).toEqual([])
  })

  it('reports the rule alone when nothing overlaps it', () => {
    const lone = adjust({ id: 'c', adjustmentValue: '20.00', startDate: '2026-12-01', endDate: '2026-12-05' })
    expect(totals(stackedRanges(lone, [SUMMER, PEAK]))).toEqual([
      { from: '2026-12-01', to: '2026-12-05', pct: 20 },
    ])
  })

  it('adds an overlapping rule over the dates they share', () => {
    // PEAK sits entirely inside SUMMER, so all of it is 10 + 15.
    expect(totals(stackedRanges(PEAK, [SUMMER]))).toEqual([
      { from: '2026-07-25', to: '2026-08-05', pct: 25 },
    ])
  })

  it('splits into sub-ranges when overlaps differ', () => {
    // The operator's example: a third rule spanning both boundaries.
    const festival = adjust({
      id: 'c',
      adjustmentValue: '30.00',
      startDate: '2026-07-21',
      endDate: '2026-08-02',
    })
    expect(totals(stackedRanges(festival, [SUMMER, PEAK]))).toEqual([
      { from: '2026-07-21', to: '2026-07-24', pct: 40 }, // 10 + 30
      { from: '2026-07-25', to: '2026-08-02', pct: 55 }, // 10 + 15 + 30
    ])
  })

  it('nets an increase against a decrease over the same nights', () => {
    const cut = adjust({
      id: 'c',
      adjustmentType: 'pct_decrease',
      adjustmentValue: '5.00',
      startDate: '2026-07-25',
      endDate: '2026-08-05',
    })
    expect(totals(stackedRanges(cut, [PEAK]))).toEqual([
      { from: '2026-07-25', to: '2026-08-05', pct: 10 }, // 15 - 5
    ])
  })

  it('ignores a rule that is disabled', () => {
    expect(totals(stackedRanges(PEAK, [{ ...SUMMER, enabled: false }]))).toEqual([
      { from: '2026-07-25', to: '2026-08-05', pct: 15 },
    ])
  })

  it('ignores a rule that does not itself stack', () => {
    expect(totals(stackedRanges(PEAK, [{ ...SUMMER, stacks: false }]))).toEqual([
      { from: '2026-07-25', to: '2026-08-05', pct: 15 },
    ])
  })

  it('ignores a rule of another kind', () => {
    const seasonalRate = { ...SUMMER, ruleType: 'seasonal' as const, adjustmentType: 'fixed_price' as const }
    expect(totals(stackedRanges(PEAK, [seasonalRate]))).toEqual([
      { from: '2026-07-25', to: '2026-08-05', pct: 15 },
    ])
  })

  it('ignores the rule itself when it appears in the list', () => {
    expect(totals(stackedRanges(PEAK, [SUMMER, PEAK]))).toEqual([
      { from: '2026-07-25', to: '2026-08-05', pct: 25 },
    ])
  })

  it('ignores a rule aimed at a different property', () => {
    const elsewhere = { ...SUMMER, scope: 'property' as const, propertyId: 'other' }
    const mine = adjust({ id: 'c', scope: 'property', propertyId: 'mine', adjustmentValue: '20.00' })
    expect(totals(stackedRanges(mine, [elsewhere]))).toEqual([
      { from: '2026-07-10', to: '2026-08-10', pct: 20 },
    ])
  })

  it('names the other rules in force over each sub-range', () => {
    const festival = adjust({
      id: 'c',
      name: 'Festival',
      adjustmentValue: '30.00',
      startDate: '2026-07-21',
      endDate: '2026-08-02',
    })
    const named = [
      { ...SUMMER, name: 'Summer loading' },
      { ...PEAK, name: 'Peak fortnight' },
    ]
    expect(stackedRanges(festival, named).map((r) => r.partners)).toEqual([
      ['Summer loading'],
      ['Summer loading', 'Peak fortnight'],
    ])
  })

  it('falls back to the percentage when a partner has no name', () => {
    expect(stackedRanges(PEAK, [{ ...SUMMER, name: '' }])[0].partners).toEqual(['+10%'])
  })

  it('reports no partners where nothing else is in force', () => {
    const lone = adjust({ id: 'c', startDate: '2026-12-01', endDate: '2026-12-05' })
    expect(stackedRanges(lone, [SUMMER])[0].partners).toEqual([])
  })

  it('counts an all-properties rule against a property-scoped one', () => {
    const mine = adjust({
      id: 'c',
      scope: 'property',
      propertyId: 'mine',
      adjustmentValue: '20.00',
      startDate: '2026-07-25',
      endDate: '2026-08-05',
    })
    expect(totals(stackedRanges(mine, [SUMMER]))).toEqual([
      { from: '2026-07-25', to: '2026-08-05', pct: 30 },
    ])
  })
})
