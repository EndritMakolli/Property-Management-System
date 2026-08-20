// The tested stay's price, written out as the sum it actually is.
//
// The bar used to report a total and its distance from a notional base, which
// said what changed but never how. This turns the same quote into the working:
//
//   7 nights × €35 = €245  − €36.75 (7+ nights − 15%)  = €208.25 total
//
// The arithmetic is the engine's own, not a re-derivation: `subtotal` is the
// sum of the nightly rates after pass 1, and each whole-stay report carries
// the money that rule actually moved in pass 2, so subtotal minus those
// amounts is exactly the total.

import type { PricingQuote, RuleReport } from '../../types/domain'

export type CalculationStep = {
  /** The rule's name, as shown in the list below. */
  label: string
  /** Signed money, e.g. '− €36.75'. */
  delta: string
}

export type QuoteCalculation = {
  /** '7 nights × €35', or just '7 nights' when they are not all the same. */
  opening: string
  subtotal: string
  steps: CalculationStep[]
  total: string
  average: string
}

/** '35.00' -> '€35', '35.50' -> '€35.50'. Trailing zeros are noise in a sum. */
function money(value: string | number): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return `€${value}`
  const rounded = Math.round(Math.abs(amount) * 100) / 100
  // Cents are all-or-nothing: €35, or €35.50 — never €35.5.
  const hasCents = Math.round(rounded * 100) % 100 !== 0
  const text = rounded.toLocaleString('en', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
  return `€${text}`
}

/** Whole-stay rules that actually moved money, in the order they applied. */
function adjustments(rules: RuleReport[]): RuleReport[] {
  return rules.filter(
    (rule) =>
      rule.status === 'applied' &&
      rule.application === 'whole_stay' &&
      Number(rule.amount) !== 0,
  )
}

export function buildCalculation(quote: PricingQuote): QuoteCalculation {
  const rates = quote.nightlyBreakdown.map((night) => night.rate)
  const uniform = rates.length > 0 && rates.every((rate) => rate === rates[0])
  const nightWord = quote.nights === 1 ? 'night' : 'nights'

  return {
    // Only multiply when there is a single rate to multiply by: a seasonal
    // rule covering part of the stay makes "7 × €35" a false statement.
    opening: uniform
      ? `${quote.nights} ${nightWord} × ${money(rates[0])}`
      : `${quote.nights} ${nightWord}`,
    subtotal: money(quote.subtotal),
    steps: adjustments(quote.rules).map((rule) => ({
      label: rule.name,
      // Pass 2 reports money TAKEN off, so a positive amount is a discount
      // and a negative one is a surcharge.
      delta: `${Number(rule.amount) > 0 ? '−' : '+'} ${money(rule.amount)}`,
    })),
    total: money(quote.total),
    average: money(quote.averageNightlyRate),
  }
}
