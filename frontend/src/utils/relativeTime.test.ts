import { describe, expect, it } from 'vitest'
import { formatAdded } from './relativeTime'

const NOW = new Date('2026-08-26T12:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatAdded', () => {
  it('says just now for something seconds old', () => {
    expect(formatAdded(ago(20_000), NOW)).toBe('Added just now')
  })

  it('counts minutes', () => {
    expect(formatAdded(ago(5 * MINUTE), NOW)).toBe('Added 5 min ago')
  })

  it('counts hours', () => {
    expect(formatAdded(ago(3 * HOUR), NOW)).toBe('Added 3 hours ago')
  })

  it('says one hour in the singular', () => {
    expect(formatAdded(ago(HOUR), NOW)).toBe('Added 1 hour ago')
  })

  it('counts days', () => {
    expect(formatAdded(ago(3 * DAY), NOW)).toBe('Added 3 days ago')
  })

  it('says one day in the singular', () => {
    expect(formatAdded(ago(DAY), NOW)).toBe('Added 1 day ago')
  })

  it('falls back to a date once it is over a month old', () => {
    expect(formatAdded('2024-06-12T09:00:00Z', NOW)).toBe('Added 12-Jun-2024')
  })

  it('does not say "in 2 minutes" when the clock is skewed forward', () => {
    expect(formatAdded(new Date(NOW + 2 * MINUTE).toISOString(), NOW)).toBe('Added just now')
  })

  it('handles a missing timestamp', () => {
    expect(formatAdded(undefined, NOW)).toBe('Added date unknown')
    expect(formatAdded('', NOW)).toBe('Added date unknown')
  })

  it('handles a timestamp that is not a date', () => {
    expect(formatAdded('not a date', NOW)).toBe('Added date unknown')
  })

  it('never renders NaN', () => {
    expect(formatAdded('garbage', NOW)).not.toMatch(/NaN/)
  })
})
