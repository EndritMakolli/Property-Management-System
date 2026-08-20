import { describe, expect, it } from 'vitest'
import type { PropertyListing } from '../../types/domain'
import { amountPhrase, constraintSentence, ruleSentence, scopeLabel, type RuleLike } from './ruleSentence'

const PROPERTIES = [
  { id: 'p1', name: 'Apartment A', bedrooms: 2 },
  { id: 'p2', name: 'Apartment B', bedrooms: 1 },
] as PropertyListing[]

function rule(overrides: Partial<RuleLike> = {}): RuleLike {
  return {
    ruleType: 'long_stay',
    application: 'whole_stay',
    scope: 'all',
    propertyId: null,
    bedroomGroup: null,
    adjustmentType: 'pct_decrease',
    adjustmentValue: '10.00',
    minNights: null,
    daysBeforeCheckin: null,
    startDate: null,
    endDate: null,
    code: null,
    stacks: false,
    ...overrides,
  }
}

describe('amountPhrase', () => {
  it('drops the trailing zeros the backend sends', () => {
    expect(amountPhrase('pct_decrease', '10.00')).toBe('get 10% off')
  })

  it('keeps a meaningful decimal', () => {
    expect(amountPhrase('pct_decrease', '12.50')).toBe('get 12.5% off')
  })

  it('reads a percentage increase as costing more', () => {
    expect(amountPhrase('pct_increase', '10.00')).toBe('cost 10% more')
  })

  it('reads a fixed price as a nightly rate', () => {
    expect(amountPhrase('fixed_price', '80.00')).toBe('are priced at €80 per night')
  })

  it('reads a fixed decrease in euros', () => {
    expect(amountPhrase('fixed_decrease', '15.00')).toBe('get €15 off')
  })

  it('reads a fixed increase in euros', () => {
    expect(amountPhrase('fixed_increase', '15.00')).toBe('cost €15 more')
  })

  it('says so when no amount is set', () => {
    expect(amountPhrase('pct_decrease', null)).toBe('have no amount set yet')
    expect(amountPhrase('', '10.00')).toBe('have no amount set yet')
  })
})

