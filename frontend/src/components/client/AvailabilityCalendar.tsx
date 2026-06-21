import { useMemo, useState } from 'react'
import { toDateInputValue } from '../../utils/date'
import type { BlockedRange } from '../../api/bookingApi'
import styles from './AvailabilityCalendar.module.css'

interface Props {
  blocked: BlockedRange[]
  checkIn: string
  checkOut: string
  onChange: (checkIn: string, checkOut: string) => void
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

export default function AvailabilityCalendar({ blocked, checkIn, checkOut, onChange }: Props) {
  const blockedNights = useMemo(() => expandBlocked(blocked), [blocked])
  const today = toDateInputValue(new Date())
  const [offset, setOffset] = useState(0)

  function monthData(addMonths: number) {
    const base = new Date()
    const d = new Date(base.getFullYear(), base.getMonth() + addMonths, 1)
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
    if (iso < today) return 'past'
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

  const months = [monthData(offset), monthData(offset + 1)]

  return (
    <div className={styles.cal}>
      <button className={`${styles.nav} ${styles.prev}`} onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} aria-label="Previous">‹</button>
      <button className={`${styles.nav} ${styles.next}`} onClick={() => setOffset((o) => o + 1)} aria-label="Next">›</button>

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
