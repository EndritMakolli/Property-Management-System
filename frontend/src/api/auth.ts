import type { AuthUser, ManagedUser, UserRole } from '../types/domain'
import { apiGet, apiSend } from './client'

export type UserAccountPayload = {
  username: string
  password?: string
  role: Exclude<UserRole, ''>
  isActive: boolean
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AuthUser).username === 'string' &&
    typeof (value as AuthUser).role === 'string' &&
    typeof (value as AuthUser).isAuthenticated === 'boolean'
  )
}

function authUserFromResponse(data: { user?: unknown }) {
  if (!isAuthUser(data.user)) {
    throw new Error('The login response was invalid. Check VITE_API_BASE_URL and the backend auth endpoint.')
  }
  return data.user
}

export async function fetchCurrentUser() {
  const data = await apiGet<{ user?: unknown }>('/api/auth/me/')
  return authUserFromResponse(data)
}

export async function loginUser(payload: { username: string; password: string }) {
  const data = await apiSend<{ user?: unknown }>('/api/auth/login/', 'POST', payload)
  return authUserFromResponse(data)
}

export async function logoutUser() {
  const data = await apiSend<{ user?: unknown }>('/api/auth/logout/', 'POST')
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
