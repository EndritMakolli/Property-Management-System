import { describe, expect, it } from 'vitest'
import { formatBaths } from './formatBaths'

// Bathrooms became a decimal so "1.5" (one full bathroom, one without a shower)
// can be expressed. The number now arrives as 1 or 1.5 or 2, and none of those
// should ever reach a guest as "1.0 bath".
describe('formatBaths', () => {
  it('says one bath in the singular', () => {
    expect(formatBaths(1)).toBe('1 bath')
  })

  it('drops the decimal from a whole number', () => {
    expect(formatBaths(2)).toBe('2 baths')
  })

  it('keeps the half', () => {
    expect(formatBaths(1.5)).toBe('1.5 baths')
  })

  it('treats a half as plural, because it is more than one', () => {
    expect(formatBaths(1.5)).toContain('baths')
  })

  it('handles a half below one', () => {
    expect(formatBaths(0.5)).toBe('0.5 baths')
  })

  it('survives the string the API used to send', () => {
    // Defensive: a cached response or an older serializer could still send "1.5".
    expect(formatBaths('1.5' as unknown as number)).toBe('1.5 baths')
  })

  it('falls back to one when the value is missing', () => {
    expect(formatBaths(undefined)).toBe('1 bath')
  })

  it('can be asked for just the number', () => {
    expect(formatBaths(1.5, { withUnit: false })).toBe('1.5')
    expect(formatBaths(2, { withUnit: false })).toBe('2')
  })
})
