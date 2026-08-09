import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchCurrentUser, loginUser, logoutUser, verifyLoginCode } from '../api/pmsApi'
import type { AuthUser } from '../types/domain'

// Returned by login() when the account has two-step verification on: no session
// exists yet, and the caller must collect the emailed code and call verifyCode.
export type PendingTwoFactor = {
  challengeToken: string
  emailHint: string
}

type AuthContextValue = {
  checking: boolean
  /** Resolves to a pending challenge when 2FA is required, else null. */
  login: (username: string, password: string) => Promise<PendingTwoFactor | null>
  verifyCode: (challengeToken: string, code: string) => Promise<void>
  logout: () => Promise<void>
  user: AuthUser
}

const guestUser: AuthUser = {
  isAuthenticated: false,
  role: '',
  username: '',
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser>(guestUser)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function loadUser() {
      try {
        setUser(await fetchCurrentUser())
      } catch {
        setUser(guestUser)
      } finally {
        setChecking(false)
      }
    }

    loadUser()
  }, [])

  const value = useMemo(
    () => ({
      checking,
      user,
      async login(username: string, password: string) {
        const result = await loginUser({ username, password })
        if (result.status === 'twoFactorRequired') {
          setUser(guestUser)
          return { challengeToken: result.challengeToken, emailHint: result.emailHint }
        }
        if (!result.user?.isAuthenticated) {
          setUser(guestUser)
          throw new Error('Login did not complete. Please check the backend URL and try again.')
        }
        setUser(result.user)
        return null
      },
      async verifyCode(challengeToken: string, code: string) {
        const nextUser = await verifyLoginCode({ challengeToken, code })
        if (!nextUser?.isAuthenticated) {
          setUser(guestUser)
          throw new Error('Verification did not complete. Please sign in again.')
        }
        setUser(nextUser)
      },
      async logout() {
        await logoutUser()
        setUser(guestUser)
      },
    }),
    [checking, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }
  return context
}
