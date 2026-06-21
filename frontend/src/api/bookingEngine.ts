// PMS-side management of the public booking engine
// (requests, pricing rules, promo codes, policies, amenities, house rules, settings).

import type {
  AmenityRecord,
  BookingRequestRecord,
  BookingSiteSettingsRecord,
  CancellationPolicyRecord,
  HouseRuleRecord,
  PricingRuleRecord,
  PromoCodeRecord,
} from '../types/domain'
import { apiDelete, apiGet, apiSend } from './client'

export type PricingRulePayload = {
  ruleType: 'long_stay' | 'seasonal' | 'last_minute' | 'minimum_nights'
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  enabled: boolean
  minNights: number | null
  discountPct: string | null
  daysBeforeCheckin: number | null
  startDate: string | null
  endDate: string | null
  adjustmentType: string
  adjustmentValue: string | null
}

export type PromoCodePayload = {
  code: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  usageLimit: number | null
  active: boolean
}

export type CancellationPolicyPayload = {
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  policyType: 'free' | 'partial' | 'non_refundable'
  daysBeforeCheckin: number | null
  refundPct: string | null
  autoProcess: boolean
}

// ── Booking requests ──────────────────────────────────────────────────────────

export async function fetchBookingRequests(offset = 0, limit = 10) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  return apiGet<{
    pendingRequests: BookingRequestRecord[]
    confirmedBookings: BookingRequestRecord[]
    totalConfirmed: number
  }>(`/api/booking-requests/?${params}`)
}

export async function approveBookingRequest(id: string) {
  return apiSend<{ request: BookingRequestRecord }>(`/api/booking-requests/${id}/approve/`, 'POST')
}

export async function rejectBookingRequest(id: string, rejectionMessage: string) {
  return apiSend<{ request: BookingRequestRecord }>(`/api/booking-requests/${id}/reject/`, 'POST', {
    rejectionMessage,
  })
}

// ── Pricing rules ─────────────────────────────────────────────────────────────

export async function fetchPricingRules() {
  const data = await apiGet<{ pricingRules: PricingRuleRecord[] }>('/api/pricing-rules/')
  return data.pricingRules
}

export async function createPricingRule(payload: PricingRulePayload) {
  const data = await apiSend<{ pricingRule: PricingRuleRecord }>('/api/pricing-rules/', 'POST', payload)
  return data.pricingRule
}

export async function updatePricingRule(id: string, payload: Partial<PricingRulePayload>) {
  const data = await apiSend<{ pricingRule: PricingRuleRecord }>(`/api/pricing-rules/${id}/`, 'PATCH', payload)
  return data.pricingRule
}

export async function deletePricingRule(id: string) {
  await apiDelete(`/api/pricing-rules/${id}/`, 'Could not delete pricing rule.')
}

// ── Promo codes ───────────────────────────────────────────────────────────────

export async function fetchPromoCodes() {
  const data = await apiGet<{ promoCodes: PromoCodeRecord[] }>('/api/promo-codes/')
  return data.promoCodes
}

export async function createPromoCode(payload: PromoCodePayload) {
  const data = await apiSend<{ promoCode: PromoCodeRecord }>('/api/promo-codes/', 'POST', payload)
  return data.promoCode
}

export async function updatePromoCode(id: string, payload: Partial<PromoCodePayload>) {
  const data = await apiSend<{ promoCode: PromoCodeRecord }>(`/api/promo-codes/${id}/`, 'PATCH', payload)
  return data.promoCode
}

export async function deletePromoCode(id: string) {
  await apiDelete(`/api/promo-codes/${id}/`, 'Could not delete promo code.')
}

// ── Cancellation policies ─────────────────────────────────────────────────────

export async function fetchCancellationPolicies() {
  const data = await apiGet<{ policies: CancellationPolicyRecord[] }>('/api/cancellation-policies/')
  return data.policies
}

export async function createCancellationPolicy(payload: CancellationPolicyPayload) {
  const data = await apiSend<{ policy: CancellationPolicyRecord }>('/api/cancellation-policies/', 'POST', payload)
  return data.policy
}

export async function updateCancellationPolicy(id: string, payload: Partial<CancellationPolicyPayload>) {
  const data = await apiSend<{ policy: CancellationPolicyRecord }>(
    `/api/cancellation-policies/${id}/`,
    'PATCH',
    payload,
  )
  return data.policy
}

export async function deleteCancellationPolicy(id: string) {
  await apiDelete(`/api/cancellation-policies/${id}/`, 'Could not delete cancellation policy.')
}

// ── Amenities ─────────────────────────────────────────────────────────────────

export async function fetchAmenities() {
  const data = await apiGet<{ amenities: AmenityRecord[] }>('/api/amenities/')
  return data.amenities
}

export async function createAmenity(payload: { name: string; icon: string; sortOrder: number }) {
  const data = await apiSend<{ amenity: AmenityRecord }>('/api/amenities/', 'POST', payload)
  return data.amenity
}

export async function updateAmenity(id: string, payload: { name?: string; icon?: string; sortOrder?: number }) {
  const data = await apiSend<{ amenity: AmenityRecord }>(`/api/amenities/${id}/`, 'PATCH', payload)
  return data.amenity
}

export async function deleteAmenity(id: string) {
  await apiDelete(`/api/amenities/${id}/`, 'Could not delete amenity.')
}

// ── House rules ───────────────────────────────────────────────────────────────

export async function fetchHouseRules() {
  const data = await apiGet<{ houseRules: HouseRuleRecord[] }>('/api/house-rules/')
  return data.houseRules
}

export async function createHouseRule(payload: { text: string; sortOrder: number; active: boolean }) {
  const data = await apiSend<{ houseRule: HouseRuleRecord }>('/api/house-rules/', 'POST', payload)
  return data.houseRule
}

export async function updateHouseRule(id: string, payload: { text?: string; sortOrder?: number; active?: boolean }) {
  const data = await apiSend<{ houseRule: HouseRuleRecord }>(`/api/house-rules/${id}/`, 'PATCH', payload)
  return data.houseRule
}

export async function deleteHouseRule(id: string) {
  await apiDelete(`/api/house-rules/${id}/`, 'Could not delete house rule.')
}

// ── Booking site settings (PMS) ───────────────────────────────────────────────

export async function fetchPmsBookingSettings() {
  const data = await apiGet<{ settings: BookingSiteSettingsRecord }>('/api/booking-settings/')
  return data.settings
}

export async function updatePmsBookingSettings(payload: Partial<BookingSiteSettingsRecord>) {
  const data = await apiSend<{ settings: BookingSiteSettingsRecord }>('/api/booking-settings/', 'PATCH', payload)
  return data.settings
}
