import type {
  ReservationAttachment,
  ReservationAuditEntry,
  ReservationRecord,
} from '../types/domain'
import { activePlatform, apiDelete, apiForm, apiGet, apiSend } from './client'

export type ReservationPayload = {
  guestName: string
  guestPhone: string
  paymentDue: string
  paid: boolean
  notes: string
  reservationType: string
  propertyId: string
  checkIn: string
  checkOut: string
  nightlyPrice: string
}

export async function fetchReservations(filters?: { month: number; propertyId?: string; year: number; archived?: boolean }) {
  const params = new URLSearchParams()
  params.set('platform', activePlatform())
  if (filters) {
    params.set('year', String(filters.year))
    params.set('month', String(filters.month))
    if (filters.propertyId) {
      params.set('property', filters.propertyId)
    }
    if (filters.archived) {
      params.set('archived', '1')
    }
  }
  const data = await apiGet<{ reservations: ReservationRecord[] }>(`/api/reservations/?${params.toString()}`)
  return data.reservations
}

export async function fetchArchivedReservations(filters?: { month?: number; year?: number }) {
  const params = new URLSearchParams()
  params.set('platform', activePlatform())
  params.set('archived', '1')
  if (filters?.year) params.set('year', String(filters.year))
  if (filters?.month) params.set('month', String(filters.month))
  const data = await apiGet<{ reservations: ReservationRecord[] }>(`/api/reservations/?${params.toString()}`)
  return data.reservations
}

export async function createReservation(payload: ReservationPayload) {
  const data = await apiSend<{ reservation: ReservationRecord }>('/api/reservations/', 'POST', payload)
  return data.reservation
}

export async function updateReservation(id: string, payload: ReservationPayload) {
  const data = await apiSend<{ reservation: ReservationRecord }>(`/api/reservations/${id}/`, 'PATCH', payload)
  return data.reservation
}

export async function deleteReservation(id: string) {
  await apiDelete(`/api/reservations/${id}/`, 'Could not archive reservation.')
}

export async function permanentDeleteReservation(id: string) {
  await apiDelete(`/api/reservations/${id}/`, 'Could not permanently delete reservation.')
}

export async function restoreReservation(id: string) {
  const data = await apiSend<{ reservation: ReservationRecord }>(`/api/reservations/${id}/restore/`, 'POST')
  return data.reservation
}

export async function fetchReservationHistory(id: string) {
  const data = await apiGet<{ history: ReservationAuditEntry[] }>(`/api/reservations/${id}/history/`)
  return data.history
}

export async function fetchReservationAttachments(reservationId: string) {
  const data = await apiGet<{ attachments: ReservationAttachment[] }>(
    `/api/reservations/${reservationId}/attachments/`,
  )
  return data.attachments
}

export async function uploadReservationAttachment(reservationId: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const data = await apiForm<{ attachment: ReservationAttachment }>(
    `/api/reservations/${reservationId}/attachments/`,
    'POST',
    formData,
  )
  return data.attachment
}

export async function deleteReservationAttachment(reservationId: string, attachmentId: string) {
  await apiDelete(
    `/api/reservations/${reservationId}/attachments/${attachmentId}/`,
    'Could not delete attachment.',
  )
}
