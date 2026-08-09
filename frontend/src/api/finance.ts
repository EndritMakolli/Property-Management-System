import type {
  ExpenseAnalytics,
  ExpenseCategoryRecord,
  FinanceExpenseRecord,
  FinanceSummary,
  FinancialObligationRecord,
  LoanRecord,
  MonthlyTaxRecord,
} from '../types/domain'
import { apiDelete, apiFetch, apiForm, apiGet, apiSend, readJson } from './client'

export type FinanceExpensePayload = {
  name: string
  categoryId: string
  amountEur: string
  frequency: 'one_time' | 'repeated'
  startYear: number
  startMonth: number
  endYear: number | null
  endMonth: number | null
  platform: 'airstay' | 'fleet' | ''
  notes: string
  paid?: boolean
  vendor?: string
  invoiceDate?: string
}

export type ExtractedExpense = {
  vendor: string
  name: string
  amountEur: string
  currency: string
  invoiceDate: string
  categoryId: string
  categoryName: string
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

export type MonthlyTaxPayload = {
  year: number
  month: number
  tvsh: string
  tatimNeFitim: string
  notes: string
}

export async function fetchFinanceSummary(filters: { month: number; year: number }) {
  const params = new URLSearchParams()
  params.set('year', String(filters.year))
  params.set('month', String(filters.month))
  return apiGet<{
    summary: FinanceSummary
    expenses: FinanceExpenseRecord[]
    loans: LoanRecord[]
    obligations: FinancialObligationRecord[]
  }>(`/api/finance/summary/?${params.toString()}`)
}

export async function fetchExpenseCategories() {
  const data = await apiGet<{ categories: ExpenseCategoryRecord[] }>('/api/finance/categories/')
  return data.categories
}

export async function createExpenseCategory(payload: { name: string; color: string }) {
  const data = await apiSend<{ category: ExpenseCategoryRecord }>('/api/finance/categories/', 'POST', payload)
  return data.category
}

export async function updateExpenseCategory(id: string, patch: { color?: string; name?: string }) {
  return apiSend<{ category: ExpenseCategoryRecord }>(`/api/finance/categories/${id}/`, 'PATCH', patch)
}

export async function deleteExpenseCategory(id: string) {
  const response = await apiFetch(`/api/finance/categories/${id}/`, { method: 'DELETE' })
  return readJson<{ deleted: boolean }>(response)
}

export async function fetchAllFinanceExpenses() {
  const data = await apiGet<{ expenses: FinanceExpenseRecord[] }>('/api/finance/expenses/')
  return data.expenses
}

export async function createFinanceExpense(payload: FinanceExpensePayload) {
  const data = await apiSend<{ expense: FinanceExpenseRecord }>('/api/finance/expenses/', 'POST', payload)
  return data.expense
}

export async function updateFinanceExpense(id: string, payload: FinanceExpensePayload) {
  const data = await apiSend<{ expense: FinanceExpenseRecord }>(`/api/finance/expenses/${id}/`, 'PATCH', payload)
  return data.expense
}

export async function deleteFinanceExpense(id: string) {
  await apiDelete(`/api/finance/expenses/${id}/`, 'Could not delete expense.')
}

// Paid status is per month: paying July never marks August as paid.
export async function setExpensePaidForMonth(id: string, year: number, month: number, paid: boolean) {
  const data = await apiSend<{ expense: FinanceExpenseRecord }>(
    `/api/finance/expenses/${id}/payments/`,
    'POST',
    { year, month, paid },
  )
  return data.expense
}

// One row per unpaid expense-month, oldest arrears first.
export type OutstandingExpense = FinanceExpenseRecord & { year: number; month: number }

export async function fetchOutstandingExpenses(months = 24) {
  const data = await apiGet<{ outstanding: OutstandingExpense[]; totalEur: string }>(
    `/api/finance/outstanding/?months=${months}`,
  )
  return data
}

export type ExpenseAnalyticsQuery =
  | { year: number }
  | { start: string; end: string }
  | { all: true }

export async function fetchExpenseAnalytics(query: ExpenseAnalyticsQuery) {
  const params = new URLSearchParams()
  if ('all' in query) params.set('all', '1')
  else if ('year' in query) params.set('year', String(query.year))
  else {
    params.set('start', query.start)
    params.set('end', query.end)
  }
  return apiGet<ExpenseAnalytics>(`/api/finance/analytics/?${params.toString()}`)
}

export async function uploadExpenseInvoice(id: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const data = await apiForm<{ expense: FinanceExpenseRecord }>(
    `/api/finance/expenses/${id}/invoice/`,
    'POST',
    formData,
  )
  return data.expense
}

export async function deleteExpenseInvoice(id: string) {
  const data = await apiFetch(`/api/finance/expenses/${id}/invoice/`, { method: 'DELETE' })
  const body = await readJson<{ expense: FinanceExpenseRecord }>(data)
  return body.expense
}

export async function fetchExtractEnabled() {
  const data = await apiGet<{ enabled: boolean }>('/api/finance/expenses/extract/')
  return data.enabled
}

// Send an invoice image/PDF to Claude; returns prefill values for the form.
export async function extractExpense(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const data = await apiForm<{ extracted: ExtractedExpense }>(
    '/api/finance/expenses/extract/',
    'POST',
    formData,
  )
  return data.extracted
}

export async function createLoan(payload: LoanPayload) {
  const data = await apiSend<{ loan: LoanRecord }>('/api/finance/loans/', 'POST', payload)
  return data.loan
}

export async function deleteLoan(id: string) {
  await apiDelete(`/api/finance/loans/${id}/`, 'Could not delete loan.')
}

export async function createFinancialObligation(payload: FinancialObligationPayload) {
  const data = await apiSend<{ obligation: FinancialObligationRecord }>('/api/finance/obligations/', 'POST', payload)
  return data.obligation
}

export async function updateFinancialObligation(id: string, payload: FinancialObligationPayload) {
  const data = await apiSend<{ obligation: FinancialObligationRecord }>(
    `/api/finance/obligations/${id}/`,
    'PATCH',
    payload,
  )
  return data.obligation
}

export async function deleteFinancialObligation(id: string) {
  await apiDelete(`/api/finance/obligations/${id}/`, 'Could not delete obligation.')
}

// ── Taxes ─────────────────────────────────────────────────────────────────────

export async function fetchTaxes(year?: number) {
  const params = new URLSearchParams()
  if (year) params.set('year', String(year))
  const data = await apiGet<{ taxes: MonthlyTaxRecord[] }>(`/api/finance/taxes/?${params.toString()}`)
  return data.taxes
}

export async function upsertTax(payload: MonthlyTaxPayload) {
  const data = await apiSend<{ tax: MonthlyTaxRecord }>('/api/finance/taxes/', 'POST', payload)
  return data.tax
}

export async function deleteTax(id: string) {
  await apiDelete(`/api/finance/taxes/${id}/`, 'Could not delete tax record.')
}
