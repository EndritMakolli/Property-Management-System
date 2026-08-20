// What the user is trying to do, mapped onto the engine's rule model.
//
// The rule form used to show all fifteen fields for every rule type. Most were
// inert: the save-time validator in _pricing_validation.py rejects a code on a
// non-promo rule, a minimum spend on a per-night rule, a fixed nightly price
// or a final-price lock on a whole-stay rule. Offering those fields only to
// invalidate them on save is what made the form hard to use, so each intent
// declares the fields its type can actually own, and `applyIntent` clears the
// rest when the user switches.

import type { PricingRulePayload } from '../../api/bookingEngine'

export type RuleField = 'dates' | 'minNights' | 'daysBeforeCheckin' | 'code' | 'usageLimit' | 'minSubtotal'

export type RuleIntent = {
  ruleType: PricingRulePayload['ruleType']
  title: string
  blurb: string
  /** What this rule adjusts. Pre-selected, still editable under Advanced. */
  application: PricingRulePayload['application']
  /** The seeded group this kind of rule belongs in, matched by name. */
  groupName: string
  /** Fields beyond name, amount and scope, which every intent shows. */
  fields: RuleField[]
  /** Pins the amount unit when this kind of rule admits only one. */
  forceAdjustmentType?: Exclude<PricingRulePayload['adjustmentType'], ''>
  /** Strips the form to its own fields — no name, no type header, no
   *  Advanced section. For rules where the group already says what they are
   *  and every other setting is decided by the type. */
  minimal?: boolean
  /** Short noun for the rule list, used when a rule carries no name of its
   *  own. `title` is a prompt ("Discount longer stays") and reads wrong as a
   *  heading. */
  rowLabel: string
  /** Hides the amount control for a rule that changes no price. */
  hidesAmount?: boolean
  /** Kept out of the pickers, but still used to render rules of this type
   *  that already exist — intentFor must answer for every type or the list
   *  cannot draw them. */
  hidden?: boolean
  /** What the amount field is called. Defaults to 'Amount'; a rate-setting
   *  rule wants its own words, and "Price per night" on a seasonal rule
   *  reads as though it were setting the base price. */
  amountLabel?: string
  /** Offers the final-price lock as a plain checkbox in the main form
   *  instead of burying it under Advanced. */
  showsLock?: boolean
  /** Offers the additive-stacking checkbox, and the combined-percentage
   *  readout that goes with it. */
  showsStacking?: boolean
}

