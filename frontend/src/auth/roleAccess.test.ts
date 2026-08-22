import { describe, expect, it } from 'vitest'
import { canAccess, defaultPathForRole } from './roleAccess'

// `user_role()` on the server now returns "" for an account with no group,
// rather than quietly treating it as cleaning staff. That value reaches here,
// so both helpers have to have an answer for it — and the answer must not be a
// path that sends the user straight back through the same check.
describe('canAccess', () => {
  it('refuses a role-less session everywhere', () => {
    for (const path of ['/dashboard', '/codes', '/finance', '/security']) {
      expect(canAccess('', path)).toBe(false)
    }
  })

  it('lets a cleaner reach their own pages', () => {
    expect(canAccess('cleaning', '/dashboard')).toBe(true)
    expect(canAccess('cleaning', '/codes')).toBe(true)
  })

  it('keeps a cleaner out of the rest', () => {
    expect(canAccess('cleaning', '/finance')).toBe(false)
    expect(canAccess('cleaning', '/admin-panel')).toBe(false)
  })

  it('lets an admin everywhere it is listed', () => {
    expect(canAccess('admin', '/admin-panel')).toBe(true)
  })
})

describe('defaultPathForRole', () => {
  it('sends the three real roles to the dashboard', () => {
    for (const role of ['admin', 'management', 'cleaning'] as const) {
      expect(defaultPathForRole(role)).toBe('/dashboard')
    }
  })

  it('sends a role-less session to the staff sign-in, not the guest one', () => {
    expect(defaultPathForRole('')).toBe('/staff-login')
  })
})
