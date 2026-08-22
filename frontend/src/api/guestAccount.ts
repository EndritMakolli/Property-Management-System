// The guest portal API.
//
// Kept out of `api/pmsApi.ts` on purpose: that barrel is the staff surface, and
// these two applications only happen to share a bundle.
//
// Everything goes through apiGet/apiSend, so `credentials: 'include'` and the
// X-CSRFToken header are handled in one place. Only request-link and verify are
// CSRF-exempt server-side; the rest are protected, which apiSend already
// satisfies.

import { apiGet, apiSend, setCsrfToken } from './client'
import type {
  GuestAccountUser,
  GuestBooking,
  GuestStats,
} from '../types/domain'

type AccountResponse = { account: GuestAccountUser; csrfToken?: string }

function cacheToken(data: AccountResponse) {
  // The backend hands the token back in the body because a cross-domain SPA
  // cannot read the cookie. Same contract as the staff auth calls.
  if (typeof data.csrfToken === 'string') {
    setCsrfToken(data.csrfToken)
  }
  return data.account
}

export async function fetchGuestAccount() {
  return cacheToken(await apiGet<AccountResponse>('/api/guest/auth/me/'))
}

/**
 * Ask for a sign-in link.
 *
 * Always resolves when the server answers. The response is identical whether or
 * not the address is known — deliberately, so the endpoint cannot be used to
 * discover who has booked. Do not try to infer anything from it.
 */
export async function requestGuestLink(email: string) {
  await apiSend<{ sent: boolean }>('/api/guest/auth/request-link/', 'POST', { email })
}

export async function verifyGuestToken(token: string) {
  return cacheToken(
    await apiSend<AccountResponse>('/api/guest/auth/verify/', 'POST', { token }),
  )
}

export async function logoutGuestAccount() {
  return cacheToken(await apiSend<AccountResponse>('/api/guest/auth/logout/', 'POST'))
}

export async function fetchGuestBookings() {
  const data = await apiGet<{ bookings: GuestBooking[] }>('/api/guest/bookings/')
  return data.bookings
}

export async function fetchGuestStats() {
  return apiGet<GuestStats>('/api/guest/stats/')
}

export async function cancelGuestBooking(bookingId: string) {
  const data = await apiSend<{ message: string; booking: GuestBooking }>(
    `/api/guest/bookings/${bookingId}/cancel/`,
    'POST',
  )
  return data.booking
}