describe('ruleSentence', () => {
  it('describes a base price as the rate of every night', () => {
    const sentence = ruleSentence(
      rule({ ruleType: 'base_price', application: 'per_night', adjustmentType: 'fixed_price', adjustmentValue: '35.00' }),
      PROPERTIES,
    )
    expect(sentence).toBe('Every night costs €35, at every property.')
  })

  it('describes a base price scoped to a bedroom group', () => {
    const sentence = ruleSentence(
      rule({
        ruleType: 'base_price',
        application: 'per_night',
        adjustmentType: 'fixed_price',
        adjustmentValue: '45.00',
        scope: 'bedroom_group',
        bedroomGroup: 2,
      }),
      PROPERTIES,
    )
    expect(sentence).toBe('Every night costs €45, at 2-bedroom apartments.')
  })

  it('flags a base price with no amount yet', () => {
    const sentence = ruleSentence(
      rule({ ruleType: 'base_price', application: 'per_night', adjustmentType: 'fixed_price', adjustmentValue: null }),
      PROPERTIES,
    )
    expect(sentence).toContain('no amount set yet')
  })

  it('spells out what a stacking adjustment comes to', () => {
    const own = rule({
      ruleType: 'date_adjust',
      application: 'per_night',
      adjustmentType: 'pct_increase',
      adjustmentValue: '10.00',
      startDate: '2026-08-25',
      endDate: '2026-09-05',
      stacks: true,
    })
    const peak = {
      ...own,
      name: 'Peak',
      adjustmentValue: '15.00',
      startDate: '2026-08-25',
      endDate: '2026-08-31',
    }
    expect(ruleSentence(own, PROPERTIES, [peak])).toBe(
      'Nights from 25-Aug-2026 to 05-Sep-2026 cost 10% more, at every property. ' +
        'Stacked with Peak: these dates total between +10% and +25%.',
    )
  })

  it('gives one total when the whole window stacks the same way', () => {
    const own = rule({
      ruleType: 'date_adjust',
      application: 'per_night',
      adjustmentType: 'pct_increase',
      adjustmentValue: '15.00',
      startDate: '2026-08-25',
      endDate: '2026-08-31',
      stacks: true,
    })
    // A wider rule covering all of it: one total, no range.
    const summer = {
      ...own,
      name: 'Summer',
      adjustmentValue: '10.00',
      startDate: '2026-08-01',
      endDate: '2026-09-30',
    }
    expect(ruleSentence(own, PROPERTIES, [summer])).toContain(
      'Stacked with Summer: these dates total +25%.',
    )
  })

  it('stays short on the widest rule, which everything else overlaps', () => {
    // The rule others stack onto is the baseline, not the complicated one —
    // it must not collect the longest description.
    const broad = rule({
      ruleType: 'date_adjust',
      application: 'per_night',
      adjustmentType: 'pct_increase',
      adjustmentValue: '10.00',
      startDate: '2026-07-10',
      endDate: '2026-08-20',
      stacks: true,
    })
    const partners = [
      { ...broad, name: 'Peak', adjustmentValue: '15.00', startDate: '2026-07-25', endDate: '2026-08-05' },
      { ...broad, name: 'Festival', adjustmentValue: '30.00', startDate: '2026-07-21', endDate: '2026-08-02' },
    ]
    const sentence = ruleSentence(broad, PROPERTIES, partners)
    // Named in the order they first take effect: Festival starts 21 Jul,
    // Peak 25 Jul.
    expect(sentence).toContain('Stacked with Festival, Peak: these dates total between +10% and +55%.')
    expect(sentence.split(';')).toHaveLength(1)
  })

  it('says nothing about stacking when nothing overlaps', () => {
    const own = rule({
      ruleType: 'date_adjust',
      application: 'per_night',
      adjustmentType: 'pct_increase',
      adjustmentValue: '10.00',
      startDate: '2026-08-25',
      endDate: '2026-09-05',
      stacks: true,
    })
    expect(ruleSentence(own, PROPERTIES, [])).toBe(
      'Nights from 25-Aug-2026 to 05-Sep-2026 cost 10% more, at every property.',
    )
  })

  it('says nothing about stacking for a rule that does not stack', () => {
    const own = rule({
      ruleType: 'date_adjust',
      application: 'per_night',
      adjustmentType: 'pct_increase',
      adjustmentValue: '10.00',
      startDate: '2026-08-25',
      endDate: '2026-09-05',
      stacks: false,
    })
    const peak = { ...own, name: 'Peak', stacks: true, adjustmentValue: '15.00' }
    expect(ruleSentence(own, PROPERTIES, [peak])).not.toContain('Stacked with')
  })

  it('describes an exclusion by the dates it protects', () => {
    const sentence = ruleSentence(
      rule({
        ruleType: 'block_discounts',
        application: 'per_night',
        adjustmentType: '',
        adjustmentValue: null,
        startDate: '2026-07-10',
        endDate: '2026-08-20',
      }),
      PROPERTIES,
    )
    expect(sentence).toBe(
      'Nights from 10-Jul-2026 to 20-Aug-2026 keep their price — no whole-stay discount applies, at every property.',
    )
  })

  it('describes an undated exclusion as covering all nights', () => {
    const sentence = ruleSentence(
      rule({ ruleType: 'block_discounts', application: 'per_night', adjustmentType: '', adjustmentValue: null }),
      PROPERTIES,
    )
    expect(sentence).toContain('All nights')
  })

  it('describes a long-stay discount by its night threshold', () => {
    expect(ruleSentence(rule({ minNights: 7 }), PROPERTIES)).toBe(
      'Stays of 7+ nights get 10% off, at every property.',
    )
  })

  it('describes a long-stay rule with no threshold as applying to every stay', () => {
    expect(ruleSentence(rule(), PROPERTIES)).toBe('Every stay gets 10% off, at every property.')
  })

  it('describes a per-night seasonal rule by its date window', () => {
    const sentence = ruleSentence(
      rule({
        ruleType: 'seasonal',
        application: 'per_night',
        adjustmentType: 'pct_increase',
        startDate: '2026-06-01',
        endDate: '2026-08-31',
      }),
      PROPERTIES,
    )
    expect(sentence).toBe('Nights from 01-Jun-2026 to 31-Aug-2026 cost 10% more, at every property.')
  })

  it('describes an undated seasonal rule as covering every night', () => {
    const sentence = ruleSentence(
      rule({ ruleType: 'seasonal', application: 'per_night', adjustmentType: 'pct_increase' }),
      PROPERTIES,
    )
    expect(sentence).toBe('Every night costs 10% more, at every property.')
  })

  it('describes a last-minute rule by its booking window', () => {
    expect(ruleSentence(rule({ ruleType: 'last_minute', daysBeforeCheckin: 30 }), PROPERTIES)).toBe(
      'Stays booked 30 days or fewer before check-in get 10% off, at every property.',
    )
  })

  it('flags a last-minute rule that has no window set', () => {
    expect(ruleSentence(rule({ ruleType: 'last_minute' }), PROPERTIES)).toContain('no booking window set')
  })

  it('describes a non-refundable rule', () => {
    expect(ruleSentence(rule({ ruleType: 'non_refundable' }), PROPERTIES)).toBe(
      'Non-refundable bookings get 10% off, at every property.',
    )
  })

  it('describes a promo rule by its code', () => {
    expect(ruleSentence(rule({ ruleType: 'promo', code: 'SUMMER20' }), PROPERTIES)).toBe(
      'Stays booked with code SUMMER20 get 10% off, at every property.',
    )
  })

  it('flags a promo rule with no code yet', () => {
    expect(ruleSentence(rule({ ruleType: 'promo' }), PROPERTIES)).toContain('no code set')
  })

  it('describes a manual rule as staff-applied', () => {
    expect(ruleSentence(rule({ ruleType: 'manual' }), PROPERTIES)).toBe(
      'Stays staff apply this to get 10% off, at every property.',
    )
  })

  it('names the property a property-scoped rule targets', () => {
    const sentence = ruleSentence(rule({ minNights: 7, scope: 'property', propertyId: 'p1' }), PROPERTIES)
    expect(sentence).toBe('Stays of 7+ nights get 10% off, at Apartment A.')
  })

  it('describes a bedroom-group scope', () => {
    const sentence = ruleSentence(rule({ minNights: 7, scope: 'bedroom_group', bedroomGroup: 2 }), PROPERTIES)
    expect(sentence).toBe('Stays of 7+ nights get 10% off, at 2-bedroom apartments.')
  })

  it('survives a property-scoped rule whose property is missing', () => {
    const sentence = ruleSentence(rule({ minNights: 7, scope: 'property', propertyId: 'gone' }), PROPERTIES)
    expect(sentence).toContain('the selected property')
  })
})

