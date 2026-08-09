// Public (no-auth) booking API — the guest-facing data source.

import { apiGet, apiSend } from './client'

export interface PublicPriceBreakdown {
  total: string
  nights: number
  effective_nightly: string
  errors: string[]
  [key: string]: unknown
}

export interface PublicProperty {
  id: string
  name: string
  bedrooms: number
  beds: number
  bathrooms: number
  maxGuests: number
  apartmentType: string
  basePriceEur: string
  description: string
  locationLabel: string
  // Privacy-shifted approximate coordinates — the real location is somewhere
  // inside the mapRadiusM circle around this point.
  latitude: string
  longitude: string
  mapRadiusM: number
  minNights: number
  rating: string
  reviewCount: number
  photos: string[]
  amenityIds: string[]
  priceBreakdown: PublicPriceBreakdown | null
}

export interface PublicAmenity {
  id: string
  name: string
  icon: string
}

export interface PublicReview {
  id: string
  guestName: string
  rating: number
  comment: string
  stayLabel: string
}

export interface PublicPropertyDetail extends PublicProperty {
  amenities: PublicAmenity[]
  reviews: PublicReview[]
}

export interface AvailabilityResponse {
  available: { property: PublicProperty }[]
  combinations: { apartments: { property: PublicProperty }[]; combinedTotal: string; nights: number }[]
  // Free apartments whose minimum-stay rule exceeds the searched nights.
  minStayBlocked: { property: PublicProperty; minNights: number }[]
  checkIn: string
  checkOut: string
  nights: number
  guests: number
}

export interface BlockedRange { checkIn: string; checkOut: string }

export async function fetchBookingPropertyCalendar(id: string) {
  const data = await apiGet<{ blocked: BlockedRange[] }>(`/api/booking/properties/${id}/calendar/`)
  return data.blocked
}

export async function calculateBookingPrice(propertyId: string, checkIn: string, checkOut: string) {
  const data = await apiSend<{ priceBreakdown: PublicPriceBreakdown }>('/api/booking/calculate/', 'POST', {
    propertyId,
    checkIn,
    checkOut,
  })
  return data.priceBreakdown
}

export async function fetchBookingPropertyDetail(id: string) {
  const data = await apiGet<{ property: PublicPropertyDetail }>(`/api/booking/properties/${id}/`)
  return data.property
}

export async function fetchBookingProperties(checkIn?: string, checkOut?: string) {
  // With dates, each property carries a priceBreakdown for that stay so
  // listings show rule-adjusted prices instead of the base rate.
  const params = new URLSearchParams()
  if (checkIn && checkOut) {
    params.set('check_in', checkIn)
    params.set('check_out', checkOut)
  }
  const query = params.toString()
  const data = await apiGet<{ properties: PublicProperty[] }>(
    `/api/booking/properties/${query ? `?${query}` : ''}`,
  )
  return data.properties
}

export async function fetchBookingAvailability(checkIn: string, checkOut: string, guests: number) {
  const params = new URLSearchParams({ check_in: checkIn, check_out: checkOut, guests: String(guests) })
  return apiGet<AvailabilityResponse>(`/api/booking/availability/?${params.toString()}`)
}

export interface BookingRequestInput {
  propertyId: string
  checkIn: string
  checkOut: string
  guestName: string
  guestPhone: string
  guestsCount: number
}

export interface BookingRequestResult {
  token: string
  expiresAt: string
  message: string
}

// Submit a guest booking request (Pay-at-Property path). Email is not collected;
// the backend only requires name + phone.
export async function createBookingRequest(input: BookingRequestInput) {
  return apiSend<BookingRequestResult>('/api/booking/requests/', 'POST', input)
}
