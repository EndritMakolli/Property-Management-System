import type { UserRole } from '../types/domain'

const accessByRole: Record<Exclude<UserRole, ''>, string[]> = {
  admin: [
    '/dashboard',
    '/availability',
    '/reservations',
    '/calendar',
    '/properties',
    '/reports',
    '/codes',
    '/synchronizations',
    '/admin-panel',
    '/clients',
    '/payments',
    '/finance',
    '/invoices',
    '/receipts',
    '/maintenance',
    '/booking-requests',
    '/pricing-rules',
    '/message-templates',
    '/staff-leaves',
    '/settings',
    '/invoice',
    '/security',
  ],
  management: [
    '/dashboard',
    '/availability',
    '/reservations',
    '/calendar',
    '/properties',
    '/codes',
    '/synchronizations',
    '/clients',
    '/payments',
    '/invoices',
    '/maintenance',
    '/booking-requests',
    '/pricing-rules',
    '/message-templates',
    '/staff-leaves',
    '/settings',
    '/invoice',
    '/security',
  ],
  // Cleaning staff appear in the leave register and do not keep it, so it is
  // not on their list. The server enforces this too.
  cleaning: ['/dashboard', '/codes', '/maintenance', '/invoice', '/security'],
}

export function canAccess(role: UserRole, path: string) {
  if (!role) {
    return false
  }
  // A granted page grants what sits underneath it: `/clients` has to admit
  // `/clients/<id>`. Comparing for equality sent every click on a client back
  // to the dashboard.
  //
  // The boundary is the point. A bare `startsWith` would let `/clients` open
  // `/clientsecret` and `/invoice` open `/invoices` — so the match is the page
  // itself, or the page followed by a slash, and nothing else.
  const normalised = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  return accessByRole[role].some(
    (allowed) => normalised === allowed || normalised.startsWith(`${allowed}/`),
  )
}

export function defaultPathForRole(role: UserRole) {
  if (role === 'admin' || role === 'management' || role === 'cleaning') {
    return '/dashboard'
  }
  return '/staff-login'
}
