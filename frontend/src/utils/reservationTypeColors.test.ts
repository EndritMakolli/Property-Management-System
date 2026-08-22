import { describe, expect, it } from 'vitest'
import { contrastRatio, derivePalette, typeStylesheet } from './reservationTypeColors'

// The colours the app ships with. Whatever an operator picks later has to work
// the same way, so these are examples rather than the contract.
const SHIPPED = ['#202020', '#e51b3f', '#6ec8ff', '#f5c518', '#0d9488', '#16a34a']

describe('derivePalette', () => {
  it('keeps the chosen colour as the solid fill', () => {
    expect(derivePalette('#e51b3f').solid).toBe('#e51b3f')
  })

  it('normalises case so two spellings of one colour agree', () => {
    expect(derivePalette('#E51B3F')).toEqual(derivePalette('#e51b3f'))
  })

  it('falls back to grey rather than emitting nothing for junk input', () => {
    // A colour goes straight into a CSS custom property; an empty one would
    // silently make a badge invisible.
    expect(derivePalette('not a colour').solid).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('writes white on a dark fill', () => {
    expect(derivePalette('#202020').onSolid).toBe('#ffffff')
  })

  it('writes dark ink on a light fill', () => {
    // Booking.com's pale blue is the case that broke naive "always white".
    expect(derivePalette('#6ec8ff').onSolid).not.toBe('#ffffff')
  })

  it('writes dark ink on yellow', () => {
    expect(derivePalette('#f5c518').onSolid).not.toBe('#ffffff')
  })

  it('makes the badge background much lighter than the fill', () => {
    for (const hex of SHIPPED) {
      const { soft, solid } = derivePalette(hex)
      expect(relativeLuminance(soft)).toBeGreaterThan(relativeLuminance(solid))
    }
  })
})

describe('readability', () => {
  it('every shipped colour reads legibly on its own badge', () => {
    for (const hex of SHIPPED) {
      const { soft, ink } = derivePalette(hex)
      expect(contrastRatio(ink, soft)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('every shipped colour reads legibly on its own pill', () => {
    for (const hex of SHIPPED) {
      const { solid, onSolid } = derivePalette(hex)
      expect(contrastRatio(onSolid, solid)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a mid-tone colour is darkened until its label is readable', () => {
    // Mid greens are the hardest: light enough that white fails, dark enough
    // that the untouched hue fails on a pale background.
    const { soft, ink } = derivePalette('#16a34a')
    expect(contrastRatio(ink, soft)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#3c6e71', '#3c6e71')).toBeCloseTo(1, 5)
  })

  it('does not care which way round the two colours are given', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      5,
    )
  })
})

/** Local re-implementation, so the test does not lean on the code it checks. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

describe('typeStylesheet', () => {
  const rows = [
    { code: 'airbnb', color: '#e51b3f' },
    { code: 'booking', color: '#6ec8ff' },
  ]

  it('colours the calendar pill with the solid fill', () => {
    expect(typeStylesheet(rows)).toContain('.calendar-reservation-pill.platform-airbnb')
  })

  it('colours every badge family the app uses', () => {
    const css = typeStylesheet(rows)
    for (const selector of [
      '.platform-badge.platform-airbnb',
      '.attention-platform.platform-airbnb',
      '.search-res-platform-airbnb',
      '.platform.platform-airbnb',
    ]) {
      expect(css).toContain(selector)
    }
  })

  it('covers a type an admin invented, not just the built-in ones', () => {
    // This is the whole reason the stylesheet is generated rather than written
    // by hand: a hand-written file cannot know about "glamping".
    expect(typeStylesheet([{ code: 'glamping', color: '#00ff00' }])).toContain(
      '.platform-badge.platform-glamping',
    )
  })

  it('emits one block per type', () => {
    const css = typeStylesheet(rows)
    expect(css).toContain('platform-booking')
    expect(css).toContain('platform-airbnb')
  })

  it('refuses a code that could break out of the selector', () => {
    // Codes are slugs server-side, but this stylesheet is injected as raw text
    // — anything odd must be dropped rather than concatenated in.
    const css = typeStylesheet([{ code: 'a{}/**/body{display:none}', color: '#000000' }])
    expect(css).not.toContain('display:none')
  })

  it('is empty when there are no types', () => {
    expect(typeStylesheet([]).trim()).toBe('')
  })
})
