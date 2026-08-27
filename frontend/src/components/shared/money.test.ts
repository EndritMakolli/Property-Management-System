import { describe, expect, it } from 'vitest'
import { looksLikeMoney } from './money'

// Metric tiles carry both kinds of figure — "EUR 26,544" and "94%" — so the
// tile decides for itself whether it holds money. Everything else applies the
// class explicitly. This predicate is the one place that decides, so it is the
// one place worth testing.

describe('looksLikeMoney', () => {
  it('recognises the EUR prefix the PMS uses', () => {
    expect(looksLikeMoney('EUR 26,544')).toBe(true)
  })

  it('recognises a euro sign', () => {
    expect(looksLikeMoney('€1,234.50')).toBe(true)
  })

  it('recognises a trailing currency', () => {
    expect(looksLikeMoney('245 EUR')).toBe(true)
  })

  it('ignores case', () => {
    expect(looksLikeMoney('eur 40')).toBe(true)
  })

  it('leaves a percentage alone', () => {
    expect(looksLikeMoney('94%')).toBe(false)
  })

  it('leaves a plain count alone', () => {
    expect(looksLikeMoney('29')).toBe(false)
    expect(looksLikeMoney('1,092')).toBe(false)
  })

  it('leaves a date alone', () => {
    expect(looksLikeMoney('26-Aug-2026')).toBe(false)
  })

  it('does not fire on a word that merely contains the letters', () => {
    // "Europe" and "neuro" both contain "eur"; a word boundary is required.
    expect(looksLikeMoney('Europe')).toBe(false)
    expect(looksLikeMoney('Neuro clinic')).toBe(false)
  })

  it('handles an empty or missing value', () => {
    expect(looksLikeMoney('')).toBe(false)
    expect(looksLikeMoney(undefined)).toBe(false)
  })
})
