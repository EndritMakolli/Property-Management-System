// PMS-side management of the public booking engine
// (requests, pricing rules, promo codes, policies, amenities, house rules, settings).

import type {
  AmenityRecord,
  BookingRequestRecord,
  BookingSiteSettingsRecord,
  CancellationPolicyRecord,
  ConfirmedBookingRecord,
  HouseRuleRecord,
  PricingGroupRecord,
  PricingPreview,
  PricingRuleRecord,
  QuoteRecord,
  StayConstraintRecord,
} from '../types/domain'
import { activePlatform, apiDelete, apiGet, apiSend } from './client'

export type PricingGroupPayload = {
  name: string
  sortOrder: number
  behaviour: 'stack' | 'exclusive' | 'best' | 'specific'
}

export type PricingRulePayload = {
  name: string
  groupId: string
  ruleType:
    | 'base_price'
    | 'block_discounts'
    | 'date_adjust'
    | 'long_stay'
    | 'seasonal'
    | 'last_minute'
    | 'non_refundable'
    | 'promo'
    | 'manual'
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  enabled: boolean
  sortOrder: number
  application: 'per_night' | 'whole_stay'
  isFinal: boolean
  stacks: boolean
  blocksGroupId: string | null
  blocksRuleId: string | null
  minNights: number | null
  daysBeforeCheckin: number | null
  startDate: string | null
  endDate: string | null
  adjustmentType: '' | 'fixed_price' | 'pct_increase' | 'pct_decrease' | 'fixed_increase' | 'fixed_decrease'
  adjustmentValue: string | null
  code: string | null
  usageLimit: number | null
  minSubtotalEur: string | null
}

export type StayConstraintPayload = {
  kind: 'min_nights' | 'max_advance'
  value: number | null
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  startDate: string | null
  endDate: string | null
  enabled: boolean
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
    confirmedBookings: ConfirmedBookingRecord[]
    totalConfirmed: number
  }>(`/api/booking-requests/?${params}`)
}

export async function approveBookingRequest(id: string) {
  return apiSend<{ request: BookingRequestRecord; warning?: string }>(`/api/booking-requests/${id}/approve/`, 'POST')
}

export async function rejectBookingRequest(id: string, rejectionMessage: string) {
  return apiSend<{ request: BookingRequestRecord }>(`/api/booking-requests/${id}/reject/`, 'POST', {
    rejectionMessage,
  })
}

// ── Pricing groups ─────────────────────────────────────────────────────────────

// AirStay and Fleet keep separate rule sets, so every read and every create
// carries the platform the page is showing. Without it the pricing page would
// edit apartment rules while displaying vehicles.
export async function fetchPricingGroups() {
  const data = await apiGet<{ pricingGroups: PricingGroupRecord[] }>(
    `/api/pricing-groups/?platform=${activePlatform()}`,
  )
  return data.pricingGroups
}

export async function updatePricingGroup(id: string, payload: Partial<PricingGroupPayload>) {
  const data = await apiSend<{ pricingGroup: PricingGroupRecord }>(`/api/pricing-groups/${id}/`, 'PATCH', payload)
  return data.pricingGroup
}

export async function deletePricingGroup(id: string) {
  await apiDelete(`/api/pricing-groups/${id}/`, 'Could not delete pricing group.')
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

export async function reorderPricingRules(groupId: string, order: string[]) {
  const data = await apiSend<{ pricingRules: PricingRuleRecord[] }>('/api/pricing-rules/reorder/', 'PATCH', {
    groupId,
    order,
  })
  return data.pricingRules
}

// ── Stay constraints ───────────────────────────────────────────────────────────

export async function fetchStayConstraints() {
  const data = await apiGet<{ stayConstraints: StayConstraintRecord[] }>(
    `/api/stay-constraints/?platform=${activePlatform()}`,
  )
  return data.stayConstraints
}

export async function createStayConstraint(payload: StayConstraintPayload) {
  const data = await apiSend<{ stayConstraint: StayConstraintRecord }>(
    `/api/stay-constraints/?platform=${activePlatform()}`, 'POST', payload,
  )
  return data.stayConstraint
}

export async function updateStayConstraint(id: string, payload: Partial<StayConstraintPayload>) {
  const data = await apiSend<{ stayConstraint: StayConstraintRecord }>(
    `/api/stay-constraints/${id}/`,
    'PATCH',
    payload,
  )
  return data.stayConstraint
}

export async function deleteStayConstraint(id: string) {
  await apiDelete(`/api/stay-constraints/${id}/`, 'Could not delete stay constraint.')
}

// ── Quotes ──────────────────────────────────────────────────────────────────────

export async function fetchQuotes(checkIn: string, checkOut: string, propertyIds?: string[]) {
  const data = await apiSend<{ quotes: Record<string, QuoteRecord> }>('/api/properties/quotes/', 'POST', {
    checkIn,
    checkOut,
    ...(propertyIds ? { propertyIds } : {}),
  })
  return data.quotes
}

// ── Pricing preview ─────────────────────────────────────────────────────────────

export type PricingPreviewRequest = {
  propertyId: string
  checkIn: string
  checkOut: string
  promoCode?: string
}

/** Price one stay against the live rules and get the engine's verdict on each
 *  one. Staff-only: the response names rules that did NOT apply and says why. */
export async function fetchPricingPreview(request: PricingPreviewRequest) {
  return apiSend<PricingPreview>('/api/pricing/preview/', 'POST', request)
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
  const data = await apiGet<{ bookingSettings: BookingSiteSettingsRecord }>('/api/booking-settings/')
  return data.bookingSettings
}

export async function updatePmsBookingSettings(payload: Partial<BookingSiteSettingsRecord>) {
  const data = await apiSend<{ bookingSettings: BookingSiteSettingsRecord }>('/api/booking-settings/', 'PATCH', payload)
  return data.bookingSettings
}
