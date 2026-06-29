import type {
  PropertyListing,
  PropertyPhotoRecord,
  PropertyReviewRecord,
} from '../types/domain'
import { activePlatform, apiDelete, apiForm, apiGet, apiSend } from './client'

export type PropertyPayload = {
  name: string
  bedrooms: number
  basePriceEur: string
  address: string
  floor?: string
  wifiName?: string
  wifiPassword?: string
  photo: File | null
  description?: string
  listingActive?: boolean
  maxGuests?: number
  beds?: number
  bathrooms?: number
  locationLabel?: string
  rating?: string
  reviewCount?: number
}

export type PropertyEditPayload = Omit<PropertyPayload, 'photo'> & {
  photo?: File | null
}

export type PropertySyncPayload = {
  airbnbIcalUrl: string
  bookingIcalUrl: string
  autoSyncEnabled?: boolean
  syncIntervalHours?: number
}

function appendPropertyFields(formData: FormData, payload: PropertyPayload | PropertyEditPayload) {
  formData.append('name', payload.name)
  formData.append('bedrooms', String(payload.bedrooms))
  formData.append('basePriceEur', payload.basePriceEur)
  formData.append('address', payload.address)
  formData.append('floor', payload.floor || '')
  formData.append('wifiName', payload.wifiName || '')
  formData.append('wifiPassword', payload.wifiPassword || '')
  formData.append('description', payload.description || '')
  formData.append('listingActive', payload.listingActive !== false ? 'true' : 'false')
  if (payload.maxGuests !== undefined) formData.append('maxGuests', String(payload.maxGuests))
  if (payload.beds !== undefined) formData.append('beds', String(payload.beds))
  if (payload.bathrooms !== undefined) formData.append('bathrooms', String(payload.bathrooms))
  if (payload.locationLabel !== undefined) formData.append('locationLabel', payload.locationLabel)
  if (payload.rating !== undefined) formData.append('rating', payload.rating)
  if (payload.reviewCount !== undefined) formData.append('reviewCount', String(payload.reviewCount))
}

export async function fetchProperties(includeInactive = false) {
  const params = new URLSearchParams({ platform: activePlatform() })
  if (includeInactive) params.set('includeInactive', '1')
  const data = await apiGet<{ properties: PropertyListing[] }>(`/api/properties/?${params.toString()}`)
  return data.properties
}

export async function createProperty(payload: PropertyPayload) {
  const formData = new FormData()
  appendPropertyFields(formData, payload)
  formData.append('platform', activePlatform())
  if (payload.photo) {
    formData.append('photo', payload.photo)
  }

  const data = await apiForm<{ property: PropertyListing }>('/api/properties/', 'POST', formData)
  return data.property
}

export async function updateProperty(id: string, payload: PropertyEditPayload) {
  if (payload.photo) {
    const formData = new FormData()
    appendPropertyFields(formData, payload)
    formData.append('photo', payload.photo)
    const data = await apiForm<{ property: PropertyListing }>(`/api/properties/${id}/`, 'PATCH', formData)
    return data.property
  }

  const data = await apiSend<{ property: PropertyListing }>(`/api/properties/${id}/`, 'PATCH', {
    name: payload.name,
    bedrooms: payload.bedrooms,
    basePriceEur: payload.basePriceEur,
    address: payload.address,
    floor: payload.floor || '',
    wifiName: payload.wifiName || '',
    wifiPassword: payload.wifiPassword || '',
    description: payload.description || '',
    listingActive: payload.listingActive !== false,
    ...(payload.maxGuests !== undefined ? { maxGuests: payload.maxGuests } : {}),
    ...(payload.beds !== undefined ? { beds: payload.beds } : {}),
    ...(payload.bathrooms !== undefined ? { bathrooms: payload.bathrooms } : {}),
    ...(payload.locationLabel !== undefined ? { locationLabel: payload.locationLabel } : {}),
    ...(payload.rating !== undefined ? { rating: payload.rating } : {}),
    ...(payload.reviewCount !== undefined ? { reviewCount: payload.reviewCount } : {}),
  })
  return data.property
}

export async function deleteProperty(id: string) {
  await apiDelete(`/api/properties/${id}/`, 'Could not delete property.')
}

export async function updatePropertySync(id: string, payload: PropertySyncPayload) {
  const data = await apiSend<{ property: PropertyListing }>(`/api/properties/${id}/`, 'PATCH', payload)
  return data.property
}

export async function syncPropertyCalendar(id: string, channel: 'airbnb' | 'booking') {
  return apiSend<{
    sync: {
      imported: number
      updated: number
      skipped: number
      conflicts: number
      cancelled: number
      errors: string[]
    }
  }>(`/api/properties/${id}/sync/`, 'POST', { channel })
}

// ── Photos ────────────────────────────────────────────────────────────────────

export async function fetchPropertyPhotos(propertyId: string) {
  const data = await apiGet<{ photos: PropertyPhotoRecord[] }>(`/api/properties/${propertyId}/photos/`)
  return data.photos
}

export async function uploadPropertyPhoto(propertyId: string, file: File, sortOrder?: number) {
  const formData = new FormData()
  formData.append('photo', file)
  if (sortOrder !== undefined) formData.append('sortOrder', String(sortOrder))
  const data = await apiForm<{ photo: PropertyPhotoRecord }>(`/api/properties/${propertyId}/photos/`, 'POST', formData)
  return data.photo
}

export async function deletePropertyPhoto(propertyId: string, photoId: string) {
  await apiDelete(`/api/properties/${propertyId}/photos/${photoId}/`, 'Could not delete photo.')
}

export async function reorderPropertyPhotos(propertyId: string, photos: { id: string; sortOrder: number }[]) {
  const data = await apiSend<{ photos: PropertyPhotoRecord[] }>(
    `/api/properties/${propertyId}/photos/reorder/`,
    'PATCH',
    { photos },
  )
  return data.photos
}

// ── Amenity assignment & reviews ──────────────────────────────────────────────

export async function updatePropertyAmenities(propertyId: string, amenityIds: string[]) {
  const data = await apiSend<{ amenityIds: string[] }>(
    `/api/properties/${propertyId}/amenities/`,
    'PATCH',
    { amenityIds },
  )
  return data.amenityIds
}

export async function fetchPropertyReviews(propertyId: string) {
  const data = await apiGet<{ reviews: PropertyReviewRecord[] }>(`/api/properties/${propertyId}/reviews/`)
  return data.reviews
}

export async function createPropertyReview(
  propertyId: string,
  payload: { guestName: string; rating: number; comment: string; stayLabel: string },
) {
  const data = await apiSend<{ review: PropertyReviewRecord }>(
    `/api/properties/${propertyId}/reviews/`,
    'POST',
    payload,
  )
  return data.review
}

export async function deletePropertyReview(propertyId: string, reviewId: string) {
  await apiDelete(`/api/properties/${propertyId}/reviews/${reviewId}/`, 'Could not delete review.')
}
