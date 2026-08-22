// One colour in, four out.
//
// An operator picks a single colour for a reservation type. The app draws that
// type in two quite different ways — a saturated pill on the calendar, and a
// pale chip in tables and lists — and each needs a text colour that can actually
// be read on it. Deriving all of that from the one choice is what keeps the
// seven places that used to hard-code these colours in agreement.
//
// Contrast is WCAG relative luminance, so "readable" means measured rather than
// eyeballed. Booking.com's pale blue and Monthly's yellow are the cases that
// break the naive "white text on everything" approach.

const FALLBACK = '#6b7280'

// The generated stylesheet is injected as raw text, so a code is only ever
// interpolated into a selector after proving it is a plain slug.
const SAFE_CODE = /^[a-z0-9][a-z0-9-]*$/

/** WCAG AA for normal-size text. */
const MIN_CONTRAST = 4.5

export type TypePalette = {
  /** The colour as chosen — calendar pills, timeline bars, chart series. */
  solid: string
  /** A pale wash of it — badge and chip backgrounds. */
  soft: string
  /** Readable text on `soft`. */
  ink: string
  /** Readable text on `solid`. */
  onSolid: string
}

type Rgb = [number, number, number]

function parseHex(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(hex)) return null
  return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16)) as Rgb
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours, 1 (identical) to 21. */
export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a) ?? parseHex(FALLBACK)!
  const second = parseHex(b) ?? parseHex(FALLBACK)!
  const lighter = Math.max(luminance(first), luminance(second))
  const darker = Math.min(luminance(first), luminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function mix(rgb: Rgb, towards: Rgb, amount: number): Rgb {
  return rgb.map((channel, index) => channel + (towards[index] - channel) * amount) as Rgb
}

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
const NEAR_BLACK = '#101010'

export function derivePalette(color: string): TypePalette {
  const rgb = parseHex(color) ?? parseHex(FALLBACK)!
  const solid = toHex(rgb)
  const soft = toHex(mix(rgb, WHITE, 0.88))

  // Whichever of white/near-black reads better. The worse of the two options is
  // still ~4.58:1 at the crossover luminance, so this always clears AA.
  const onSolid =
    contrastRatio('#ffffff', solid) >= contrastRatio(NEAR_BLACK, solid)
      ? '#ffffff'
      : NEAR_BLACK

  // Darken the hue itself — rather than falling back to plain grey — until the
  // label is readable on the pale chip. Mixing toward black keeps the hue, so a
  // Booking chip still reads as blue.
  let ink = solid
  for (let step = 0; step <= 20; step += 1) {
    ink = toHex(mix(rgb, BLACK, step * 0.05))
    if (contrastRatio(ink, soft) >= MIN_CONTRAST) break
  }

  return { solid, soft, ink, onSolid }
}

/**
 * The CSS custom properties one type contributes.
 *
 * Existing selectors keep their names — `.platform-airbnb` is still
 * `.platform-airbnb` — and only their values move here.
 */
export function paletteVariables(code: string, color: string): Record<string, string> {
  // Same guard as typeStylesheet. setProperty() will not execute a malformed
  // name, but the two paths take the same input and should refuse the same
  // things — a reader should not have to work out which one is the safe one.
  if (!SAFE_CODE.test(code)) return {}

  const { solid, soft, ink, onSolid } = derivePalette(color)
  return {
    [`--restype-${code}-solid`]: solid,
    [`--restype-${code}-soft`]: soft,
    [`--restype-${code}-ink`]: ink,
    [`--restype-${code}-on-solid`]: onSolid,
  }
}

/**
 * The stylesheet for a set of reservation types.
 *
 * Generated rather than hand-written for one reason: an admin can invent a
 * type, and a checked-in `.css` file cannot know that "glamping" exists. This
 * replaces the six blocks that used to colour these classes by hand across
 * calendar.css, shared.css, archive.css and dashboard.css — which had drifted
 * apart from each other and from the Python colour map.
 *
 * Selectors are the ones the components already emit, so nothing in the markup
 * changes; only where the colours come from.
 */
export function typeStylesheet(rows: { code: string; color: string }[]): string {
  return rows
    .filter((row) => SAFE_CODE.test(row.code))
    .map(({ code, color }) => {
      const { solid, soft, ink, onSolid } = derivePalette(color)
      return `
.calendar-reservation-pill.platform-${code},
.timeline-reservation-bar.platform-${code} {
  background: ${solid};
  color: ${onSolid};
}
.platform.platform-${code},
.platform-badge.platform-${code},
.attention-platform.platform-${code},
.search-res-platform-${code} {
  background: ${soft};
  color: ${ink};
}`
    })
    .join('')
}
