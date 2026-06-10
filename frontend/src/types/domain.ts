export type ReservationPlatform = 'private' | 'airbnb' | 'booking' | 'maintenance' | 'direct'

export type PropertyListing = {
  id: string
  name: string
  bedrooms: number
  floor: string
  wifiName: string
  wifiPassword: string
  apartmentType: string
  basePriceEur: string
  photoUrl: string
  address: string
  airbnbIcalUrl: string
  bookingIcalUrl: string
  exportIcalUrl: string
  syncStatus: 'connected' | 'partial' | 'not_configured'
  active: boolean
  autoSyncEnabled: boolean
  syncIntervalHours: number
  description: string
  listingActive: boolean
  maxGuests: number
  amenityIds: string[]
}

export type ReservationRecord = {
  id: string
  guestName: string
  guestPhone: string
  paymentDue: string
  paid: boolean
  notes: string
  reservationType: ReservationPlatform
  propertyId: string
  apartment: string
  apartmentType: string
  checkIn: string
  checkOut: string
  totalNights: number
  nightlyPrice: string
  totalPaid: string
  isArchived: boolean
  archivedAt: string
}

export type EditableReservation = ReservationRecord & {
  isDirty?: boolean
  isNew?: boolean
}

export type ReservationAttachment = {
  id: string
  url: string
  originalName: string
  uploadedAt: string
}

export type ReservationAuditEntry = {
  id: string
  reservationId: string
  changedBy: string
  changedAt: string
  fieldName: string
  oldValue: string
  newValue: string
}

export type DashboardStay = {
  id: string
  guestName: string
  propertyName: string
  platform: string
  detail: string
}

export type DoorCodeRecord = {
  id: string
  propertyId: string
  apartmentNumber: string
  floor: string
  wifiName: string
  wifiPassword: string
  oldCode: string
  newCode: string
  dateChanged: string
  changedBy: string
  notes: string
  lastCheckout: string
  needsChange: boolean
}

export type LockboxCodeRecord = {
  id: string
  name: string
  apartmentNumber: string
  oldCode: string
  newCode: string
  dateChanged: string
  changedBy: string
  notes: string
}

export type ExpenseCategoryRecord = {
  id: string
  name: string
  color: string
}

export type FinanceExpenseRecord = {
  id: string
  name: string
  categoryId: string
  categoryName: string
  categoryColor: string
  amountEur: string
  frequency: 'one_time' | 'repeated'
  startYear: number
  startMonth: number
  endYear: number | null
  endMonth: number | null
  platform: 'airstay' | 'fleet' | ''
  notes: string
}

export type LoanRecord = {
  id: string
  name: string
  monthlyValueEur: string
  startYear: number
  startMonth: number
  endYear: number
  endMonth: number
  notes: string
}

export type FinancialObligationRecord = {
  id: string
  companyName: string
  description: string
  amountEur: string
  dueDate: string
  paid: boolean
  notes: string
}

export type MonthlyTaxRecord = {
  id: string
  year: number
  month: number
  tvsh: string
  tatimNeFitim: string
  notes: string
}

export type PlatformFinanceSummary = {
  turnoverEur: string
  expensesEur: string
  profitEur: string
}

export type FinanceSummary = {
  airstay: PlatformFinanceSummary
  fleet: PlatformFinanceSummary
  loanPaymentsEur: string
  totalDebtEur: string
}

export type MaintenanceIssueRecord = {
  id: string
  propertyId: string
  propertyName: string
  description: string
  reporterName: string
  reportedAt: string
  photos: { id: string; url: string }[]
}

export type CleanStatusRecord = {
  propertyId: string
  propertyName: string
  isCleaned: boolean
  cleanedAt: string
  cleanedBy: string
}

export type SyncLogRecord = {
  id: string
  propertyId: string
  propertyName: string
  channel: string
  status: string
  importedCount: number
  updatedCount: number
  skippedCount: number
  conflictCount: number
  errorMessage: string
  syncedAt: string
}

// ── Receipts & Deposits ───────────────────────────────────────────────────────

export type DailyDayRecord = {
  date: string
  id: string | null
  receiptTotal: string
  depositAmount: string
  receiptLeft: boolean
  note: string
  itemCount: number
}

export type ReceiptTotals = {
  receiptTotal: string
  depositTotal: string
  leftToDeposit: string
}

export type LinkedReservation = {
  id: string
  guestName: string
  guestPhone: string
  apartment: string
  checkIn: string
  checkOut: string
  totalPaid: string
  alreadyLinked?: boolean
}

export type ReceiptItemRecord = {
  id: string
  value: string
  note: string
  reservations: LinkedReservation[]
}

// ── Booking Engine ────────────────────────────────────────────────────────────

export type BookingRequestRecord = {
  id: string
  token: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  property: { id: string; name: string; photoUrl: string }
  guestName: string
  guestEmail: string
  guestPhone: string
  checkIn: string
  checkOut: string
  nights: number
  guestsCount: number
  totalPriceEur: string
  priceBreakdown: Record<string, unknown> | null
  expiresAt: string
  rejectionMessage: string
  createdAt: string
  promoCode: string | null
}

export type AmenityRecord = {
  id: string
  name: string
  icon: string
  sortOrder: number
}

export type HouseRuleRecord = {
  id: string
  text: string
  sortOrder: number
  active: boolean
}

export type PricingRuleRecord = {
  id: string
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
  createdAt: string
}

export type PromoCodeRecord = {
  id: string
  code: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  usageLimit: number | null
  usageCount: number
  active: boolean
  createdAt: string
}

export type CancellationPolicyRecord = {
  id: string
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  policyType: 'free' | 'partial' | 'non_refundable'
  daysBeforeCheckin: number | null
  refundPct: string | null
  autoProcess: boolean
  createdAt: string
}

export type BookingSiteSettingsRecord = {
  whatsappNumber: string
  buildingAddress: string
  buildingName: string
  sameDayBookingEnabled: boolean
  sameDayBookingCutoffHour: number
  advanceBookingLimitMonths: number
  nonRefundableDiscountPct: string
}

export type PropertyPhotoRecord = {
  id: string
  url: string
  sortOrder: number
}

// ── Users ─────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'management' | 'cleaning' | ''

export type AuthUser = {
  id?: number
  username: string
  role: UserRole
  isAuthenticated: boolean
}

export type ManagedUser = {
  id: number
  username: string
  role: Exclude<UserRole, ''>
  isActive: boolean
  isStaff: boolean
  isSuperuser: boolean
}
