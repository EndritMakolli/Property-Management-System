import type { ReservationRecord } from '../../types/domain'

// ─────────────────────────────────────────────────────────
// Fuzzy reservation search — shared by the Reservations Table
// view and the Reservations List view.
// ─────────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j])
    }
  }
  return matrix[b.length][a.length]
}

export function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[–—]/g, '-').split(/[\s,./]+/).filter((t) => t.length > 0)
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
}

export function normaliseToken(t: string): string {
  return MONTH_MAP[t] ?? t
}

export function buildHaystack(r: ReservationRecord): string {
  return [r.guestName, r.guestPhone, r.apartment, r.reservationType, r.checkIn, r.checkOut, r.notes,
    String(Math.round(Number(r.totalPaid)))]
    .filter(Boolean).join(' ').toLowerCase()
}

// Month names ordered longest-first so "september" wins over "sep" when matching.
const MONTH_NAMES = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length).join('|')

function isoDate(year: string | number, month: string, day: string): string | null {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Pull a specific calendar day out of a free-text query and return both the ISO
// date and the leftover text (so the rest can still match guest/apartment/etc.).
// Supports: 2024-05-15 · 15/05/2024 · 15.5.24 · 15-05-2024 · "15 May 2024" ·
// "May 15" · "15 May". Day-first is assumed (the format used across the app).
export function parseSpecificDate(query: string): { iso: string; rest: string } | null {
  const text = query.toLowerCase().replace(/[–—]/g, '-')
  const currentYear = new Date().getFullYear()

  const patterns: { re: RegExp; build: (m: RegExpMatchArray) => string | null }[] = [
    { re: /(\d{4})-(\d{1,2})-(\d{1,2})/, build: (m) => isoDate(m[1], m[2], m[3]) },
    {
      re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/,
      build: (m) => isoDate(m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]),
    },
    {
      re: new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})(?:\\s+(\\d{4}))?\\b`),
      build: (m) => isoDate(m[3] ?? currentYear, MONTH_MAP[m[2]], m[1]),
    },
    {
      re: new RegExp(`\\b(${MONTH_NAMES})\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?\\b`),
      build: (m) => isoDate(m[3] ?? currentYear, MONTH_MAP[m[1]], m[2]),
    },
  ]

  for (const { re, build } of patterns) {
    const m = text.match(re)
    if (m && m.index !== undefined) {
      const iso = build(m)
      if (iso) {
        const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim()
        return { iso, rest }
      }
    }
  }
  return null
}

// True when the reservation's stay covers the given ISO date (check-in and
// check-out days included).
export function stayCoversDate(r: ReservationRecord, iso: string): boolean {
  return r.checkIn <= iso && iso <= r.checkOut
}

export function scoreReservation(query: string, r: ReservationRecord): number {
  // Specific-date search: rank reservations whose stay covers the date highest,
  // and drop the rest entirely when the date is the whole query.
  const dateMatch = parseSpecificDate(query)
  let textQuery = query
  let score = 0
  if (dateMatch) {
    textQuery = dateMatch.rest
    if (stayCoversDate(r, dateMatch.iso)) {
      score += 6
    } else if (!textQuery) {
      return 0
    }
  }

  const tokens = tokenize(textQuery).map(normaliseToken)
  if (tokens.length === 0) return score
  const haystack = buildHaystack(r)
  const words = haystack.split(/\s+/)
  for (const token of tokens) {
    if (haystack.includes(token)) { score += 3 } else {
      let best = Infinity
      for (const word of words) {
        if (word.length < 2) continue
        if (token.length >= 3) best = Math.min(best, levenshtein(token, word))
      }
      if (best <= 1) score += 2
      else if (best <= 2) score += 1
    }
  }
  return score
}

export function overlaps(r: ReservationRecord, ci: string, co: string) {
  return r.checkIn < co && r.checkOut > ci
}
