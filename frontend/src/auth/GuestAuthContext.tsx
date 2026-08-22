// The guest session, entirely separate from the staff one.
//
// This file must not import from AuthContext, RequireAuth or roleAccess, and
// none of those may import from here. The two systems never consult each other:
// a browser can hold a staff session and a guest session at once, and neither
// notices. That independence is the frontend half of the same decision the
// backend makes by never turning a guest into a Django user.
//
// Note the name below is `signedOutGuest`, not `guestUser` — AuthContext
// already uses `guestUser` to mean "an anonymous *staff* visitor", and having
// both would be a trap.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  fetchGuestAccount,
  logoutGuestAccount,
  requestGuestLink,
  verifyGuestToken,
} from '../api/guestAccount'
import type { GuestAccountUser } from '../types/domain'

const signedOutGuest: GuestAccountUser = { isAuthenticated: false, email: '' }

type GuestAuthValue = {
  checking: boolean
  account: GuestAccountUser
  /** Ask for a sign-in link. Resolves whether or not the address is known. */
  requestLink: (email: string) => Promise<void>
  verifyToken: (token: string) => Promise<void>
  logout: () => Promise<void>
}

const GuestAuthContext = createContext<GuestAuthValue | undefined>(undefined)

export function GuestAuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<GuestAccountUser>(signedOutGuest)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let ignore = false
    fetchGuestAccount()
      .then((loaded) => {
        if (!ignore) setAccount(loaded)
      })
      .catch(() => {
        if (!ignore) setAccount(signedOutGuest)
      })
      .finally(() => {
        if (!ignore) setChecking(false)
      })
    return () => {
      ignore = true
    }
  }, [])

  const requestLink = useCallback(async (email: string) => {
    // Deliberately returns nothing useful. The server answers identically for a
    // known and an unknown address, so there is nothing here to branch on — and
    // branching would leak exactly what the endpoint refuses to say.
    await requestGuestLink(email)
  }, [])

  const verifyToken = useCallback(async (token: string) => {
    setAccount(await verifyGuestToken(token))
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutGuestAccount()
    } finally {
      setAccount(signedOutGuest)
    }
  }, [])

  const value = useMemo<GuestAuthValue>(
    () => ({ checking, account, requestLink, verifyToken, logout }),
    [checking, account, requestLink, verifyToken, logout],
  )

  return <GuestAuthContext.Provider value={value}>{children}</GuestAuthContext.Provider>
}

export function useGuestAuth() {
  const value = useContext(GuestAuthContext)
  if (!value) {
    throw new Error('useGuestAuth must be used inside a GuestAuthProvider.')
  }
  return value
}
