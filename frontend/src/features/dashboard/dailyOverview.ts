// One day, sorted into the two things somebody has to act on.
//
// Arrivals and departures. Guests already mid-stay are deliberately left out:
// nobody greets them, nobody cleans for them, and a list is read for what it
// asks you to do. The server's `?day=` filter still returns them - it answers a
// more general question - and they are dropped here.
//
// The split is made here rather than on the server because a same-day
// turnaround is one apartment appearing twice, in two different groups, and a
// server returning two lists would have to decide that twice and could
// disagree with itself.
//
// The arrival message carries the access details, because that is the message
// staff actually send: greeting, dates, then the same door-code and wifi block
// the codes page produces - `buildDoorCopyText`, not a second copy of it that
// drifts. A departure message carries none of that.

import { buildDoorCopyText } from '../codes/copyTemplates'
import type { DoorCodeRecord, ReservationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'

export type DaySplit = {
  arrivals: ReservationRecord[]
  departures: ReservationRecord[]
}

/** Sorted by apartment: the list is read walking round the building. */
function byApartment(rows: ReservationRecord[]): ReservationRecord[] {
  return [...rows].sort((a, b) =>
    (a.apartment || '').localeCompare(b.apartment || '', undefined, { numeric: true }),
  )
}

export function splitDay(rows: ReservationRecord[], day: string): DaySplit {
  const arrivals: ReservationRecord[] = []
  const departures: ReservationRecord[] = []

  for (const row of rows) {
    // A stay can only be one of the two, because check-in and check-out are
    // the same date only on a stay of no nights, which the form refuses.
    // Anything matching neither is mid-stay and is dropped.
    if (row.checkIn === day) arrivals.push(row)
    else if (row.checkOut === day) departures.push(row)
  }

  return { arrivals: byApartment(arrivals), departures: byApartment(departures) }
}

/** 'Ana Berisha' -> 'Ana'. A message uses a first name. */
function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || ''
}

function greeting(row: ReservationRecord): string {
  const name = firstName(row.guestName)
  return name ? `Hi ${name},` : 'Hello,'
}

export function buildArrivalMessage(row: ReservationRecord, code?: DoorCodeRecord): string {
  const lines = [
    greeting(row),
    '',
    `We are looking forward to welcoming you to ${row.apartment} today.`,
    `Your stay runs ${formatDisplayDate(row.checkIn)} to ${formatDisplayDate(row.checkOut)}.`,
  ]

  // The same block the codes page copies, built by the same function. An
  // apartment with nothing on file contributes nothing rather than a run of
  // empty labels - `buildDoorCopyText` already drops a line it cannot fill.
  const access = code ? buildDoorCopyText(code) : ''
  if (access) lines.push('', access)

  lines.push(
    '',
    'Please let us know roughly what time you expect to arrive and we will have',
    'everything ready for you.',
  )
  return lines.join('\n')
}

export function buildDepartureMessage(row: ReservationRecord): string {
  return [
    greeting(row),
    '',
    `Today is your last day at ${row.apartment} — check-out is ${formatDisplayDate(row.checkOut)}.`,
    '',
    'Please leave the keys in the apartment on your way out. Thank you for',
    'staying with us, and have a safe journey.',
  ].join('\n')
}
