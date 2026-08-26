import { describe, expect, it } from 'vitest'
import { CLIENT_SORT_OPTIONS, isClientSortKey, nextDirection } from './clientSort'

// The sort runs on the server so it can order the whole directory, not just
// the twenty rows on screen. What lives here is the contract the two sides
// share: the key list the picker offers, and what the API is sent.

describe('the sort options', () => {
  it('offers a key for every column worth ordering by', () => {
    expect(CLIENT_SORT_OPTIONS.map((o) => o.value)).toEqual([
      'name',
      'stays',
      'nights',
      'paid',
      'added',
    ])
  })

  it('gives every option a human label', () => {
    expect(CLIENT_SORT_OPTIONS.every((o) => o.label.length > 0)).toBe(true)
  })
})

describe('isClientSortKey', () => {
  it('accepts a key the server knows', () => {
    expect(isClientSortKey('nights')).toBe(true)
  })

  it('rejects anything else, so a stale localStorage value cannot poison the query', () => {
    expect(isClientSortKey('; DROP TABLE')).toBe(false)
    expect(isClientSortKey('')).toBe(false)
    expect(isClientSortKey('-nights')).toBe(false)
  })
})

describe('nextDirection', () => {
  it('sends a plain key ascending', () => {
    expect(nextDirection('name', 'asc')).toBe('name')
  })

  it('prefixes a minus for descending, which is what the API expects', () => {
    expect(nextDirection('name', 'desc')).toBe('-name')
  })

  it('round-trips every option in both directions', () => {
    for (const option of CLIENT_SORT_OPTIONS) {
      expect(nextDirection(option.value, 'asc')).toBe(option.value)
      expect(nextDirection(option.value, 'desc')).toBe(`-${option.value}`)
    }
  })
})
