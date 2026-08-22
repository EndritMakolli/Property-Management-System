import { useCallback, useEffect, useState } from 'react'

// Who has actually turned up, and when.
//
// Deliberately not stored on the server. This is a scratchpad for the shift —
// useful until midnight, worthless after, and not something anyone should have
// to maintain as a record. Keeping it in the browser means it survives a
// refresh (an accidental F5 mid-afternoon does not wipe the morning) without
// becoming data.
//
// The generic useLocalStorageState hook cannot be used here: its initialiser
// runs once, so changing the date would keep the previous day's state and then
// write it back under the new day's key.

const PREFIX = 'pms.checkins.'

export type CheckInNote = {
  arrived: boolean
  /** Free text, so "14:30", "late", and "" are all fine. */
  time: string
}

export type DayNotes = Record<string, CheckInNote>

function read(date: string): DayNotes {
  try {
    const stored = window.localStorage.getItem(PREFIX + date)
    return stored ? (JSON.parse(stored) as DayNotes) : {}
  } catch {
    return {}
  }
}

/** Drop every other day's scratchpad, so this never grows without bound. */
function pruneOtherDays(keep: string) {
  try {
    const stale: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(PREFIX) && key !== PREFIX + keep) stale.push(key)
    }
    stale.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    /* Storage unavailable (private mode, quota). Nothing here is worth failing for. */
  }
}

export function useDayCheckIns(date: string) {
  const [notes, setNotes] = useState<DayNotes>(() => read(date))

  // Re-read on the way to a different day, and forget the ones behind us.
  useEffect(() => {
    setNotes(read(date))
    pruneOtherDays(date)
  }, [date])

  const update = useCallback(
    (reservationId: string, patch: Partial<CheckInNote>) => {
      setNotes((current) => {
        const existing = current[reservationId] ?? { arrived: false, time: '' }
        const next: DayNotes = {
          ...current,
          [reservationId]: { ...existing, ...patch },
        }
        try {
          window.localStorage.setItem(PREFIX + date, JSON.stringify(next))
        } catch {
          /* Not worth surfacing — the tick still works for this session. */
        }
        return next
      })
    },
    [date],
  )

  return { notes, update }
}
