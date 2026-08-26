import type { ClientStayBreakdown, GuestRecord } from '../types/domain'
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

export type GuestQuery = {
  search?: string
  propertyId?: string
  /** Both month and year, or neither - one alone means all time. */
  month?: number
  year?: number
  sort?: string
  archived?: boolean
  limit?: number
  offset?: number
}

/** A page of the directory, plus how many rows the filter matched in total. */
export async function fetchGuestPage(query: GuestQuery = {}) {
  const params = new URLSearchParams()
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.propertyId) params.set('propertyId', query.propertyId)
  if (query.month && query.year) {
    params.set('month', String(query.month))
    params.set('year', String(query.year))
  }
  if (query.sort) params.set('sort', query.sort)
  if (query.archived) params.set('archived', '1')
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset) params.set('offset', String(query.offset))
  const search = params.toString()
  return apiGet<{ guests: GuestRecord[]; total: number }>(
    `/api/guests/${search ? `?${search}` : ''}`,
  )
}

/** The first page only. Kept for callers that just want a few rows. */
export async function fetchGuests(search?: string) {
  const { guests } = await fetchGuestPage({ search })
  return guests
}

export async function fetchGuest(id: string) {
  const data = await apiGet<{ guest: GuestRecord }>(`/api/guests/${id}/`)
  return data.guest
}

export async function fetchClientStays(id: string) {
  return apiGet<ClientStayBreakdown>(`/api/guests/${id}/stays/`)
}

export async function setGuestArchived(id: string, isArchived: boolean) {
  const data = await apiSend<{ guest: GuestRecord }>(`/api/guests/${id}/`, 'PATCH', { isArchived })
  return data.guest
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
