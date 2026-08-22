// Check-in and check-out, picked from a real calendar.
//
// The PMS used two native `<input type="date">` fields opened with
// showPicker(). That gives the browser's own popup: one month, no idea which
// nights are already taken, and a different look on every machine. This shows
// the same calendar the guest site uses, and — because check-in and check-out
// are one decision, not two — picks the range in a single gesture.

import { CalendarDays } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatDisplayDate } from '../../utils/date'
import StayRangePicker, { type BlockedRange } from './StayRangePicker'
import './StayDateRangeField.css'

type Props = {
  checkIn: string
  checkOut: string
  onChange: (checkIn: string, checkOut: string) => void
  /** Nights already taken, when the caller knows which apartment is meant. */
  blocked?: BlockedRange[]
  checkInLabel?: string
  checkOutLabel?: string
  disabled?: boolean
  /** Staff record stays that already happened, so past dates are allowed
   *  by default here — unlike the guest site. */
  allowPast?: boolean
}

export function StayDateRangeField({
  checkIn,
  checkOut,
  onChange,
  blocked,
  checkInLabel = 'Check-in',
  checkOutLabel = 'Check-out',
  disabled = false,
  allowPast = true,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on a click elsewhere or on Escape — the two things anyone tries.
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function handleChange(nextIn: string, nextOut: string) {
    onChange(nextIn, nextOut)
    // Only close once the range is complete: the first click picks check-in and
    // the second picks check-out, so closing early would strand a half-choice.
    if (nextIn && nextOut) setOpen(false)
  }

  return (
    <div className="stay-range" ref={wrapRef}>
      <button
        className="stay-range-trigger"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={15} />
        <span className="stay-range-part">
          <small>{checkInLabel}</small>
          <strong>{checkIn ? formatDisplayDate(checkIn) : 'Choose'}</strong>
        </span>
        <span className="stay-range-arrow">→</span>
        <span className="stay-range-part">
          <small>{checkOutLabel}</small>
          <strong>{checkOut ? formatDisplayDate(checkOut) : 'Choose'}</strong>
        </span>
      </button>

      {open && (
        <div className="stay-range-pop">
          <StayRangePicker
            allowPast={allowPast}
            blocked={blocked}
            checkIn={checkIn}
            checkOut={checkOut}
            tone="pms"
            onChange={handleChange}
          />
        </div>
      )}
    </div>
  )
}
