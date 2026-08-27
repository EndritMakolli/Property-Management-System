import { describe, expect, it } from 'vitest'
import {
  PRIVACY_STORAGE_KEY,
  readPrivacy,
  writePrivacy,
  type PreferenceStore,
} from './privacyPreference'

// The point of the toggle is that a stray refresh cannot undo it, so the
// preference has to survive a reload — and a corrupt, missing or unreadable
// value has to fall back to *visible*, never silently to hidden. A blurred
// figure nobody asked for reads as a broken page, and cannot be told apart
// from a genuine zero.

function fakeStore(initial: Record<string, string> = {}): PreferenceStore {
  const data = { ...initial }
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe('readPrivacy', () => {
  it('starts visible when nothing has been stored', () => {
    expect(readPrivacy(fakeStore())).toBe(false)
  })

  it('remembers that privacy was switched on', () => {
    const store = fakeStore()
    writePrivacy(true, store)
    expect(readPrivacy(store)).toBe(true)
  })

  it('remembers that it was switched back off', () => {
    const store = fakeStore()
    writePrivacy(true, store)
    writePrivacy(false, store)
    expect(readPrivacy(store)).toBe(false)
  })

  it('falls back to visible on a value it does not recognise', () => {
    expect(readPrivacy(fakeStore({ [PRIVACY_STORAGE_KEY]: 'maybe' }))).toBe(false)
  })

  it('does not treat the string "false" as true', () => {
    // Every non-empty string is truthy in JS; this is how that goes wrong.
    expect(readPrivacy(fakeStore({ [PRIVACY_STORAGE_KEY]: 'false' }))).toBe(false)
  })

  it('falls back to visible when there is no storage at all', () => {
    expect(readPrivacy(null)).toBe(false)
  })

  it('falls back to visible when storage throws', () => {
    const hostile: PreferenceStore = {
      getItem: () => {
        throw new Error('private mode')
      },
      setItem: () => {},
    }
    expect(readPrivacy(hostile)).toBe(false)
  })
})

describe('writePrivacy', () => {
  it('stores something readPrivacy agrees with', () => {
    const store = fakeStore()
    writePrivacy(true, store)
    expect(readPrivacy(store)).toBe(true)
  })

  it('survives storage that refuses to write', () => {
    const hostile: PreferenceStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => writePrivacy(true, hostile)).not.toThrow()
  })

  it('survives no storage at all', () => {
    expect(() => writePrivacy(true, null)).not.toThrow()
  })
})
