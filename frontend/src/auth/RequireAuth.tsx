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
    // /staff-login, not /login: /login is becoming the guest sign-in, and a
    // staff member bounced there would have no way through.
    return <Navigate replace state={{ from: location }} to="/staff-login" />
  }

  if (!canAccess(user.role, location.pathname)) {
    // A session with no role fails this check on every path, /dashboard
    // included — sending them there would re-enter this same branch forever.
    // There is no page for them: the API will refuse every call.
    return <Navigate replace to={user.role ? '/dashboard' : '/staff-login'} />
  }

  return <Outlet />
}
