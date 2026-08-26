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

// `/clients/:clientId` is the first staff route with a parameter in it, and
// `canAccess` compared paths with `includes`, so `/clients/abc-123` matched
// nothing and RequireAuth bounced every click on a client to the dashboard.
// Matching has to follow the segment boundary — and only the boundary, or
// `/clientsecret` would inherit `/clients`.
describe('canAccess on a nested path', () => {
  it('lets an admin open one client', () => {
    expect(canAccess('admin', '/clients/6b1f0f1e-1111-4000-8000-000000000000')).toBe(true)
  })

  it('lets management open one client', () => {
    expect(canAccess('management', '/clients/6b1f0f1e-1111-4000-8000-000000000000')).toBe(true)
  })

  it('still keeps a cleaner out of one client', () => {
    expect(canAccess('cleaning', '/clients/6b1f0f1e-1111-4000-8000-000000000000')).toBe(false)
  })

  it('still refuses a role-less session', () => {
    expect(canAccess('', '/clients/6b1f0f1e-1111-4000-8000-000000000000')).toBe(false)
  })

  it('does not let a longer word inherit a granted prefix', () => {
    // The whole point of matching on the boundary: /clients must not open
    // /clientsecret, and /invoice must not open /invoices for cleaning.
    expect(canAccess('admin', '/clientsecret')).toBe(false)
    expect(canAccess('cleaning', '/invoices')).toBe(false)
  })

  it('grants the granted page itself, trailing slash or not', () => {
    expect(canAccess('admin', '/clients')).toBe(true)
    expect(canAccess('admin', '/clients/')).toBe(true)
  })

  it('does not grant a page that was never listed, nested or otherwise', () => {
    expect(canAccess('cleaning', '/finance/2026')).toBe(false)
    expect(canAccess('management', '/finance')).toBe(false)
  })
})
