// Plain-English rendering of a pricing rule.
//
// One home for every human-readable string about a rule, so the sentence you
// read while building a rule in the form is character-for-character the
// sentence you read afterwards in the rule list. Two generators would drift.

import type { PricingRuleRecord, PropertyListing } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { stackedRanges, type StackableLike } from './stackedRanges'

export type ScopedEntity = {
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
}

/** The subset of a rule that affects how it reads. Satisfied by both
 *  PricingRuleRecord (saved) and PricingRulePayload (being edited). */
export type RuleLike = ScopedEntity & Pick<
  PricingRuleRecord,
  | 'ruleType'
  | 'application'
  | 'adjustmentType'
  | 'adjustmentValue'
  | 'minNights'
  | 'daysBeforeCheckin'
  | 'startDate'
  | 'endDate'
  | 'code'
  | 'stacks'
> & { id?: string; name?: string; enabled?: boolean }

type NamedProperty = Pick<PropertyListing, 'id' | 'name'>

/** '10.00' -> '10', '12.50' -> '12.5'. Mirrors the backend's `_tidy`. */
function tidy(value: string): string {
  if (!value.includes('.')) return value
  return value.replace(/0+$/, '').replace(/\.$/, '')
}

/** The verb phrase describing what a rule does to a price, agreeing with a
 *  plural subject ('Stays ... get') or a singular one ('Every stay ... gets'). */
export function amountPhrase(
  adjustmentType: RuleLike['adjustmentType'],
  adjustmentValue: string | null,
  plural = true,
): string {
  if (!adjustmentType || adjustmentValue === null || adjustmentValue === '') {
    return plural ? 'have no amount set yet' : 'has no amount set yet'
  }
  const amount = tidy(adjustmentValue)
  switch (adjustmentType) {
    case 'pct_decrease':
      return `${plural ? 'get' : 'gets'} ${amount}% off`
    case 'pct_increase':
      return `${plural ? 'cost' : 'costs'} ${amount}% more`
    case 'fixed_decrease':
      return `${plural ? 'get' : 'gets'} \u20ac${amount} off`
    case 'fixed_increase':
      return `${plural ? 'cost' : 'costs'} \u20ac${amount} more`
    case 'fixed_price':
      return `${plural ? 'are' : 'is'} priced at \u20ac${amount} per night`
  }
}

/** The stays or nights a rule covers, plus whether that subject is plural. */
function condition(rule: RuleLike): { text: string; plural: boolean } {
  const from = rule.startDate ? formatDisplayDate(rule.startDate) : null
  const to = rule.endDate ? formatDisplayDate(rule.endDate) : null

  switch (rule.ruleType) {
    // ruleSentence returns before reaching here for a base price, which reads
    // as one phrase rather than subject-plus-effect. Listed anyway so this
    // switch stays exhaustive and a new rule type is a compile error.
    case 'base_price':
      return { text: 'Every night', plural: false }

    case 'date_adjust':
      if (from && to) return { text: `Nights from ${from} to ${to}`, plural: true }
      if (from) return { text: `Nights from ${from} onwards`, plural: true }
      if (to) return { text: `Nights up to ${to}`, plural: true }
      return { text: 'Every night', plural: false }

    case 'block_discounts':
      if (from && to) return { text: `Nights from ${from} to ${to}`, plural: true }
      if (from) return { text: `Nights from ${from} onwards`, plural: true }
      if (to) return { text: `Nights up to ${to}`, plural: true }
      return { text: 'All nights', plural: true }

    case 'long_stay':
      return rule.minNights
        ? { text: `Stays of ${rule.minNights}+ nights`, plural: true }
        : { text: 'Every stay', plural: false }

    case 'seasonal': {
      const noun = rule.application === 'per_night' ? 'Nights' : 'Stays'
      if (from && to) return { text: `${noun} from ${from} to ${to}`, plural: true }
      if (from) return { text: `${noun} from ${from} onwards`, plural: true }
      if (to) return { text: `${noun} up to ${to}`, plural: true }
      return rule.application === 'per_night'
        ? { text: 'Every night', plural: false }
        : { text: 'Every stay', plural: false }
    }

    case 'last_minute':
      return rule.daysBeforeCheckin === null
        ? { text: 'Last-minute stays (no booking window set)', plural: true }
        : {
            text: `Stays booked ${rule.daysBeforeCheckin} days or fewer before check-in`,
            plural: true,
          }

    case 'non_refundable':
      return { text: 'Non-refundable bookings', plural: true }

    case 'promo':
      return rule.code
        ? { text: `Stays booked with code ${rule.code}`, plural: true }
        : { text: 'Stays booked with a promo code (no code set)', plural: true }

    case 'manual':
      return { text: 'Stays staff apply this to', plural: true }
  }
}

