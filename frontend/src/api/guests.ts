import type { GuestRecord } from '../types/domain'
import { apiDelete, apiGet, apiSend } from './client'

export type GuestPayload = {
  fullName?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  whatsappNumber?: string
  nationality?: string
  notes?: string
  isReturning?: boolean
}

export async function fetchGuests(search?: string) {
  const params = new URLSearchParams()
  if (search?.trim()) params.set('search', search.trim())
  const query = params.toString()
  const data = await apiGet<{ guests: GuestRecord[] }>(`/api/guests/${query ? `?${query}` : ''}`)
  return data.guests
}

export async function createGuest(payload: GuestPayload) {
  const data = await apiSend<{ guest: GuestRecord }>('/api/guests/', 'POST', payload)
  return data.guest
}

export async function updateGuest(id: string, payload: GuestPayload) {
  const data = await apiSend<{ guest: GuestRecord }>(`/api/guests/${id}/`, 'PATCH', payload)
  return data.guest
}

export async function deleteGuest(id: string) {
  await apiDelete(`/api/guests/${id}/`, 'Could not delete the client.')
}
