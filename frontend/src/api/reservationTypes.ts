import { apiDelete, apiGet, apiSend } from './client'
import type { ReservationTypeRecord } from '../types/domain'

export async function fetchReservationTypes() {
  const data = await apiGet<{ reservationTypes: ReservationTypeRecord[] }>(
    '/api/reservation-types/',
  )
  return data.reservationTypes
}

export async function createReservationType(payload: { label: string; color: string }) {
  const data = await apiSend<{ reservationType: ReservationTypeRecord }>(
    '/api/reservation-types/',
    'POST',
    payload,
  )
  return data.reservationType
}

export async function updateReservationType(
  id: string,
  patch: { label?: string; color?: string; sortOrder?: number; active?: boolean },
) {
  const data = await apiSend<{ reservationType: ReservationTypeRecord }>(
    `/api/reservation-types/${id}/`,
    'PATCH',
    patch,
  )
  return data.reservationType
}

export async function deleteReservationType(id: string) {
  // The server refuses a built-in, and refuses one that reservations still use
  // — it says how many. Let that message through rather than replacing it.
  await apiDelete(`/api/reservation-types/${id}/`, 'Could not delete the type.')
}
