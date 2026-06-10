import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { canAccess } from './roleAccess'

export function RequireAuth() {
  const { checking, user } = useAuth()
  const location = useLocation()

  if (checking) {
    return <p className="auth-loading">Checking access...</p>
  }

  if (!user.isAuthenticated) {
    return <Navigate replace state={{ from: location }} to="/login" />
  }

  if (!canAccess(user.role, location.pathname)) {
    return <Navigate replace to="/dashboard" />
  }

  return <Outlet />
}
