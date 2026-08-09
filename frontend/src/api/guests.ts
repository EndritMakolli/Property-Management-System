import type { GuestRecord } from '../types/domain'
import { apiDelete, apiForm, apiGet, apiSend } from './client'

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

// ── ID documents ──────────────────────────────────────────────────────────────

export type GuestDocType = 'passport' | 'national_id' | 'drivers_license' | 'other'

export type GuestDocumentRecord = {
  id: string
  docType: GuestDocType
  docTypeLabel: string
  url: string
  originalName: string
  uploadedAt: string
}

export async function fetchGuestDocuments(guestId: string) {
  const data = await apiGet<{ documents: GuestDocumentRecord[] }>(`/api/guests/${guestId}/documents/`)
  return data.documents
}

export async function uploadGuestDocument(guestId: string, file: File, docType: GuestDocType) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('docType', docType)
  const data = await apiForm<{ document: GuestDocumentRecord }>(
    `/api/guests/${guestId}/documents/`,
    'POST',
    formData,
  )
  return data.document
}

export async function deleteGuestDocument(guestId: string, documentId: string) {
  await apiDelete(`/api/guests/${guestId}/documents/${documentId}/`, 'Could not delete the document.')
}
