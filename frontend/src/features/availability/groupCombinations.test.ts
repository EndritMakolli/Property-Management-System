import { describe, expect, it } from 'vitest'
import { findCombinations, type GroupCandidate } from './groupCombinations'

const apt = (id: string, maxGuests: number, bedrooms = 1): GroupCandidate => ({
  id,
  name: `Apartment #${id}`,
  maxGuests,
  bedrooms,
})

/** Just the ids, so an expectation reads as the answer and not as a fixture. */
const ids = (combos: { apartments: GroupCandidate[] }[]) =>
  combos.map((c) => c.apartments.map((a) => a.id))

describe('findCombinations', () => {
  it('says nothing when one apartment already sleeps the group', () => {
    // A single apartment that fits is not a combination — the page lists those
    // on their own, and repeating them as a "combination of one" is noise.
    expect(findCombinations([apt('a', 10), apt('b', 4)], 8)).toEqual([])
  })

  it('pairs two apartments for a group neither can take alone', () => {
    expect(ids(findCombinations([apt('a', 4), apt('b', 6)], 9))).toEqual([['a', 'b']])
  })

  it('reaches for a third apartment when two are not enough', () => {
    const found = ids(findCombinations([apt('a', 4), apt('b', 4), apt('c', 4)], 11))
    expect(found).toEqual([['a', 'b', 'c']])
  })

  it('prefers the combination that uses fewest apartments', () => {
    // b+c sleeps 12 in two; a+d+e also sleeps 12 but needs three keys, three
    // cleans and three check-ins.
    const found = findCombinations(
      [apt('a', 4), apt('b', 6), apt('c', 6), apt('d', 4), apt('e', 4)],
      12,
    )
    expect(found[0].apartments.length).toBe(2)
  })

  it('prefers the tightest fit among combinations of the same size', () => {
    // Both are pairs; a+b wastes nothing, a+c wastes six beds.
    const found = findCombinations([apt('a', 4), apt('b', 4), apt('c', 10)], 8)
    expect(found[0].apartments.map((a) => a.id)).toEqual(['a', 'b'])
    expect(found[0].spareBeds).toBe(0)
  })

  it('reports capacity and spare beds for each combination', () => {
    const [first] = findCombinations([apt('a', 4), apt('b', 6)], 9)
    expect(first.capacity).toBe(10)
    expect(first.spareBeds).toBe(1)
    expect(first.bedrooms).toBe(2)
  })

  it('never returns a combination carrying an apartment it does not need', () => {
    // Every apartment in a suggestion must be load-bearing: take any one away
    // and the group no longer fits. Otherwise the third key is for nothing.
    const found = findCombinations([apt('a', 6), apt('b', 4), apt('c', 2), apt('d', 3)], 9)
    expect(found.length).toBeGreaterThan(0)
    for (const combo of found) {
      for (const dropped of combo.apartments) {
        const without = combo.capacity - dropped.maxGuests
        expect(without).toBeLessThan(9)
      }
    }
  })

  it('ignores an apartment that sleeps the whole group by itself', () => {
    // #a fits the eight on its own, so it belongs in the singles list, not
    // welded to a second apartment nobody needs. #b and #c still combine.
    const found = ids(findCombinations([apt('a', 10), apt('b', 4), apt('c', 4)], 8))
    expect(found).toEqual([['b', 'c']])
  })

  it('returns nothing when the whole building cannot sleep the group', () => {
    expect(findCombinations([apt('a', 2), apt('b', 2)], 20)).toEqual([])
  })

  it('returns nothing for a group of one', () => {
    expect(findCombinations([apt('a', 2), apt('b', 2)], 1)).toEqual([])
  })

  it('handles an empty building', () => {
    expect(findCombinations([], 6)).toEqual([])
  })

  it('caps how many suggestions come back', () => {
    const many = Array.from({ length: 12 }, (_, i) => apt(String(i), 4))
    expect(findCombinations(many, 7, { limit: 3 }).length).toBe(3)
  })

  it('honours a ceiling on how many apartments a group will be split across', () => {
    const found = findCombinations([apt('a', 2), apt('b', 2), apt('c', 2)], 6, {
      maxApartments: 2,
    })
    expect(found).toEqual([])
  })

  it('does not repeat the same set of apartments in a different order', () => {
    const found = ids(findCombinations([apt('a', 4), apt('b', 4), apt('c', 4)], 7))
    const seen = found.map((combo) => [...combo].sort().join('+'))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('stays quick on a building far larger than this one', () => {
    const many = Array.from({ length: 60 }, (_, i) => apt(String(i), 2 + (i % 5)))
    const started = Date.now()
    findCombinations(many, 25)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
