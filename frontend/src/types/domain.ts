// The built-in codes the app reasons about by name. An admin can add more, so
// any other string is valid too — `(string & {})` keeps autocomplete for these
// while still accepting a type someone created in the Admin Panel.
export type ReservationPlatform =
  | 'private'
  | 'airbnb'
  | 'booking'
  | 'monthly'
  | 'maintenance'
  | 'direct'
  | (string & {})

/** A row of the reservation-type table: what a type is called and its colour. */
export type ReservationTypeRecord = {
  id: string
  code: string
  label: string
  color: string
  sortOrder: number
  isBuiltin: boolean
  active: boolean
}

export type PropertyListing = {
  id: string
  name: string
  bedrooms: number
  beds: number
  bathrooms: number
  locationLabel: string
  latitude?: string
  longitude?: string
  rating: string
  reviewCount: number
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
  hiddenFromManagement?: boolean
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
  guestEmail?: string
  guestId?: string
  /** Whether this guest has stayed before — Guest.is_returning, from the server. */
  guestIsReturning?: boolean
  paymentDue: string
  paid: boolean
  paidMonths?: string[]
  notes: string
  reservationType: ReservationPlatform
  propertyId: string
  apartment: string
  apartmentType: string
  checkIn: string
  checkOut: string
  totalNights: number
  nightlyPrice: string
  monthlyPrice?: string
  totalPaid: string
  isArchived: boolean
  archivedAt: string
  createdAt?: string
}

