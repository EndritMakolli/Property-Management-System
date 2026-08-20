import { describe, expect, it } from 'vitest'
import type { PricingRulePayload } from '../../api/bookingEngine'
import {
  amountUnitsFor,
  applyIntent,
  defaultIntentForGroup,
  intentFor,
  intentsForGroup,
  RULE_INTENTS,
  type RuleIntent,
} from './ruleIntents'

function payload(overrides: Partial<PricingRulePayload> = {}): PricingRulePayload {
  return {
    name: '',
    groupId: 'g1',
    ruleType: 'manual',
    scope: 'all',
    propertyId: null,
    bedroomGroup: null,
    enabled: true,
    sortOrder: 0,
    application: 'whole_stay',
    isFinal: false,
    minNights: null,
    daysBeforeCheckin: null,
    startDate: null,
    endDate: null,
    adjustmentType: 'pct_decrease',
    adjustmentValue: null,
    code: null,
    usageLimit: null,
    minSubtotalEur: null,
    blocksGroupId: null,
    blocksRuleId: null,
    stacks: false,
    ...overrides,
  }
}

const intent = (ruleType: PricingRulePayload['ruleType']): RuleIntent => intentFor(ruleType)

describe('RULE_INTENTS', () => {
  it('covers every rule type exactly once', () => {
    const types = RULE_INTENTS.map((i) => i.ruleType)
    expect([...types].sort()).toEqual(
      [
        'base_price',
        'block_discounts',
        'date_adjust',
        'last_minute',
        'long_stay',
        'manual',
        'non_refundable',
        'promo',
        'seasonal',
      ].sort(),
    )
  })

  it('offers the base price first, since it is what everything else adjusts', () => {
    expect(RULE_INTENTS[0].ruleType).toBe('base_price')
  })

  it('gives every intent a title, a blurb and a row label', () => {
    for (const i of RULE_INTENTS) {
      expect(i.title.length).toBeGreaterThan(0)
      expect(i.blurb.length).toBeGreaterThan(0)
      expect(i.rowLabel.length).toBeGreaterThan(0)
    }
  })

  it('gives each intent a row label that reads as a noun, not a prompt', () => {
    // `title` is an instruction ("Discount longer stays") and reads wrong as
    // the heading of a saved rule.
    expect(intentFor('long_stay').rowLabel).toBe('Length of stay discount')
    expect(intentFor('base_price').rowLabel).toBe('Base price')
  })
})

describe('which fields an intent shows', () => {
  it('asks a long-stay rule only for a night threshold', () => {
    expect(intent('long_stay').fields).toEqual(['minNights'])
  })

  it('files a long-stay rule with the tier ladder', () => {
    expect(intent('long_stay').groupName).toBe('Length of Stay Discounts')
  })

  it('asks a seasonal rule only for dates', () => {
    expect(intent('seasonal').fields).toEqual(['dates'])
  })

  it('asks a last-minute rule only for a booking window', () => {
    expect(intent('last_minute').fields).toEqual(['daysBeforeCheckin'])
  })

  it('asks a non-refundable rule for nothing extra', () => {
    expect(intent('non_refundable').fields).toEqual([])
  })

  it('asks a manual rule for nothing extra', () => {
    expect(intent('manual').fields).toEqual([])
  })

  it('asks a promo rule only for its code', () => {
    expect(intent('promo').fields).toEqual(['code'])
  })

  it('never shows a promo-only field on a non-promo rule', () => {
    // The validator rejects a code, usage limit or minimum spend on any
    // non-promo rule, so the form must not offer them.
    for (const i of RULE_INTENTS.filter((x) => x.ruleType !== 'promo')) {
      expect(i.fields).not.toContain('code')
      expect(i.fields).not.toContain('usageLimit')
      expect(i.fields).not.toContain('minSubtotal')
    }
  })
})

describe('base price', () => {
  it('asks for nothing beyond a name, an amount and a scope', () => {
    // No dates: a rate that only holds between two dates is a seasonal rule,
    // and the backend validator rejects dates on a base price.
    expect(intent('base_price').fields).toEqual([])
  })

  it('sets each night, so it is per-night and lives in Base Prices', () => {
    expect(intent('base_price').application).toBe('per_night')
    expect(intent('base_price').groupName).toBe('Base Prices')
  })

  it('is a minimal form: an amount and which apartments, nothing else', () => {
    expect(intent('base_price').minimal).toBe(true)
  })

  it('makes every group but Booking Discounts a minimal form', () => {
    const minimal = RULE_INTENTS.filter((i) => i.minimal).map((i) => i.ruleType)
    expect(minimal).toEqual([
      'base_price',
      'seasonal',
      'date_adjust',
      'block_discounts',
      'long_stay',
      'promo',
    ])
  })

  it('can only be a fixed nightly amount', () => {
    expect(amountUnitsFor('per_night', 'base_price').map((u) => u.value)).toEqual(['fixed_price'])
  })

  it('forces a fixed nightly price when switched to', () => {
    const next = applyIntent(payload({ adjustmentType: 'pct_decrease' }), intent('base_price'))
    expect(next.adjustmentType).toBe('fixed_price')
  })

  it('clears dates carried over from a seasonal rule', () => {
    const dated = payload({
      ruleType: 'seasonal',
      application: 'per_night',
      startDate: '2026-07-10',
      endDate: '2026-08-20',
    })
    const next = applyIntent(dated, intent('base_price'))
    expect(next.startDate).toBeNull()
    expect(next.endDate).toBeNull()
  })
})