describe('scopeLabel', () => {
  it('labels an all-property rule', () => {
    expect(scopeLabel(rule(), PROPERTIES)).toBe('All')
  })

  it('labels a property-scoped rule with the property name', () => {
    expect(scopeLabel(rule({ scope: 'property', propertyId: 'p2' }), PROPERTIES)).toBe('Apartment B')
  })

  it('labels a bedroom-group rule', () => {
    expect(scopeLabel(rule({ scope: 'bedroom_group', bedroomGroup: 3 }), PROPERTIES)).toBe('3-bedroom')
  })
})

describe('constraintSentence', () => {
  const scoped = { scope: 'all' as const, propertyId: null, bedroomGroup: null }

  it('describes a minimum stay', () => {
    expect(
      constraintSentence({ ...scoped, kind: 'min_nights', value: 3, startDate: null, endDate: null }, PROPERTIES),
    ).toBe('Guests must book at least 3 nights, at every property.')
  })

  it('reads a one-night minimum in the singular', () => {
    expect(
      constraintSentence({ ...scoped, kind: 'min_nights', value: 1, startDate: null, endDate: null }, PROPERTIES),
    ).toContain('at least 1 night,')
  })

  it('describes a latest bookable date', () => {
    expect(
      constraintSentence(
        { ...scoped, kind: 'max_advance', value: null, startDate: null, endDate: '2026-12-31' },
        PROPERTIES,
      ),
    ).toBe(
      'Guests can book up to 31-Dec-2026, at every property. Nothing after that date can be reserved.',
    )
  })

  it('does not describe a cutoff as a date window', () => {
    // endDate is the cutoff for this kind, not the end of a period.
    const sentence = constraintSentence(
      { ...scoped, kind: 'max_advance', value: null, startDate: null, endDate: '2026-12-31' },
      PROPERTIES,
    )
    expect(sentence).not.toContain('up to 31-Dec-2026, at every property.,')
    expect(sentence).not.toContain('nights')
  })

  it('flags a cutoff that has not been set yet', () => {
    expect(
      constraintSentence({ ...scoped, kind: 'max_advance', value: null, startDate: null, endDate: null }, PROPERTIES),
    ).toContain('No latest bookable date set yet')
  })

  it('names the property a scoped limit targets', () => {
    expect(
      constraintSentence(
        { scope: 'property', propertyId: 'p1', bedroomGroup: null, kind: 'max_advance', value: null, startDate: null, endDate: '2026-12-31' },
        PROPERTIES,
      ),
    ).toContain('at Apartment A.')
  })
})
