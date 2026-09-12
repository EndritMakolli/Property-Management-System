import { describe, expect, it } from 'vitest'
import { placePopover } from './popoverPlacement'

const viewport = { width: 1440, height: 900 }
const pop = { width: 560, height: 380 }

/** A trigger sitting comfortably in the middle of the page. */
const middle = { top: 200, bottom: 238, left: 400, right: 700 }

describe('placePopover', () => {
  it('hangs below the trigger and lines up with its left edge', () => {
    expect(placePopover(middle, pop, viewport)).toEqual({ top: 244, left: 400 })
  })

  it('flips above when there is no room below', () => {
    // Trigger near the bottom: 900 - 838 = 62px below, far less than 380.
    const low = { top: 800, bottom: 838, left: 400, right: 700 }
    expect(placePopover(low, pop, viewport)).toEqual({ top: 414, left: 400 })
  })

  it('stays below when below is tight but still roomier than above', () => {
    // 300px below, 220px above — neither fits, so the bigger gap wins, and the
    // panel is then pulled up far enough to be wholly on screen rather than
    // running off the bottom.
    const middling = { top: 220, bottom: 600, left: 400, right: 700 }
    const placed = placePopover(middling, pop, viewport)
    expect(placed.top).toBeGreaterThan(middling.top)
    expect(placed.top + pop.height).toBeLessThanOrEqual(viewport.height)
  })

  it('pulls back from the right edge rather than hanging off it', () => {
    const nearRight = { top: 200, bottom: 238, left: 1200, right: 1400 }
    // 1440 - 560 - 8 = 872
    expect(placePopover(nearRight, pop, viewport).left).toBe(872)
  })

  it('never pushes past the left edge, even for a popover wider than the screen', () => {
    const narrow = { width: 400, height: 380 }
    const nearRight = { top: 200, bottom: 238, left: 380, right: 396 }
    expect(placePopover(nearRight, narrow, narrow.width > 400 ? viewport : { width: 360, height: 900 }).left).toBe(8)
  })

  it('clamps a popover taller than the viewport to the top gutter', () => {
    const tall = { width: 560, height: 2000 }
    expect(placePopover(middle, tall, viewport).top).toBe(8)
  })
})