describe('length of stay discounts', () => {
  it('asks only for a night threshold', () => {
    expect(intent('long_stay').fields).toEqual(['minNights'])
  })

  it('is a minimal form: nights, who it applies to, and a percentage', () => {
    expect(intent('long_stay').minimal).toBe(true)
  })

  it('offers only a percentage, which is what makes tiers comparable', () => {
    expect(amountUnitsFor('whole_stay', 'long_stay').map((u) => u.value)).toEqual(['pct_decrease'])
  })

  it('forces a percentage discount when switched to', () => {
    const next = applyIntent(payload({ adjustmentType: 'fixed_increase' }), intent('long_stay'))
    expect(next.adjustmentType).toBe('pct_decrease')
  })
})

describe('the application an intent pre-selects', () => {
  it('prices a seasonal rule per night', () => {
    expect(intent('seasonal').application).toBe('per_night')
  })

  it('applies every discount intent to the whole stay', () => {
    // Only the intents that act on individual nights are per-night.
    const perNight = ['seasonal', 'base_price', 'block_discounts', 'date_adjust']
    for (const i of RULE_INTENTS.filter((x) => !perNight.includes(x.ruleType))) {
      expect(i.application).toBe('whole_stay')
    }
  })

  it('sends a promo rule to the whole stay, since minimum spend needs a subtotal', () => {
    expect(intent('promo').application).toBe('whole_stay')
  })
})

describe('amountUnitsFor', () => {
  it('offers a fixed nightly price only to per-night rules', () => {
    expect(amountUnitsFor('per_night').map((u) => u.value)).toContain('fixed_price')
    expect(amountUnitsFor('whole_stay').map((u) => u.value)).not.toContain('fixed_price')
  })

  it('always offers the four relative adjustments', () => {
    for (const application of ['per_night', 'whole_stay'] as const) {
      const values = amountUnitsFor(application).map((u) => u.value)
      expect(values).toContain('pct_decrease')
      expect(values).toContain('pct_increase')
      expect(values).toContain('fixed_decrease')
      expect(values).toContain('fixed_increase')
    }
  })
})

describe('applyIntent', () => {
  it('sets the rule type and application', () => {
    const next = applyIntent(payload(), intent('seasonal'))
    expect(next.ruleType).toBe('seasonal')
    expect(next.application).toBe('per_night')
  })

  it('clears promo-only fields when leaving a promo rule', () => {
    const promo = payload({
      ruleType: 'promo',
      code: 'SUMMER20',
      usageLimit: 5,
      minSubtotalEur: '200.00',
    })
    const next = applyIntent(promo, intent('long_stay'))
    expect(next.code).toBeNull()
    expect(next.usageLimit).toBeNull()
    expect(next.minSubtotalEur).toBeNull()
  })

  it('clears a night threshold that the new type cannot use', () => {
    const next = applyIntent(payload({ ruleType: 'long_stay', minNights: 7 }), intent('non_refundable'))
    expect(next.minNights).toBeNull()
  })

  it('clears a booking window that the new type cannot use', () => {
    const next = applyIntent(payload({ ruleType: 'last_minute', daysBeforeCheckin: 30 }), intent('manual'))
    expect(next.daysBeforeCheckin).toBeNull()
  })

  it('clears dates that the new type cannot use', () => {
    const dated = payload({ ruleType: 'seasonal', startDate: '2026-06-01', endDate: '2026-08-31' })
    const next = applyIntent(dated, intent('non_refundable'))
    expect(next.startDate).toBeNull()
    expect(next.endDate).toBeNull()
  })

  it('clears dates when switching to a promo, which no longer asks for them', () => {
    const dated = payload({ ruleType: 'seasonal', startDate: '2026-06-01', endDate: '2026-08-31' })
    const next = applyIntent(dated, intent('promo'))
    expect(next.startDate).toBeNull()
    expect(next.endDate).toBeNull()
  })

  it('drops the final-price lock when moving to a whole-stay rule', () => {
    // The validator rejects is_final on anything but a per-night rule.
    const locked = payload({ ruleType: 'seasonal', application: 'per_night', isFinal: true })
    const next = applyIntent(locked, intent('long_stay'))
    expect(next.isFinal).toBe(false)
  })

  it('drops a fixed nightly price when moving to a whole-stay rule', () => {
    // The validator rejects fixed_price on a whole-stay rule.
    const fixed = payload({
      ruleType: 'seasonal',
      application: 'per_night',
      adjustmentType: 'fixed_price',
      adjustmentValue: '80.00',
    })
    const next = applyIntent(fixed, intent('long_stay'))
    expect(next.adjustmentType).toBe('pct_decrease')
  })

  it('keeps the name, scope and amount the user already chose', () => {
    const started = payload({
      name: 'Early bird',
      scope: 'property',
      propertyId: 'p1',
      adjustmentValue: '15.00',
    })
    const next = applyIntent(started, intent('last_minute'))
    expect(next.name).toBe('Early bird')
    expect(next.scope).toBe('property')
    expect(next.propertyId).toBe('p1')
    expect(next.adjustmentValue).toBe('15.00')
  })
})

