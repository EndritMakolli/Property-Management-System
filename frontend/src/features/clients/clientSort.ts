// The sort keys the client directory offers.
//
// Ordering happens on the server, because the page only holds twenty rows at a
// time and sorting those would order the page rather than the directory. This
// module is the contract: the keys here must match CLIENT_SORTS in
// views/_guests.py, and `isClientSortKey` is what stops a stale localStorage
// value or a hand-edited URL reaching the query.

export type ClientSortKey = 'name' | 'stays' | 'nights' | 'paid' | 'added'
export type SortDirection = 'asc' | 'desc'

export const CLIENT_SORT_OPTIONS: { value: ClientSortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'stays', label: 'Stays' },
  { value: 'nights', label: 'Nights' },
  { value: 'paid', label: 'Total paid' },
  { value: 'added', label: 'Date added' },
]

const KEYS = new Set<string>(CLIENT_SORT_OPTIONS.map((option) => option.value))

export function isClientSortKey(value: string): value is ClientSortKey {
  return KEYS.has(value)
}

/** The `sort` parameter the API expects: `nights` or `-nights`. */
export function nextDirection(key: ClientSortKey, direction: SortDirection): string {
  return direction === 'desc' ? `-${key}` : key
}
