import { toDateInputValue } from './date'

// Guest-site search state (dates + party size), shared between the home page
// and the map page and persisted so navigation does not reset the selection.
const STORAGE_KEY = 'pms.client.search'

export type ClientSearch = {
  checkIn: string
  checkOut: string
  guests: number
}

export function defaultClientSearch(): ClientSearch {
  const a = new Date()
  a.setDate(a.getDate() + 2)
  const b = new Date()
  b.setDate(b.getDate() + 5)
  return { checkIn: toDateInputValue(a), checkOut: toDateInputValue(b), guests: 2 }
}

export function readClientSearch(): ClientSearch {
  const fallback = defaultClientSearch()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<ClientSearch>
    const checkIn = typeof parsed.checkIn === 'string' ? parsed.checkIn : ''
    const checkOut = typeof parsed.checkOut === 'string' ? parsed.checkOut : ''
    const guests = Number(parsed.guests)
    const today = toDateInputValue(new Date())
    // A stale past range would make every search fail — fall back to defaults.
    if (!checkIn || !checkOut || checkIn < today || checkOut <= checkIn) return fallback
    return {
      checkIn,
      checkOut,
      guests: Number.isFinite(guests) && guests >= 1 ? Math.min(Math.round(guests), 16) : fallback.guests,
    }
  } catch {
    return fallback
  }
}

export function saveClientSearch(search: ClientSearch) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(search))
  } catch {
    // Storage may be unavailable (private mode) — persisting is best-effort.
  }
}
