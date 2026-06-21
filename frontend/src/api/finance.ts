import type {
  ExpenseCategoryRecord,
  FinanceExpenseRecord,
  FinanceSummary,
  FinancialObligationRecord,
  LoanRecord,
  MonthlyTaxRecord,
} from '../types/domain'
import { apiDelete, apiFetch, apiGet, apiSend, readJson } from './client'

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