describe('which intents a group can hold', () => {
  it('lists only the base price for the Base Prices group', () => {
    expect(intentsForGroup('Base Prices').map((i) => i.ruleType)).toEqual(['base_price'])
  })

  it('leaves the non-refundable discount out, since it is hidden', () => {
    expect(intentsForGroup('Booking Discounts').map((i) => i.ruleType)).not.toContain(
      'non_refundable',
    )
  })

  it('lists nothing for a group the user invented', () => {
    expect(intentsForGroup('My Own Group')).toEqual([])
  })
})

describe('defaultIntentForGroup', () => {
  it('skips the question where a group can only hold one kind of rule', () => {
    // Adding to Base Prices, asking "what do you want this rule to do?" has
    // exactly one answer, so the form should go straight to the fields.
    // Seasonal Pricing is no longer among these: it now offers both setting a
    // price for dates and excluding discounts for dates.
    expect(defaultIntentForGroup('Base Prices')?.ruleType).toBe('base_price')
    expect(defaultIntentForGroup('Length of Stay Discounts')?.ruleType).toBe('long_stay')
  })

  it('does not ask in Promotions, which now holds only promo codes', () => {
    expect(defaultIntentForGroup('Promotions')?.ruleType).toBe('promo')
  })

  it('no longer asks in Booking Discounts, which is down to one visible kind', () => {
    // The staff-applied discount is hidden until a screen can trigger one.
    expect(defaultIntentForGroup('Booking Discounts')?.ruleType).toBe('last_minute')
  })

  it('still asks in Seasonal Pricing, which holds three kinds', () => {
    expect(defaultIntentForGroup('Seasonal Pricing')).toBeNull()
  })

  it('still asks for a group it knows nothing about', () => {
    expect(defaultIntentForGroup('My Own Group')).toBeNull()
  })
})

describe('promo codes', () => {
  it('offers a percentage or an amount off, never a surcharge', () => {
    expect(amountUnitsFor('whole_stay', 'promo').map((u) => u.value)).toEqual([
      'pct_decrease',
      'fixed_decrease',
    ])
  })

  it('stays a whole-stay rule', () => {
    expect(intent('promo').application).toBe('whole_stay')
  })

  it('keeps a code typed before the intent was chosen', () => {
    const next = applyIntent(payload({ code: 'SUMMER20' }), intent('promo'))
    expect(next.code).toBe('SUMMER20')
  })

  it('drops caps the form no longer asks for', () => {
    const capped = payload({ ruleType: 'promo', usageLimit: 5, minSubtotalEur: '200.00' })
    const next = applyIntent(capped, intent('promo'))
    expect(next.usageLimit).toBeNull()
    expect(next.minSubtotalEur).toBeNull()
  })
})

describe('excluding discounts for a date range', () => {
  it('lives beside the other two seasonal options', () => {
    expect(intentsForGroup('Seasonal Pricing').map((i) => i.ruleType)).toEqual([
      'seasonal',
      'date_adjust',
      'block_discounts',
    ])
  })

  it('asks again which of the two you meant', () => {
    expect(defaultIntentForGroup('Seasonal Pricing')).toBeNull()
  })

  it('asks only for dates', () => {
    expect(intent('block_discounts').fields).toEqual(['dates'])
  })

  it('shows no amount, because it changes no price', () => {
    expect(intent('block_discounts').hidesAmount).toBe(true)
  })

  it('strips an amount carried over from another type', () => {
    const priced = payload({
      ruleType: 'seasonal',
      application: 'per_night',
      adjustmentType: 'fixed_price',
      adjustmentValue: '90.00',
    })
    const next = applyIntent(priced, intent('block_discounts'))
    expect(next.adjustmentType).toBe('')
    expect(next.adjustmentValue).toBeNull()
  })

  it('always locks the nights, since that is the whole mechanism', () => {
    const next = applyIntent(payload({ isFinal: false }), intent('block_discounts'))
    expect(next.isFinal).toBe(true)
  })
})

