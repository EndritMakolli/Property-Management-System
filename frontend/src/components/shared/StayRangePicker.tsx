// The stay date picker, shared by the guest site and the PMS.
//
// It began as the guest booking calendar. The PMS used native
// `<input type="date">` pickers, which open the browser's own grey popup and
// cannot show which nights are already taken — so this moved here rather than
// being reimplemented. One component, two palettes (see `tone`).

import { useMemo, useState } from 'react'
import { toDateInputValue } from '../../utils/date'
import { compareMonths, openingMonth, shiftMonth } from './stayRangeMonths'
import styles from './StayRangePicker.module.css'

/** A night that cannot be booked. Structural, so this component stays
 *  independent of whichever API produced it. */
export type BlockedRange = { checkIn: string; checkOut: string }

interface Props {
  blocked?: BlockedRange[]
  checkIn: string
  checkOut: string
  onChange: (checkIn: string, checkOut: string) => void
  /** Which palette to wear. The guest site is warm; the PMS is not. */
  tone?: 'client' | 'pms'
  /** How many months to show at once. Two side by side unless space is tight. */
  months?: number
  /**
   * Whether dates before today can be chosen.
   *
   * False for a guest — nobody books last week. True inside the PMS, where
   * staff record stays that already happened and price ones that did.
   */
  allowPast?: boolean
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return toDateInputValue(d)
}

function expandBlocked(ranges: BlockedRange[]): Set<string> {
  const set = new Set<string>()
  for (const r of ranges) {
    let cur = r.checkIn
    while (cur < r.checkOut) {
      set.add(cur)
      cur = addDays(cur, 1)
    }
  }
  return set
}

export default function StayRangePicker({
  blocked = [],
  checkIn,
  checkOut,
  onChange,
  tone = 'client',
  months: monthCount = 2,
  allowPast = false,
}: Props) {
  const blockedNights = useMemo(() => expandBlocked(blocked), [blocked])
  const today = toDateInputValue(new Date())

  // Where the calendar opens. Initialised from the stay being edited rather
  // than from today, and held as state so it does not jump back mid-selection
  // when the first click rewrites check-in.
  const [view, setView] = useState(() => openingMonth(checkIn, today))
  const floor = allowPast ? null : openingMonth('', today)
  const atFloor = floor !== null && compareMonths(view, floor) <= 0

  function monthData(addMonths: number) {
    const shifted = shiftMonth(view, addMonths)
    const d = new Date(shifted.year, shifted.month, 1)
    const year = d.getFullYear()
    const month = d.getMonth()
    const firstWeekday = d.getDay()
    const days = new Date(year, month + 1, 0).getDate()
    const cells: (string | null)[] = []
    for (let i = 0; i < firstWeekday; i++) cells.push(null)
    for (let day = 1; day <= days; day++) cells.push(toDateInputValue(new Date(year, month, day)))
    return { label: `${MONTHS[month]} ${year}`, cells }
  }

  function state(iso: string) {
    if (!allowPast && iso < today) return 'past'
    if (blockedNights.has(iso)) return 'blocked'
    return 'open'
  }

  function rangeHasBlocked(ci: string, co: string) {
    let cur = ci
    while (cur < co) {
      if (blockedNights.has(cur)) return true
      cur = addDays(cur, 1)
    }
    return false
  }

  function clickDay(iso: string) {
    if (state(iso) !== 'open') return
    if (!checkIn || (checkIn && checkOut)) { onChange(iso, ''); return }
    if (iso <= checkIn || rangeHasBlocked(checkIn, iso)) { onChange(iso, ''); return }
    onChange(checkIn, iso)
  }

  function inRange(iso: string) {
    if (checkIn && checkOut) return iso >= checkIn && iso <= checkOut
    return iso === checkIn
  }

  const months = Array.from({ length: monthCount }, (_, index) => monthData(index))

  return (
    <div
      className={[styles.cal, tone === 'pms' ? styles.pms : '', monthCount === 1 ? styles.single : '']
        .filter(Boolean)
        .join(' ')}
    >
      {/* type="button" matters: this picker is rendered inside forms, and a
          button with no type defaults to submit. */}
      <button
        aria-label="Previous month"
        className={`${styles.nav} ${styles.prev}`}
        disabled={atFloor}
        type="button"
        onClick={() => setView((current) => shiftMonth(current, -1))}
      >
        ‹
      </button>
      <button
        aria-label="Next month"
        className={`${styles.nav} ${styles.next}`}
        type="button"
        onClick={() => setView((current) => shiftMonth(current, 1))}
      >
        ›
      </button>

      <div className={styles.months}>
        {months.map((m, mi) => (
          <div key={mi} className={styles.month}>
            <div className={styles.monthLabel}>{m.label}</div>
            <div className={styles.weekdays}>
              {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
            </div>
            <div className={styles.grid}>
              {m.cells.map((iso, ci) =>
                iso === null ? (
                  <span key={ci} />
                ) : (
                  <button
                    key={ci}
                    type="button"
                    className={[
                      styles.day,
                      styles[state(iso)],
                      inRange(iso) ? styles.sel : '',
                      iso === checkIn || iso === checkOut ? styles.edge : '',
                    ].join(' ')}
                    onClick={() => clickDay(iso)}
                    disabled={state(iso) !== 'open'}
                  >
                    {Number(iso.slice(8))}
                  </button>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.legend}>
        <span><i className={styles.legOpen} /> Available</span>
        <span><i className={styles.legBlocked} /> Booked</span>
      </div>
    </div>
  )
}
