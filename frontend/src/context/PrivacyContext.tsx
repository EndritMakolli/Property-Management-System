// One switch that hides every euro figure on screen.
//
// For working in the PMS with someone beside you: turnover, forecasts, client
// spend and revenue charts blur, while counts, occupancy, names and apartments
// stay readable so the app is still usable. The choice is remembered, because
// the moment it exists for is the moment a stray refresh must not undo it.
//
// The flag is published as `data-privacy="on"` on the document root, so the
// blur is one CSS rule rather than a prop threaded through every page.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { readPrivacy, writePrivacy } from '../utils/privacyPreference'

type PrivacyValue = {
  hidden: boolean
  toggle: () => void
  setHidden: (hidden: boolean) => void
}

const PrivacyContext = createContext<PrivacyValue | null>(null)

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHiddenState] = useState<boolean>(() => readPrivacy())

  useEffect(() => {
    const root = document.documentElement
    if (hidden) root.setAttribute('data-privacy', 'on')
    else root.removeAttribute('data-privacy')
  }, [hidden])

  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next)
    writePrivacy(next)
  }, [])

  const value = useMemo(
    () => ({ hidden, setHidden, toggle: () => setHidden(!hidden) }),
    [hidden, setHidden],
  )

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
}

export function usePrivacy() {
  const value = useContext(PrivacyContext)
  if (!value) {
    throw new Error('usePrivacy must be used inside a PrivacyProvider')
  }
  return value
}