describe('seasonal pricing', () => {
  it('offers the lock in the open rather than under Advanced', () => {
    expect(intent('seasonal').showsLock).toBe(true)
  })

  it('keeps its amount control, unlike an exclusion', () => {
    expect(intent('seasonal').hidesAmount).toBeUndefined()
  })
})

describe('what the amount field is called', () => {
  it('names a base price as a nightly rate', () => {
    expect(intentFor('base_price').amountLabel).toBe('Price per night')
  })

  it('does not call a seasonal rate a base price', () => {
    // Seasonal and Base Prices are separate groups; labelling both
    // "Price per night" made the seasonal form read as the wrong one.
    expect(intentFor('seasonal').amountLabel).toBe('Price for these dates')
  })

  it('calls a long-stay or promo amount a discount', () => {
    expect(intentFor('long_stay').amountLabel).toBe('Discount')
    expect(intentFor('promo').amountLabel).toBe('Discount')
  })
})

describe('choosing what an exclusion excludes', () => {
  it('keeps a chosen target on an exclusion', () => {
    const targeted = payload({ ruleType: 'block_discounts', blocksGroupId: 'g-tiers' })
    const next = applyIntent(targeted, intent('block_discounts'))
    expect(next.blocksGroupId).toBe('g-tiers')
  })

  it('strips a target when the rule stops being an exclusion', () => {
    // The validator rejects a target on anything but an exclusion.
    const targeted = payload({ ruleType: 'block_discounts', blocksGroupId: 'g-tiers' })
    const next = applyIntent(targeted, intent('seasonal'))
    expect(next.blocksGroupId).toBeNull()
    expect(next.blocksRuleId).toBeNull()
  })
})

describe('what each group offers when adding', () => {
  it('offers Seasonal Pricing only its own three kinds', () => {
    // Not a long-stay tier, not a promo code: each has its own group.
    expect(intentsForGroup('Seasonal Pricing').map((i) => i.ruleType)).toEqual([
      'seasonal',
      'date_adjust',
      'block_discounts',
    ])
  })

  it('never offers a hidden intent anywhere', () => {
    const groups = [
      'Base Prices',
      'Seasonal Pricing',
      'Length of Stay Discounts',
      'Booking Discounts',
      'Promotions',
    ]
    for (const name of groups) {
      for (const offered of intentsForGroup(name)) {
        expect(offered.hidden).toBeFalsy()
      }
    }
  })

  it('offers Booking Discounts only the rule that can actually fire', () => {
    // A manual rule needs a caller to pass its id in manual_rule_ids, and no
    // screen does; offering it would build a discount that never applies.
    expect(intentsForGroup('Booking Discounts').map((i) => i.ruleType)).toEqual([
      'last_minute',
    ])
  })

  it('hides every intent no screen can trigger', () => {
    const hidden = RULE_INTENTS.filter((i) => i.hidden).map((i) => i.ruleType)
    expect(hidden).toEqual(['non_refundable', 'manual'])
  })
})

describe('increasing or decreasing for dates', () => {
  it('sits with seasonal pricing, which now offers three things', () => {
    expect(intentsForGroup('Seasonal Pricing').map((i) => i.ruleType)).toEqual([
      'seasonal',
      'date_adjust',
      'block_discounts',
    ])
  })

  it('moves the price rather than stating it', () => {
    expect(amountUnitsFor('per_night', 'date_adjust').map((u) => u.value)).toEqual([
      'pct_increase',
      'pct_decrease',
      'fixed_increase',
      'fixed_decrease',
    ])
  })

  it('never offers a fixed nightly price, which is the seasonal rate rule', () => {
    expect(amountUnitsFor('per_night', 'date_adjust').map((u) => u.value)).not.toContain(
      'fixed_price',
    )
  })

  it('is the only intent that offers stacking', () => {
    const stacking = RULE_INTENTS.filter((i) => i.showsStacking).map((i) => i.ruleType)
    expect(stacking).toEqual(['date_adjust'])
  })

  it('keeps the stack choice when staying on this intent', () => {
    const next = applyIntent(
      payload({ ruleType: 'date_adjust', stacks: true }),
      intent('date_adjust'),
    )
    expect(next.stacks).toBe(true)
  })

  it('clears the stack choice on a type that cannot stack', () => {
    // The validator rejects `stacks` on anything else.
    const next = applyIntent(payload({ ruleType: 'date_adjust', stacks: true }), intent('seasonal'))
    expect(next.stacks).toBe(false)
  })
})
