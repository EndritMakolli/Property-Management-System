import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchCurrentUser, loginUser, logoutUser } from '../api/pmsApi'
import type { AuthUser } from '../types/domain'

type AuthContextValue = {
  checking: boolean
  login: (username: string, password: string) => Promise<void>
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
        const nextUser = await loginUser({ username, password })
        if (!nextUser?.isAuthenticated) {
          setUser(guestUser)
          throw new Error('Login did not complete. Please check the backend URL and try again.')
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