export const RULE_INTENTS: RuleIntent[] = [
  {
    ruleType: 'base_price',
    title: 'Set the base nightly price',
    amountLabel: 'Price per night',
    rowLabel: 'Base price',
    blurb: 'What a night costs before anything adjusts it. Applies on every date.',
    application: 'per_night',
    groupName: 'Base Prices',
    fields: [],
    // A rate is an amount, never a percentage, and never dated — a rate that
    // holds only between two dates is a seasonal rule. The backend validator
    // rejects both, so the form must not let them be built.
    forceAdjustmentType: 'fixed_price',
    // Nothing else to ask: the group, the timing and the unit are all fixed
    // by the type, which leaves "which apartments" and "how much".
    minimal: true,
  },
  {
    ruleType: 'seasonal',
    title: 'Set a fixed price for specific dates',
    amountLabel: 'Price for these dates',
    rowLabel: 'Seasonal rate',
    blurb: 'High season, holidays, event weekends. Sets what each night in the window costs.',
    // A fixed nightly price, not a percentage: the point is to state the rate
    // these dates sell at.
    forceAdjustmentType: 'fixed_price',
    application: 'per_night',
    groupName: 'Seasonal Pricing',
    fields: ['dates'],
    // The lock belongs in the open here: pricing peak dates and then having a
    // long-stay tier discount them back down is the mistake this prevents.
    showsLock: true,
    minimal: true,
  },
  {
    ruleType: 'date_adjust',
    title: 'Increase or decrease the price for dates',
    amountLabel: 'Change the price by',
    rowLabel: 'Date adjustment',
    blurb: 'Loads the rate up or down over a date range, on top of whatever it already is.',
    application: 'per_night',
    groupName: 'Seasonal Pricing',
    fields: ['dates'],
    showsStacking: true,
    minimal: true,
  },
  {
    ruleType: 'block_discounts',
    title: 'Exclude discounts for specific dates',
    rowLabel: 'Discounts excluded',
    blurb: 'Keeps the ordinary rate on these dates but stops any whole-stay discount reaching them.',
    application: 'per_night',
    groupName: 'Seasonal Pricing',
    fields: ['dates'],
    // It changes no price, so there is no amount to ask for.
    hidesAmount: true,
    minimal: true,
  },
  {
    ruleType: 'long_stay',
    title: 'Discount longer stays',
    amountLabel: 'Discount',
    rowLabel: 'Length of stay discount',
    blurb: 'A weekly or monthly rate. Takes a percentage off the whole stay.',
    application: 'whole_stay',
    groupName: 'Length of Stay Discounts',
    fields: ['minNights'],
    // A tier ladder is expressed in percentages: that is what makes "the
    // biggest discount wins" comparable across tiers of different lengths.
    forceAdjustmentType: 'pct_decrease',
    // Leaves a night threshold, who it applies to, and the percentage.
    minimal: true,
  },
  {
    ruleType: 'last_minute',
    title: 'Reward booking last-minute',
    rowLabel: 'Last-minute discount',
    blurb: 'Fill gaps close to check-in by discounting stays booked inside a window.',
    application: 'whole_stay',
    groupName: 'Booking Discounts',
    fields: ['daysBeforeCheckin'],
  },
  {
    ruleType: 'non_refundable',
    title: 'Discount non-refundable bookings',
    rowLabel: 'Non-refundable discount',
    blurb: 'Applies only when the guest gives up the right to cancel.',
    application: 'whole_stay',
    groupName: 'Booking Discounts',
    fields: [],
    // Not offered. The engine still honours any that exist — Fleet carries a
    // seeded one — so the entry stays for rendering them.
    hidden: true,
  },
  {
    ruleType: 'promo',
    title: 'Issue a promo code',
    amountLabel: 'Discount',
    rowLabel: 'Promo code',
    blurb: 'A code guests type at checkout, taking a percentage or an amount off.',
    application: 'whole_stay',
    groupName: 'Promotions',
    fields: ['code'],
    // Just a code and an amount. The engine still honours usage caps,
    // minimum spend, minimum nights and validity dates on a promo rule —
    // this form simply does not ask for them.
    minimal: true,
  },
  {
    ruleType: 'manual',
    title: 'Discount staff apply by hand',
    rowLabel: 'Staff discount',
    blurb: 'Never fires on its own. Staff pick it when building a booking.',
    application: 'whole_stay',
    groupName: 'Booking Discounts',
    fields: [],
    // Not offered: a manual rule only applies when a caller passes its id in
    // manual_rule_ids, and no screen does that yet. Offering it would let an
    // operator build a discount that can never fire. Unhide when the booking
    // screens can select one.
    hidden: true,
  },
]

export function intentFor(ruleType: PricingRulePayload['ruleType']): RuleIntent {
  const found = RULE_INTENTS.find((i) => i.ruleType === ruleType)
  if (!found) throw new Error(`No intent defined for rule type "${ruleType}"`)
  return found
}

/** The intents that belong in a given group, by the group's name. */
export function intentsForGroup(groupName: string): RuleIntent[] {
  return RULE_INTENTS.filter((intent) => intent.groupName === groupName && !intent.hidden)
}

/** The intent to assume when adding to this group, or null to ask.
 *
 *  Asking "what do you want this rule to do?" is only worth a screen when
 *  there is more than one answer. In Base Prices, Seasonal Pricing or the
 *  tier ladder there is exactly one, so the form opens straight onto the
 *  fields — the type is still changeable from inside the form afterwards. */
export function defaultIntentForGroup(groupName: string): RuleIntent | null {
  const candidates = intentsForGroup(groupName)
  return candidates.length === 1 ? candidates[0] : null
}

