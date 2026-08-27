// Does this rendered value hold money?
//
// Metric tiles carry both kinds of figure - "EUR 26,544" next to "94%" - so a
// tile has to decide for itself whether the privacy switch should hide it.
// Everywhere else the `money` class is applied deliberately; this is only for
// the one component that cannot know in advance what it was handed.
//
// The word boundary matters: "Europe" contains "eur".
const CURRENCY = /€|\beur\b/i

export function looksLikeMoney(value?: string): boolean {
  return typeof value === 'string' && CURRENCY.test(value)
}
