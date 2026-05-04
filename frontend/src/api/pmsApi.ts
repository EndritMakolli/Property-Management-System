import type {
  DoorCodeRecord,
  LockboxCodeRecord,
  ExpenseCategoryRecord,
  AuthUser,
  FinanceExpenseRecord,
  FinanceSummary,
  FinancialObligationRecord,
  LoanRecord,
  ManagedUser,
  PropertyListing,
  ReservationRecord,
  UserRole,
} from '../types/domain'

async function readJson<T>(response: Response): Promise<T> {
  const rawBody = await response.text()
  const data = rawBody ? (JSON.parse(rawBody) as T) : ({} as T)

  if (!response.ok) {
    throw new Error(formatApiError((data as { error?: unknown }).error || response.statusText))
  }

  return data
}

export async function fetchCurrentUser() {
  const response = await fetch('/api/auth/me/')
  const data = await readJson<{ user: AuthUser }>(response)
  return data.user
}

export async function loginUser(payload: { username: string; password: string }) {
  const response = await fetch('/api/auth/login/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ user: AuthUser }>(response)
  return data.user
}

export async function logoutUser() {
  const response = await fetch('/api/auth/logout/', { method: 'POST' })
  const data = await readJson<{ user: AuthUser }>(response)
  return data.user
}

export async function fetchUsers() {
  const response = await fetch('/api/users/')
  const data = await readJson<{ users: ManagedUser[] }>(response)
  return data.users
}

export async function createUserAccount(payload: UserAccountPayload) {
  const response = await fetch('/api/users/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ user: ManagedUser }>(response)
  return data.user
}

export async function updateUserAccount(id: number, payload: UserAccountPayload) {
  const response = await fetch(`/api/users/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ user: ManagedUser }>(response)
  return data.user
}

export async function fetchProperties() {
  const response = await fetch('/api/properties/')
  const data = await readJson<{ properties: PropertyListing[] }>(response)
  return data.properties
}

export async function createProperty(payload: PropertyPayload) {
  const formData = new FormData()
  formData.append('name', payload.name)
  formData.append('bedrooms', String(payload.bedrooms))
  formData.append('basePriceEur', payload.basePriceEur)
  formData.append('address', payload.address)
  if (payload.photo) {
    formData.append('photo', payload.photo)
  }

  const response = await fetch('/api/properties/', {
    method: 'POST',
    body: formData,
  })
  const data = await readJson<{ property: PropertyListing }>(response)
  return data.property
}

export async function updateProperty(id: string, payload: PropertyEditPayload) {
  const response = await fetch(`/api/properties/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ property: PropertyListing }>(response)
  return data.property
}

export async function updatePropertySync(id: string, payload: PropertySyncPayload) {
  const response = await fetch(`/api/properties/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ property: PropertyListing }>(response)
  return data.property
}

export async function syncPropertyCalendar(id: string, channel: 'airbnb' | 'booking') {
  const response = await fetch(`/api/properties/${id}/sync/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel }),
  })
  return readJson<{
    sync: {
      imported: number
      updated: number
      skipped: number
      errors: string[]
    }
  }>(response)
}

export async function fetchReservations(filters?: { month: number; propertyId?: string; year: number }) {
  const params = new URLSearchParams()
  if (filters) {
    params.set('year', String(filters.year))
    params.set('month', String(filters.month))
    if (filters.propertyId) {
      params.set('property', filters.propertyId)
    }
  }
  const query = params.size ? `?${params.toString()}` : ''
  const response = await fetch(`/api/reservations/${query}`)
  const data = await readJson<{ reservations: ReservationRecord[] }>(response)
  return data.reservations
}

