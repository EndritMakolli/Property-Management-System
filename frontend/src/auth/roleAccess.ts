import type { UserRole } from '../types/domain'

const accessByRole: Record<Exclude<UserRole, ''>, string[]> = {
  admin: [
    '/dashboard',
    '/availability',
    '/search-reservations',
    '/reservations',
    '/archive',
    '/calendar',
    '/properties',
    '/reports',
    '/codes',
    '/synchronizations',
    '/admin-panel',
    '/guests',
    '/finance',
    '/invoices',
    '/receipts',
    '/maintenance',
    '/needs-attention',
    '/booking-requests',
    '/pricing-rules',
    '/booking-settings',
    '/settings',
    '/invoice',
  ],
  management: [
    '/dashboard',
    '/availability',
    '/search-reservations',
    '/reservations',
    '/archive',
    '/calendar',
    '/properties',
    '/codes',
    '/synchronizations',
    '/guests',
    '/invoices',
    '/maintenance',
    '/needs-attention',
    '/booking-requests',
    '/pricing-rules',
    '/booking-settings',
    '/settings',
    '/invoice',
  ],
  cleaning: ['/dashboard', '/codes', '/maintenance', '/invoice'],
}

export function canAccess(role: UserRole, path: string) {
  if (!role) {
    return false
  }
  return accessByRole[role].includes(path)
}

export function defaultPathForRole(role: UserRole) {
  if (role === 'admin' || role === 'management' || role === 'cleaning') {
    return '/dashboard'
  }
  return '/login'
}
