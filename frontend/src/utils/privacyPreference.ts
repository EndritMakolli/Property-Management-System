// Whether money is hidden on screen, remembered per browser.
//
// Two rules worth stating. It persists, because the button exists for the
// moment someone walks up to you and a stray refresh must not undo it. And an
// unreadable value falls back to *visible*, never to hidden — a figure blurred
// without being asked for looks like a rendering bug, and the reader has no way
// to tell it from a real zero.
//
// Storage is a parameter rather than a reach for `window`, so both branches are
// testable without a DOM, and so a browser that refuses localStorage (private
// mode throws on access rather than returning null) degrades to "visible"
// instead of taking the toggle down with it.

export const PRIVACY_STORAGE_KEY = 'pms.privacy'

/** The subset of the Storage API this needs. */
export type PreferenceStore = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): PreferenceStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readPrivacy(store: PreferenceStore | null = browserStore()): boolean {
  try {
    return store?.getItem(PRIVACY_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function writePrivacy(
  hidden: boolean,
  store: PreferenceStore | null = browserStore(),
): void {
  try {
    store?.setItem(PRIVACY_STORAGE_KEY, hidden ? 'on' : 'off')
  } catch {
    // Not being able to remember it is survivable; failing the toggle is not.
  }
}