export async function createReservation(payload: ReservationPayload) {
  const response = await fetch('/api/reservations/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ reservation: ReservationRecord }>(response)
  return data.reservation
}

export async function updateReservation(id: string, payload: ReservationPayload) {
  const response = await fetch(`/api/reservations/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ reservation: ReservationRecord }>(response)
  return data.reservation
}

export async function deleteReservation(id: string) {
  const response = await fetch(`/api/reservations/${id}/`, { method: 'DELETE' })

  if (!response.ok) {
    throw new Error('Could not delete reservation.')
  }
}

export async function fetchDoorCodes() {
  const response = await fetch('/api/codes/door/')
  const data = await readJson<{ doorCodes: DoorCodeRecord[] }>(response)
  return data.doorCodes
}

export async function updateDoorCode(id: string, payload: CodePayload) {
  const response = await fetch(`/api/codes/door/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ doorCode: DoorCodeRecord }>(response)
  return data.doorCode
}

export async function fetchLockboxCodes() {
  const response = await fetch('/api/codes/lockboxes/')
  const data = await readJson<{ lockboxCodes: LockboxCodeRecord[] }>(response)
  return data.lockboxCodes
}

export async function createLockboxCode(payload: CodePayload) {
  const response = await fetch('/api/codes/lockboxes/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ lockboxCode: LockboxCodeRecord }>(response)
  return data.lockboxCode
}

export async function updateLockboxCode(id: string, payload: CodePayload) {
  const response = await fetch(`/api/codes/lockboxes/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ lockboxCode: LockboxCodeRecord }>(response)
  return data.lockboxCode
}

export async function deleteLockboxCode(id: string) {
  const response = await fetch(`/api/codes/lockboxes/${id}/`, { method: 'DELETE' })

  if (!response.ok) {
    throw new Error('Could not delete lockbox code.')
  }
}

export async function fetchFinanceSummary(filters: { month: number; year: number }) {
  const params = new URLSearchParams()
  params.set('year', String(filters.year))
  params.set('month', String(filters.month))
  const response = await fetch(`/api/finance/summary/?${params.toString()}`)
  return readJson<{
    summary: FinanceSummary
    expenses: FinanceExpenseRecord[]
    loans: LoanRecord[]
    obligations: FinancialObligationRecord[]
  }>(response)
}

export async function fetchExpenseCategories() {
  const response = await fetch('/api/finance/categories/')
  const data = await readJson<{ categories: ExpenseCategoryRecord[] }>(response)
  return data.categories
}

export async function createExpenseCategory(payload: { name: string }) {
  const response = await fetch('/api/finance/categories/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ category: ExpenseCategoryRecord }>(response)
  return data.category
}

export async function createFinanceExpense(payload: FinanceExpensePayload) {
  const response = await fetch('/api/finance/expenses/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ expense: FinanceExpenseRecord }>(response)
  return data.expense
}

export async function deleteFinanceExpense(id: string) {
  const response = await fetch(`/api/finance/expenses/${id}/`, { method: 'DELETE' })

  if (!response.ok) {
    throw new Error('Could not delete expense.')
  }
}

export async function createLoan(payload: LoanPayload) {
  const response = await fetch('/api/finance/loans/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ loan: LoanRecord }>(response)
  return data.loan
}

export async function deleteLoan(id: string) {
  const response = await fetch(`/api/finance/loans/${id}/`, { method: 'DELETE' })

  if (!response.ok) {
    throw new Error('Could not delete loan.')
  }
}

export async function createFinancialObligation(payload: FinancialObligationPayload) {
  const response = await fetch('/api/finance/obligations/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ obligation: FinancialObligationRecord }>(response)
  return data.obligation
}

export async function updateFinancialObligation(id: string, payload: FinancialObligationPayload) {
  const response = await fetch(`/api/finance/obligations/${id}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson<{ obligation: FinancialObligationRecord }>(response)
  return data.obligation
}

export async function deleteFinancialObligation(id: string) {
  const response = await fetch(`/api/finance/obligations/${id}/`, { method: 'DELETE' })

  if (!response.ok) {
    throw new Error('Could not delete obligation.')
  }
}

export type ReservationPayload = {
  guestName: string
  guestPhone: string
  paymentDue: string
  paid: boolean
  notes: string
  reservationType: string
  propertyId: string
  checkIn: string
  checkOut: string
  nightlyPrice: string
}

export type PropertyPayload = {
  name: string
  bedrooms: number
  basePriceEur: string
  address: string
  photo: File | null
}

export type PropertyEditPayload = {
  name: string
  bedrooms: number
  basePriceEur: string
  address: string
}

export type UserAccountPayload = {
  username: string
  password?: string
  role: Exclude<UserRole, ''>
  isActive: boolean
}

export type PropertySyncPayload = {
  airbnbIcalUrl: string
  bookingIcalUrl: string
}

export type CodePayload = {
  apartmentNumber?: string
  newCode: string
  notes: string
}

export type FinanceExpensePayload = {
  name: string
  categoryId: string
  amountEur: string
  frequency: 'one_time' | 'repeated'
  startYear: number
  startMonth: number
  endYear: number | null
  endMonth: number | null
  notes: string
}

export type LoanPayload = {
  name: string
  monthlyValueEur: string
  startYear: number
  startMonth: number
  endYear: number
  endMonth: number
  notes: string
}

export type FinancialObligationPayload = {
  companyName: string
  description: string
  amountEur: string
  dueDate: string
  paid: boolean
  notes: string
}

export function formatApiError(error: unknown) {
  if (!error) {
    return 'The request could not be completed.'
  }
  if (typeof error === 'string') {
    return error
  }
  if (Array.isArray(error)) {
    return error.join(' ')
  }
  if (typeof error === 'object') {
    return Object.values(error)
      .flat()
      .join(' ')
  }

  return 'The request could not be completed.'
}
