// Check-in and check-out, picked from a real calendar.
//
// The PMS used two native `<input type="date">` fields opened with
// showPicker(). That gives the browser's own popup: one month, no idea which
// nights are already taken, and a different look on every machine. This shows
// the same calendar the guest site uses.
//
// The two ends are separate controls. Picking a whole stay in one gesture is
// right when there is no stay yet, and wrong once there is: changing a
// departure meant re-entering an arrival that was already correct, and one
// stray click wiped both. Clicking "Check-in" now edits the arrival, clicking
// "Check-out" the departure, and the calendar constrains itself accordingly -
// see `stayRangeEdit.ts`, which holds those rules on their own.
//
// The panel is rendered into the document body rather than next to the field.
// `position: absolute` is measured from the nearest positioned ancestor and
// clipped by any ancestor that hides its overflow, which is exactly what the
// Pricing page's sticky "Test a stay" bar did to it. A portal has no ancestors
// to be trapped by; `popoverPlacement.ts` does the arithmetic that replaces.

import { CalendarDays } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDisplayDate } from '../../utils/date'
import { placePopover } from './popoverPlacement'
import StayRangePicker, { type BlockedRange } from './StayRangePicker'
import type { EditMode } from './stayRangeEdit'
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

/** Below this the panel is a sheet anchored to the viewport, not to the field.
 *  Kept in step with the media query in StayDateRangeField.css. */
const SHEET_BREAKPOINT = 700

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
  // Which end the calendar is currently editing, or null when it is closed.
  const [editing, setEditing] = useState<Exclude<EditMode, 'range'> | null>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const open = editing !== null

  const reposition = useCallback(() => {
    const trigger = wrapRef.current
    const pop = popRef.current
    if (!trigger || !pop) return
    // A sheet is positioned by the stylesheet against the viewport; measuring
    // the field would only fight it.
    if (window.innerWidth <= SHEET_BREAKPOINT) {
      setAt(null)
      return
    }
    setAt(
      placePopover(trigger.getBoundingClientRect(), pop.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    )
  }, [])

  // Before paint, so the panel never shows at the wrong place first.
  useLayoutEffect(() => {
    if (open) reposition()
  }, [open, reposition])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      // The panel is portalled, so it is no longer inside the field. Both have
      // to be asked, or a click on a day would count as a click elsewhere.
      if (wrapRef.current?.contains(target) || popRef.current?.contains(target)) return
      setEditing(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setEditing(null)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // A portalled panel does not travel with the page, so it is re-measured
    // rather than left behind. `capture` catches scrolling inside a panel too.
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, reposition])

  function handleChange(nextIn: string, nextOut: string, complete: boolean) {
    onChange(nextIn, nextOut)
    // Close only once the answer is whole. Closing on a half-chosen range
    // would strand the choice; leaving it open after a complete one would
    // make every edit take an extra click to dismiss.
    if (complete) setEditing(null)
  }

  function toggle(end: Exclude<EditMode, 'range'>) {
    setEditing((current) => (current === end ? null : end))
  }

  const panel = (
    <div
      className="stay-range-pop"
      ref={popRef}
      style={at ? { top: at.top, left: at.left } : undefined}
    >
      <StayRangePicker
        allowPast={allowPast}
        blocked={blocked}
        checkIn={checkIn}
        checkOut={checkOut}
        mode={editing ?? 'range'}
        tone="pms"
        onChange={handleChange}
      />
    </div>
  )

  return (
    <div className="stay-range" ref={wrapRef}>
      <div className="stay-range-trigger">
        <CalendarDays className="stay-range-icon" size={15} />
        <button
          aria-expanded={editing === 'checkIn'}
          className={`stay-range-part${editing === 'checkIn' ? ' is-editing' : ''}`}
          disabled={disabled}
          type="button"
          onClick={() => toggle('checkIn')}
        >
          <small>{checkInLabel}</small>
          <strong>{checkIn ? formatDisplayDate(checkIn) : 'Choose'}</strong>
        </button>
        <span className="stay-range-arrow">→</span>
        <button
          aria-expanded={editing === 'checkOut'}
          className={`stay-range-part${editing === 'checkOut' ? ' is-editing' : ''}`}
          disabled={disabled}
          type="button"
          onClick={() => toggle('checkOut')}
        >
          <small>{checkOutLabel}</small>
          <strong>{checkOut ? formatDisplayDate(checkOut) : 'Choose'}</strong>
        </button>
      </div>

      {open && createPortal(panel, document.body)}
    </div>
  )
}
