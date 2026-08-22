// The guest equivalent of RequireAuth, and deliberately a separate file.
//
// No roles, no allow-list: a guest has exactly one page. The `checking` gate
// matters for the same reason it does on the staff side — without it, the first
// render bounces to the sign-in page before /api/guest/auth/me/ has answered.

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useGuestAuth } from './GuestAuthContext'

export function RequireGuest() {
  const { checking, account } = useGuestAuth()
  const location = useLocation()

  if (checking) {
    return <p className="auth-loading">Checking your session...</p>
  }

  if (!account.isAuthenticated) {
    return <Navigate replace state={{ from: location }} to="/login" />
  }

  return <Outlet />
}
