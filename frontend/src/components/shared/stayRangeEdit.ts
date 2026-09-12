// What a click on a day means, given which end of the stay is being edited.
//
// The picker began as one gesture: click check-in, click check-out, done. That
// is right when a stay is being created, and wrong every other time - changing
// a departure meant re-entering an arrival that was already correct, and one
// stray click wiped both. So the field now offers the two ends separately, and
// the mode decides what a day click does.
//
// Kept pure and away from the component so the rules can be read and tested
// without a calendar, a DOM, or a click.

export type StayEdit = { checkIn: string; checkOut: string }

/**
 * Which end is being chosen.
 *
 * `range` is the original behaviour and stays the default, because the guest
 * site picks a whole stay from scratch and should not ask for two decisions.
 */
export type EditMode = 'range' | 'checkIn' | 'checkOut'

/** Whether any night in `[from, to)` is already taken. */
export type BlockedBetween = (from: string, to: string) => boolean

export type ClickResult = StayEdit & {
  /** The stay is whole, so the caller may close the calendar. */
  complete: boolean
}

/**
 * Apply a click on `iso`.
 *
 * ISO dates compare correctly as strings, which is why there is no parsing
 * here: '2026-06-04' < '2026-06-10' is both true and cheap.
 */
export function applyDayClick(
  current: StayEdit,
  iso: string,
  mode: EditMode,
  blockedBetween: BlockedBetween,
): ClickResult {
  if (mode === 'checkIn') {
    // Keep the departure if it still describes a real stay. Anything else -
    // a departure now in the past of the arrival, or one that would book
    // straight through somebody else - is dropped rather than silently kept
    // as an impossible range.
    const keepsCheckOut =
      Boolean(current.checkOut) && current.checkOut > iso && !blockedBetween(iso, current.checkOut)
    return {
      checkIn: iso,
      checkOut: keepsCheckOut ? current.checkOut : '',
      complete: keepsCheckOut,
    }
  }

  if (mode === 'checkOut') {
    // A departure with nothing to depart from is really an arrival. This only
    // happens on an empty field; `forbiddenByMode` blocks the rest.
    if (!current.checkIn) return { checkIn: iso, checkOut: '', complete: false }
    return { checkIn: current.checkIn, checkOut: iso, complete: true }
  }

  // range: the original two-click gesture, unchanged.
  const starting = !current.checkIn || Boolean(current.checkOut)
  if (starting) return { checkIn: iso, checkOut: '', complete: false }
  if (iso <= current.checkIn || blockedBetween(current.checkIn, iso)) {
    return { checkIn: iso, checkOut: '', complete: false }
  }
  return { checkIn: current.checkIn, checkOut: iso, complete: true }
}

/**
 * Days the *mode* refuses, on top of the ones the calendar already refuses for
 * being in the past or already booked.
 *
 * Only check-out mode adds any: a departure cannot land on or before its own
 * arrival, and cannot be reached by booking through a taken night. Disabling
 * them is kinder than accepting the click and quietly rewriting the arrival.
 */
export function forbiddenByMode(
  iso: string,
  mode: EditMode,
  current: StayEdit,
  blockedBetween: BlockedBetween,
): boolean {
  if (mode !== 'checkOut' || !current.checkIn) return false
  if (iso <= current.checkIn) return true
  return blockedBetween(current.checkIn, iso)
}
