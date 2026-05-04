export type ReservationPlatform = 'private' | 'airbnb' | 'booking'

export type PropertyListing = {
  id: string
  name: string
  bedrooms: number
  apartmentType: string
  basePriceEur: string
  photoUrl: string
  address: string
  airbnbIcalUrl: string
  bookingIcalUrl: string
  exportIcalUrl: string
  syncStatus: 'connected' | 'partial' | 'not_configured'
  active: boolean
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
}

export type EditableReservation = ReservationRecord & {
  isDirty?: boolean
  isNew?: boolean
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
  oldCode: string
  newCode: string
  dateChanged: string
  notes: string
  lastCheckout: string
  needsChange: boolean
}

export type LockboxCodeRecord = {
  id: string
  apartmentNumber: string
  oldCode: string
  newCode: string
  dateChanged: string
  notes: string
}

export type ExpenseCategoryRecord = {
  id: string
  name: string
}

export type FinanceExpenseRecord = {
  id: string
  name: string
  categoryId: string
  categoryName: string
  amountEur: string
  frequency: 'one_time' | 'repeated'
  startYear: number
  startMonth: number
  endYear: number | null
  endMonth: number | null
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

export type FinanceSummary = {
  turnoverEur: string
  expensesEur: string
  loanPaymentsEur: string
  profitEur: string
  profitAfterLoansEur: string
  totalDebtEur: string
}

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
