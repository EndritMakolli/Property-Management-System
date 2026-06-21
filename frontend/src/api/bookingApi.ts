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

export async function fetchBookingProperties() {
  const data = await apiGet<{ properties: PublicProperty[] }>('/api/booking/properties/')
  return data.properties
}

export async function fetchBookingAvailability(checkIn: string, checkOut: string, guests: number) {
  const params = new URLSearchParams({ check_in: checkIn, check_out: checkOut, guests: String(guests) })
  return apiGet<AvailabilityResponse>(`/api/booking/availability/?${params.toString()}`)
}
