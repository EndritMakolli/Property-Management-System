import type { UserRole } from '../types/domain'

const accessByRole: Record<Exclude<UserRole, ''>, string[]> = {
  admin: [
    '/',
    '/availability',
    '/reservations',
    '/calendar',
    '/properties',
    '/reports',
    '/codes',
    '/synchronizations',
    '/admin-panel',
    '/guests',
    '/finance',
    '/settings',
  ],
  management: [
    '/',
    '/availability',
    '/reservations',
    '/calendar',
    '/properties',
    '/codes',
    '/synchronizations',
    '/guests',
    '/settings',
  ],
  cleaning: ['/'],
}

export function canAccess(role: UserRole, path: string) {
  if (!role) {
    return false
  }
  return accessByRole[role].includes(path)
}

export function defaultPathForRole(role: UserRole) {
  if (role === 'admin' || role === 'management' || role === 'cleaning') {
    return '/'
  }
  return '/login'
}