export type AmountUnit = {
  value: Exclude<PricingRulePayload['adjustmentType'], ''>
  label: string
}

/** The amount units a rule may use. A fixed nightly price is meaningless on a
 *  whole-stay rule and the validator rejects it, so it is not offered there;
 *  a base price, conversely, may be nothing else. */
export function amountUnitsFor(
  application: PricingRulePayload['application'],
  ruleType?: PricingRulePayload['ruleType'],
): AmountUnit[] {
  if (ruleType === 'base_price') {
    return [{ value: 'fixed_price', label: '€ per night' }]
  }
  if (ruleType === 'long_stay') {
    return [{ value: 'pct_decrease', label: '% off' }]
  }
  if (ruleType === 'seasonal') {
    return [{ value: 'fixed_price', label: '€ per night' }]
  }
  if (ruleType === 'date_adjust') {
    // Moves the price; never states it. A fixed nightly price is what the
    // seasonal rate rule is for, and the validator rejects one here.
    return [
      { value: 'pct_increase', label: '% more' },
      { value: 'pct_decrease', label: '% off' },
      { value: 'fixed_increase', label: '€ more' },
      { value: 'fixed_decrease', label: '€ off' },
    ]
  }
  if (ruleType === 'promo') {
    return [
      { value: 'pct_decrease', label: '% off' },
      { value: 'fixed_decrease', label: '€ off' },
    ]
  }
  const units: AmountUnit[] = [
    { value: 'pct_decrease', label: '% off' },
    { value: 'pct_increase', label: '% more' },
    { value: 'fixed_decrease', label: '\u20ac off' },
    { value: 'fixed_increase', label: '\u20ac more' },
  ]
  if (application === 'per_night') {
    units.push({ value: 'fixed_price', label: '\u20ac per night' })
  }
  return units
}

/** Switch a rule to a new intent, clearing whatever the new type cannot own.
 *  Without the clearing, a leftover promo code or final-price lock would fail
 *  validation on save with an error about a field the form no longer shows. */
export function applyIntent(rule: PricingRulePayload, intent: RuleIntent): PricingRulePayload {
  const shows = (field: RuleField) => intent.fields.includes(field)
  const perNight = intent.application === 'per_night'

  return {
    ...rule,
    ruleType: intent.ruleType,
    application: intent.application,
    minNights: shows('minNights') ? rule.minNights : null,
    daysBeforeCheckin: shows('daysBeforeCheckin') ? rule.daysBeforeCheckin : null,
    startDate: shows('dates') ? rule.startDate : null,
    endDate: shows('dates') ? rule.endDate : null,
    code: shows('code') ? rule.code : null,
    usageLimit: shows('usageLimit') ? rule.usageLimit : null,
    minSubtotalEur: shows('minSubtotal') ? rule.minSubtotalEur : null,
    // is_final is per-night-only and the validator rejects it on a whole-stay
    // rule. An exclusion works BY locking, so there it is not optional.
    isFinal: intent.hidesAmount ? true : perNight ? rule.isFinal : false,
    adjustmentType: intent.hidesAmount
      ? ''
      : intent.forceAdjustmentType ??
        (!perNight && rule.adjustmentType === 'fixed_price' ? 'pct_decrease' : rule.adjustmentType),
    adjustmentValue: intent.hidesAmount ? null : rule.adjustmentValue,
    // Only an exclusion may name what it excludes; anywhere else the
    // validator rejects a target outright.
    blocksGroupId: intent.hidesAmount ? rule.blocksGroupId : null,
    blocksRuleId: intent.hidesAmount ? rule.blocksRuleId : null,
    // Only a date adjustment may stack; the validator rejects it elsewhere.
    stacks: intent.showsStacking ? rule.stacks : false,
  }
}

/** A blank rule, before the user has picked what it should do. */
export function emptyRulePayload(groupId: string, sortOrder: number): PricingRulePayload {
  return {
    name: '',
    groupId,
    ruleType: 'manual',
    scope: 'all',
    propertyId: null,
    bedroomGroup: null,
    enabled: true,
    sortOrder,
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
  }
}
