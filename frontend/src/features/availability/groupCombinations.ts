// Which apartments, together, sleep a group that none of them sleeps alone.
//
// A party of fourteen is not fourteen searches. Staff were reading the
// availability grid and adding up beds by hand, which is slow and gets the
// arithmetic wrong in exactly the way that oversells an apartment. The guest
// site had half of this already - but only ever pairs, so a group needing
// three flats got an empty page - and the PMS had none of it.
//
// Pure, and given only the apartments the caller has already established are
// free for the whole stay. It decides nothing about availability, and so
// cannot disagree with the page about what is free.

export type GroupCandidate = {
  id: string
  name: string
  maxGuests: number
  bedrooms: number
}

export type Combination = {
  apartments: GroupCandidate[]
  /** Beds the combination sleeps in total. */
  capacity: number
  /** Capacity beyond the group — what is being paid for and not slept in. */
  spareBeds: number
  bedrooms: number
}

export type Options = {
  /** How many apartments a group will be split across at most. Beyond three
   *  it stops being one booking and starts being three, so that is the
   *  default ceiling. */
  maxApartments?: number
  /** How many suggestions to return. */
  limit?: number
}

const DEFAULT_MAX_APARTMENTS = 3
const DEFAULT_LIMIT = 8

/**
 * Combinations of two or more apartments that sleep `guests`, best first.
 *
 * "Best" is fewest apartments, then least spare capacity: splitting a group
 * costs a key, a clean and a check-in each time, and unused beds are unsold.
 *
 * A single apartment that already fits is never returned. The page lists those
 * on their own, and a "combination" of one would be the same row twice.
 */
export function findCombinations(
  candidates: GroupCandidate[],
  guests: number,
  { maxApartments = DEFAULT_MAX_APARTMENTS, limit = DEFAULT_LIMIT }: Options = {},
): Combination[] {
  if (guests < 2 || candidates.length < 2 || maxApartments < 2) return []

  // An apartment that sleeps the whole group on its own is not part of a
  // combination - the page already lists it as a single, and pairing it with
  // anything only adds a second key to a booking that needed one.
  const usable = candidates.filter((a) => a.maxGuests < guests)

  // Biggest first. A group is most cheaply housed in few large apartments, so
  // this reaches a workable answer early and lets the size ceiling cut the
  // search before it explores the small change.
  const pool = usable.sort((a, b) => b.maxGuests - a.maxGuests)
  if (pool.length < 2) return []

  const found: Combination[] = []

  function search(start: number, chosen: GroupCandidate[], capacity: number) {
    if (chosen.length >= 2 && capacity >= guests) {
      // Minimal by construction: this is the first point at which the group
      // fits, so every apartment in it was still needed when it was added.
      // Anything added after this would be dead weight, so the branch stops.
      found.push({
        // Presented by name, not by the size order the search happens to use:
        // a combination is read as a list of apartments, not as a ranking.
        apartments: [...chosen].sort((a, b) => a.name.localeCompare(b.name)),
        capacity,
        spareBeds: capacity - guests,
        bedrooms: chosen.reduce((sum, a) => sum + a.bedrooms, 0),
      })
      return
    }
    if (chosen.length >= maxApartments) return

    for (let i = start; i < pool.length; i++) {
      // Even taking the largest remaining apartments for every slot left, this
      // branch cannot reach the group. Nothing further along is bigger - the
      // pool is sorted - so neither can any branch after it.
      const slotsLeft = maxApartments - chosen.length
      const best = pool.slice(i, i + slotsLeft).reduce((sum, a) => sum + a.maxGuests, 0)
      if (capacity + best < guests) break

      chosen.push(pool[i])
      search(i + 1, chosen, capacity + pool[i].maxGuests)
      chosen.pop()
    }
  }

  search(0, [], 0)

  found.sort(
    (a, b) =>
      a.apartments.length - b.apartments.length ||
      a.spareBeds - b.spareBeds ||
      a.apartments[0].name.localeCompare(b.apartments[0].name),
  )
  return found.slice(0, limit)
}
