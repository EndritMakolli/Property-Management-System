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

export function scoreReservation(query: string, r: ReservationRecord): number {
  const tokens = tokenize(query).map(normaliseToken)
  if (tokens.length === 0) return 0
  const haystack = buildHaystack(r)
  const words = haystack.split(/\s+/)
  let score = 0
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
