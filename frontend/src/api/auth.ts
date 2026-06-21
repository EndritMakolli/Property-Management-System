import type { AuthUser, ManagedUser, UserRole } from '../types/domain'
import { apiGet, apiSend } from './client'

export type UserAccountPayload = {
  username: string
  password?: string
  role: Exclude<UserRole, ''>
  isActive: boolean
}

export async function fetchCurrentUser() {
  const data = await apiGet<{ user: AuthUser }>('/api/auth/me/')
  return data.user
}

export async function loginUser(payload: { username: string; password: string }) {
  const data = await apiSend<{ user: AuthUser }>('/api/auth/login/', 'POST', payload)
  return data.user
}

export async function logoutUser() {
  const data = await apiSend<{ user: AuthUser }>('/api/auth/logout/', 'POST')
  return data.user
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
