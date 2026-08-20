import { describe, expect, it } from 'vitest'
import type { PricingQuote, RuleReport } from '../../types/domain'
import { buildCalculation } from './quoteCalculation'

function report(overrides: Partial<RuleReport> = {}): RuleReport {
  return {
    id: 'r1',
    name: 'A rule',
    type: 'long_stay',
    group: 'Length of Stay Discounts',
    application: 'whole_stay',
    status: 'applied',
    reason: '',
    amount: '36.75',
    ...overrides,
  }
}

function quote(overrides: Partial<PricingQuote> = {}): PricingQuote {
  const nights = overrides.nightlyBreakdown ?? [
    { date: '2026-06-01', rate: '35.00', locked: false, ruleIds: ['b1'] },
    { date: '2026-06-02', rate: '35.00', locked: false, ruleIds: ['b1'] },
  ]
  return {
    baseNightly: '35.00',
    effectiveNightly: '35.00',
    hasSeasonal: false,
    subtotal: '70.00',
    longStayPct: '0',
    longStayAmount: '0',
    lastMinutePct: '0',
    lastMinuteAmount: '0',
    nonRefundablePct: '0',
    nonRefundableAmount: '0',
    promoAmount: '0',
    total: '70.00',
    firstNightPrice: '35.00',
    averageNightlyRate: '35.00',
    protectedTotal: '0.00',
    nights: nights.length,
    minNightsRequired: 0,
    errors: [],
    nightlyBreakdown: nights,
    rules: [],
    ...overrides,
  }
}

describe('the opening term', () => {
  it('multiplies when every night costs the same', () => {
    expect(buildCalculation(quote()).opening).toBe('2 nights × €35')
  })

  it('says night, singular, for a one-night stay', () => {
    const single = quote({
      nightlyBreakdown: [{ date: '2026-06-01', rate: '35.00', locked: false, ruleIds: ['b1'] }],
      subtotal: '35.00',
      total: '35.00',
    })
    expect(buildCalculation(single).opening).toBe('1 night × €35')
  })

  it('drops the multiplication when nights are priced differently', () => {
    // A seasonal rule covering part of the stay: there is no single rate to
    // multiply by, and inventing one would misstate the arithmetic.
    const mixed = quote({
      nightlyBreakdown: [
        { date: '2026-06-01', rate: '35.00', locked: false, ruleIds: ['b1'] },
        { date: '2026-06-02', rate: '62.00', locked: false, ruleIds: ['s1'] },
      ],
      subtotal: '97.00',
      total: '97.00',
    })
    expect(buildCalculation(mixed).opening).toBe('2 nights')
  })

  it('keeps cents when a rate has them', () => {
    const odd = quote({
      nightlyBreakdown: [
        { date: '2026-06-01', rate: '35.50', locked: false, ruleIds: ['b1'] },
        { date: '2026-06-02', rate: '35.50', locked: false, ruleIds: ['b1'] },
      ],
      subtotal: '71.00',
    })
    expect(buildCalculation(odd).opening).toBe('2 nights × €35.50')
  })
})

describe('the steps between subtotal and total', () => {
  it('is empty when nothing adjusted the total', () => {
    expect(buildCalculation(quote()).steps).toEqual([])
  })

  it('shows a whole-stay discount as money taken off', () => {
    const discounted = quote({
      subtotal: '245.00',
      total: '208.25',
      rules: [report({ name: '7+ nights − 15%', amount: '36.75' })],
    })
    expect(buildCalculation(discounted).steps).toEqual([
      { label: '7+ nights − 15%', delta: '− €36.75' },
    ])
  })

  it('shows a whole-stay increase as money added', () => {
    // Pass 2 reports money TAKEN, so an increase arrives negative.
    const surcharge = quote({
      subtotal: '70.00',
      total: '77.00',
      rules: [report({ name: 'Peak surcharge', amount: '-7.00' })],
    })
    expect(buildCalculation(surcharge).steps).toEqual([
      { label: 'Peak surcharge', delta: '+ €7' },
    ])
  })

  it('lists several adjustments in the order they applied', () => {
    const stacked = quote({
      subtotal: '245.00',
      total: '190.00',
      rules: [
        report({ id: 'a', name: '7+ nights − 15%', amount: '36.75' }),
        report({ id: 'b', name: 'Promo TEN', amount: '18.25' }),
      ],
    })
    expect(buildCalculation(stacked).steps.map((s) => s.label)).toEqual([
      '7+ nights − 15%',
      'Promo TEN',
    ])
  })

  it('ignores per-night rules, which are already inside the subtotal', () => {
    const seasonal = quote({
      rules: [report({ name: 'Summer rate', application: 'per_night', amount: '20.00' })],
    })
    expect(buildCalculation(seasonal).steps).toEqual([])
  })

  it('ignores rules that did not apply', () => {
    const skipped = quote({
      rules: [report({ name: '28+ nights', status: 'not_eligible', amount: '0' })],
    })
    expect(buildCalculation(skipped).steps).toEqual([])
  })

  it('ignores an applied rule that moved no money', () => {
    const nothing = quote({ rules: [report({ name: 'All nights locked', amount: '0' })] })
    expect(buildCalculation(nothing).steps).toEqual([])
  })
})

describe('the closing terms', () => {
  it('reports the subtotal, total and nightly average', () => {
    const c = buildCalculation(
      quote({
        subtotal: '245.00',
        total: '208.25',
        averageNightlyRate: '29.75',
        rules: [report({ name: '7+ nights − 15%', amount: '36.75' })],
      }),
    )
    expect(c.subtotal).toBe('€245')
    expect(c.total).toBe('€208.25')
    expect(c.average).toBe('€29.75')
  })

  it('reads end to end as the sum it describes', () => {
    const c = buildCalculation(
      quote({
        nightlyBreakdown: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-06-0${i + 1}`,
          rate: '35.00',
          locked: false,
          ruleIds: ['b1'],
        })),
        subtotal: '245.00',
        total: '208.25',
        averageNightlyRate: '29.75',
        rules: [report({ name: '7+ nights − 15%', amount: '36.75' })],
      }),
    )
    const line = `${c.opening} = ${c.subtotal} ${c.steps
      .map((s) => `${s.delta} (${s.label})`)
      .join(' ')} = ${c.total} total · avg ${c.average}/night`
    expect(line).toBe(
      '7 nights × €35 = €245 − €36.75 (7+ nights − 15%) = €208.25 total · avg €29.75/night',
    )
  })
})