/** Where a rule applies, as a phrase that follows 'at'. */
function scopePhrase(entity: ScopedEntity, properties: NamedProperty[]): string {
  if (entity.scope === 'property') {
    return properties.find((p) => p.id === entity.propertyId)?.name ?? 'the selected property'
  }
  if (entity.scope === 'bedroom_group') return `${entity.bedroomGroup}-bedroom apartments`
  return 'every property'
}

/** The short scope pill shown beside a rule row. */
export function scopeLabel(entity: ScopedEntity, properties: NamedProperty[]): string {
  if (entity.scope === 'property') {
    return properties.find((p) => p.id === entity.propertyId)?.name ?? 'Unknown property'
  }
  if (entity.scope === 'bedroom_group') return `${entity.bedroomGroup}-bedroom`
  return 'All'
}

/** The clause saying what a stacking adjustment comes to alongside the rest.
 *
 *  Deliberately a summary, not the sub-range breakdown. Listing every segment
 *  gave the LONGEST description to the widest rule — the one everything else
 *  overlaps — which reads backwards: that rule is the baseline others add to,
 *  not the complicated one. The per-segment detail lives in the edit form,
 *  where it is being worked on. Empty when nothing overlaps.
 */
function stackingClause(rule: RuleLike, others: StackableLike[]): string {
  const ranges = stackedRanges(rule, others)
  if (!ranges.some((range) => range.partners.length > 0)) return ''

  const names = [...new Set(ranges.flatMap((range) => range.partners))]
  const totals = ranges.map((range) => range.pct)
  const lowest = Math.min(...totals)
  const highest = Math.max(...totals)
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value}%`
  const total =
    lowest === highest
      ? `total ${signed(highest)}`
      : `total between ${signed(lowest)} and ${signed(highest)}`
  return ` Stacked with ${names.join(', ')}: these dates ${total}.`
}

/** One sentence saying what this rule does, in the words a manager would use.
 *
 *  `others` are the rest of the rules on this platform, needed only so a
 *  stacking adjustment can say what it adds up to alongside them.
 */
export function ruleSentence(
  rule: RuleLike,
  properties: NamedProperty[],
  others: StackableLike[] = [],
): string {
  if (rule.ruleType === 'block_discounts') {
    const subject = condition(rule)
    return `${subject.text} keep their price — no whole-stay discount applies, at ${scopePhrase(rule, properties)}.`
  }

  if (rule.ruleType === 'base_price') {
    // Handled apart from the generic path: amountPhrase would render this as
    // 'is priced at €35 per night', which reads as a stutter after the
    // 'Every night' subject a base price always takes.
    const effect = rule.adjustmentValue
      ? `costs €${tidy(rule.adjustmentValue)}`
      : 'has no amount set yet'
    return `Every night ${effect}, at ${scopePhrase(rule, properties)}.`
  }

  const subject = condition(rule)
  const effect = amountPhrase(rule.adjustmentType, rule.adjustmentValue, subject.plural)
  const base = `${subject.text} ${effect}, at ${scopePhrase(rule, properties)}.`
  return rule.ruleType === 'date_adjust' ? base + stackingClause(rule, others) : base
}

/** One sentence describing a booking limit, of either kind. */
export function constraintSentence(
  constraint: ScopedEntity & {
    kind?: 'min_nights' | 'max_advance'
    value: number | null
    startDate: string | null
    endDate: string | null
  },
  properties: NamedProperty[],
): string {
  const from = constraint.startDate ? formatDisplayDate(constraint.startDate) : null
  const to = constraint.endDate ? formatDisplayDate(constraint.endDate) : null

  if (constraint.kind === 'max_advance') {
    // The cutoff lives in endDate; there is no window to describe.
    return to
      ? `Guests can book up to ${to}, at ${scopePhrase(constraint, properties)}. Nothing after that date can be reserved.`
      : `No latest bookable date set yet, at ${scopePhrase(constraint, properties)}.`
  }

  const when = from && to ? ` between ${from} and ${to}` : from ? ` from ${from} onwards` : to ? ` up to ${to}` : ''
  if (!constraint.value) {
    return `No minimum set yet${when}, at ${scopePhrase(constraint, properties)}.`
  }
  const nights = constraint.value === 1 ? '1 night' : `${constraint.value} nights`
  return `Guests must book at least ${nights}${when}, at ${scopePhrase(constraint, properties)}.`
}
