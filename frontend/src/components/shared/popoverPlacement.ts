// Where a floating panel goes, measured from the control that opened it.
//
// Hanging a popover off its trigger with `position: absolute` looks right until
// the trigger sits inside a panel that clips - and on the Pricing page it does:
// "Test a stay" is `position: sticky; z-index: 5; overflow: hidden`, which both
// cut the calendar off at the bar and sealed it into a stacking context five
// layers down. Neither is fixable from inside; the popover has to leave.
//
// So it is rendered into the document body and positioned from the trigger's
// measured rectangle instead. That escapes every clipping ancestor and every
// stacking context, and the arithmetic that replaces the browser's is here,
// where it can be tested without a layout.

export type Rect = { top: number; bottom: number; left: number; right: number }
export type Size = { width: number; height: number }
export type Viewport = { width: number; height: number }
export type Point = { top: number; left: number }

/** Breathing room kept between the popover and the edge of the screen. */
const GUTTER = 8
/** The gap between the trigger and the panel below it. */
const OFFSET = 6

export function placePopover(trigger: Rect, pop: Size, viewport: Viewport): Point {
  const below = viewport.height - trigger.bottom
  const above = trigger.top

  // Below unless above is genuinely roomier. When neither side fits - a short
  // window, a tall calendar - the larger gap still shows the most of it.
  const fitsBelow = below >= pop.height + OFFSET + GUTTER
  const goBelow = fitsBelow || below >= above

  const top = goBelow ? trigger.bottom + OFFSET : trigger.top - pop.height - OFFSET

  return {
    top: clamp(top, GUTTER, Math.max(GUTTER, viewport.height - pop.height - GUTTER)),
    left: clamp(trigger.left, GUTTER, Math.max(GUTTER, viewport.width - pop.width - GUTTER)),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
