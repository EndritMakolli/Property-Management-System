import type { AuthUser, ManagedUser, UserRole } from '../types/domain'
import { apiGet, apiSend, setCsrfToken } from './client'

export type UserAccountPayload = {
  username: string
  password?: string
  role: Exclude<UserRole, ''>
  isActive: boolean
  twoFactorEmail?: string
  twoFactorEnabled?: boolean
}

export type UserSecurity = {
  twoFactorEmail: string
  twoFactorEnabled: boolean
  twoFactorActive: boolean
  emailHint: string
}

// Password alone never creates a session when 2FA is on — the backend replies
// with a challenge that must be exchanged for a session via verifyLoginCode.
export type LoginResult =
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'twoFactorRequired'; challengeToken: string; emailHint: string }

function isAuthUser(value: unknown): value is AuthUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AuthUser).username === 'string' &&
    typeof (value as AuthUser).role === 'string' &&
    typeof (value as AuthUser).isAuthenticated === 'boolean'
  )
}

function authUserFromResponse(data: { user?: unknown; csrfToken?: string }) {
  // Cache the CSRF token from the body so unsafe requests can send it as a
  // header (the cross-domain cookie isn't readable by this page's JS).
  if (typeof data.csrfToken === 'string') {
    setCsrfToken(data.csrfToken)
  }
  if (!isAuthUser(data.user)) {
    throw new Error('The login response was invalid. Check VITE_API_BASE_URL and the backend auth endpoint.')
  }
  return data.user
}

export async function fetchCurrentUser() {
  const data = await apiGet<{ user?: unknown; csrfToken?: string }>('/api/auth/me/')
  return authUserFromResponse(data)
}

export async function loginUser(payload: {
  username: string
  password: string
}): Promise<LoginResult> {
  const data = await apiSend<{
    user?: unknown
    csrfToken?: string
    twoFactorRequired?: boolean
    challengeToken?: string
    emailHint?: string
  }>('/api/auth/login/', 'POST', payload)

  if (data.twoFactorRequired && typeof data.challengeToken === 'string') {
    if (typeof data.csrfToken === 'string') setCsrfToken(data.csrfToken)
    return {
      status: 'twoFactorRequired',
      challengeToken: data.challengeToken,
      emailHint: data.emailHint ?? '',
    }
  }

  return { status: 'authenticated', user: authUserFromResponse(data) }
}

export async function verifyLoginCode(payload: { challengeToken: string; code: string }) {
  const data = await apiSend<{ user?: unknown; csrfToken?: string }>(
    '/api/auth/login/verify/',
    'POST',
    payload,
  )
  return authUserFromResponse(data)
}

export async function resendLoginCode(challengeToken: string) {
  return apiSend<{ sent: boolean; challengeToken?: string }>('/api/auth/login/resend/', 'POST', {
    challengeToken,
  })
}

export async function fetchMySecurity() {
  const data = await apiGet<{ security: UserSecurity }>('/api/auth/security/')
  return data.security
}

// currentPassword is required by the backend when the change weakens the
// account (turning 2FA off, or pointing it at a different inbox).
export async function updateMySecurity(
  payload: Partial<UserSecurity> & { currentPassword?: string },
) {
  const data = await apiSend<{ security: UserSecurity }>('/api/auth/security/', 'PATCH', payload)
  return data.security
}

export async function logoutUser() {
  const data = await apiSend<{ user?: unknown; csrfToken?: string }>('/api/auth/logout/', 'POST')
  return authUserFromResponse(data)
}

export async function fetchUsers() {
  const data = await apiGet<{ users: ManagedUser[] }>('/api/users/')
  return data.users
}

export async function createUserAccount(payload: UserAccountPayload) {
  const data = await apiSend<{ user: ManagedUser }>('/api/users/', 'POST', payload)
  return data.user
}

export async function updateUserAccount(id: number, payload: UserAccountPayload) {
  const data = await apiSend<{ user: ManagedUser }>(`/api/users/${id}/`, 'PATCH', payload)
  return data.user
}