export type GuestRecord = {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  phone: string
  whatsappNumber: string
  nationality: string
  notes: string
  isReturning: boolean
  totalStays: number
  totalNights: number
  totalPaidEur: string
  createdAt: string
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
  /** Display label, which an admin can rename. */
  platform: string
  /** The stored code — what the colour class is built from. */
  platformCode: string
  detail: string
  amount?: number
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
  // Legacy whole-expense flag; the UI now uses the month-specific value below.
  paid: boolean
  // Whether this expense is paid for the month the caller requested.
  // Null when the row was fetched without a month context.
  paidForMonth: boolean | null
  vendor: string
  invoiceDate: string
  invoiceFileUrl: string
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

// ── Expense analytics (per-month series + top lists) ──────────────────────────

export type ExpenseAnalyticsMonth = {
  year: number
  month: number
  totalEur: string
  paidEur: string
  unpaidEur: string
  taxesEur: string
  byCategory: Record<string, string>
}

export type ExpenseAnalyticsEntry = {
  id: string
  name: string
  vendor: string
  frequency: 'one_time' | 'repeated'
  categoryId: string
  categoryName: string
  categoryColor: string
  amountEur: string
  totalEur: string
  monthsActive: number
}

export type ExpenseAnalytics = {
  months: ExpenseAnalyticsMonth[]
  topExpenses: ExpenseAnalyticsEntry[]
  topRecurring: ExpenseAnalyticsEntry[]
  topCategories: { id: string; name: string; color: string; totalEur: string }[]
  categories: ExpenseCategoryRecord[]
  start: string
  end: string
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
  /** Local calendar day of the clean, from the server. Compare dates with
   *  this, never `cleanedAt.slice(0,10)` — that is the UTC day and differs
   *  from the local one between local midnight and the UTC offset. */
  cleanedDate: string
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

export type SyncConflictRecord = {
  id: string
  propertyId: string
  propertyName: string
  channel: string
  externalUid: string
  checkIn: string
  checkOut: string
  summary: string
  createdAt: string
  existingReservation: {
    id: string
    guestName: string
    guestPhone: string
    apartment: string
    checkIn: string
    checkOut: string
    reservationType: string
    totalPaid: string
  } | null
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

// Confirmed DIRECT reservation as listed on the Booking Requests page. This is
// a Reservation, not a BookingRequest — it has payment info instead of a status.
export type ConfirmedBookingRecord = {
  id: string
  property: { id: string; name: string; photoUrl: string }
  guestName: string
  guestEmail: string
  guestPhone: string
  checkIn: string
  checkOut: string
  nights: number
  guestsCount: number
  totalPriceEur: string
  paid: boolean
  onlinePaymentStatus: 'none' | 'first_night' | 'full'
  createdAt: string
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

export type PricingGroupRecord = {
  id: string
  platform: 'airstay' | 'fleet'
  name: string
  sortOrder: number
  behaviour: 'stack' | 'exclusive' | 'best' | 'specific'
  ruleCount: number
}

export type PricingRuleRecord = {
  id: string
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
  usageCount: number
  minSubtotalEur: string | null
  createdAt: string
}

export type StayConstraintRecord = {
  id: string
  platform: 'airstay' | 'fleet'
  kind: 'min_nights' | 'max_advance'
  value: number | null
  scope: 'all' | 'property' | 'bedroom_group'
  propertyId: string | null
  bedroomGroup: number | null
  startDate: string | null
  endDate: string | null
  enabled: boolean
  createdAt: string
}

// The engine's verdict on one rule for one stay. `reason` is written in plain
// English by the engine itself (_pricing_engine.py `_report`) and is meant to
// be shown to staff verbatim.
export type RuleReport = {
  id: string
  name: string
  type: string
  group: string
  application: string
  status: 'applied' | 'not_eligible' | 'overridden' | 'locked_out' | 'skipped_invalid'
  reason: string
  amount: string
}

// Matches `_serialize_quote` in `backend/pms/views/_pricing_rules_api.py`.
// A successful staff-mode breakdown. Staff-only: `rules` includes rules that
// did NOT apply, and `nightlyBreakdown` carries the lock/rule-id detail that
// calculate_price(public=True) strips.
export type PricingQuote = {
  baseNightly: string
  effectiveNightly: string
  hasSeasonal: boolean
  subtotal: string
  longStayPct: string
  longStayAmount: string
  lastMinutePct: string
  lastMinuteAmount: string
  nonRefundablePct: string
  nonRefundableAmount: string
  promoAmount: string
  total: string
  firstNightPrice: string
  averageNightlyRate: string
  protectedTotal: string
  nights: number
  minNightsRequired: number
  errors: string[]
  nightlyBreakdown: { date: string; rate: string; locked: boolean; ruleIds: string[] }[]
  rules: RuleReport[]
}

// A quote for a given property is either a full breakdown, or — if pricing
// that property raised — the error fallback `{ error, total }` with none of
// the other fields, since `property_quotes` never lets one failure take the
// whole response down.
export type QuoteRecord =
  | PricingQuote
  | {
      error: string
      total: string
    }

// Response of POST /api/pricing/preview/ — one stay, priced and explained.
export type PricingPreview = {
  preview: PricingQuote
  promoError: string
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
  mapRadiusM: number
}

export type PropertyPhotoRecord = {
  id: string
  url: string
  sortOrder: number
}

export type PropertyReviewRecord = {
  id: string
  guestName: string
  rating: number
  comment: string
  stayLabel: string
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
  /** Address that receives this account's login codes. */
  twoFactorEmail: string
  twoFactorEnabled: boolean
  /** Enabled AND an address is set — i.e. actually enforced at sign-in. */
  twoFactorActive: boolean
}


/* ── Guest account portal ──────────────────────────────────────────────────
   A guest is not a staff user and this shape is deliberately different from
   AuthUser: no `role`, so the two can never be passed to the same code by
   accident. Guests pay at the property, so nothing here describes a payment. */

export type GuestAccountUser = {
  isAuthenticated: boolean
  email: string
}

export type GuestBookingStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'expired'
  | 'cancelled'

export type GuestBooking = {
  id: string
  status: GuestBookingStatus
  checkIn: string
  checkOut: string
  nights: number
  guestsCount: number
  totalPriceEur: string
  /** Only ever set when the status is `declined`. */
  declineReason: string
  canCancel: boolean
  property: {
    name: string
    bedrooms: number
    photoUrl: string
    /** Empty until the booking is confirmed. Never a coordinate, ever. */
    address: string
    floor: string
  }
}

export type GuestStats = {
  stays: number
  nights: number
  totalSpentEur: string
  /** ISO date of the most recent finished stay, or "" for a new guest. */
  lastVisit: string
}
