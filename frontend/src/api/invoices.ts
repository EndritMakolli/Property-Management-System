import { apiDelete, apiGet, apiSend } from './client'
import type { CompanyProfileRecord } from './company'

export type InvoiceLineItem = {
  description: string
  quantity: string
  unitPrice: string
}

export type InvoiceStatus = 'draft' | 'finalized' | 'archived'

export type InvoiceApiRecord = {
  id: string
  number: string
  issueDate: string
  dueDate: string
  status: InvoiceStatus
  paid: boolean
  clientName: string
  clientAddress: string
  clientCity: string
  clientCountry: string
  /** Who is billed. An individual has no VAT or tax number; that is normal. */
  clientType: 'business' | 'individual'
  clientIdNumber: string
  clientRegistrationNo: string
  clientTaxId: string
  clientVatId: string
  clientEmail: string
  clientPhone: string
  guestId: string
  reservationId: string
  lineItems: InvoiceLineItem[]
  taxRate: string
  pricesIncludeVat: boolean
  currency: string
  notes: string
  companySnapshot: Partial<CompanyProfileRecord>
  createdBy: string
  subtotal: string
  taxAmount: string
  total: string
  createdAt: string
  updatedAt: string
}

export type InvoicePayload = Partial<
  Omit<InvoiceApiRecord, 'id' | 'companySnapshot' | 'subtotal' | 'taxAmount' | 'total' | 'createdAt' | 'updatedAt' | 'createdBy'>
>

export async function fetchInvoices(filters?: { status?: string; year?: string; search?: string }) {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.year) params.set('year', filters.year)
  if (filters?.search) params.set('search', filters.search)
  const query = params.toString()
  const data = await apiGet<{ invoices: InvoiceApiRecord[] }>(`/api/invoices/${query ? `?${query}` : ''}`)
  return data.invoices
}

export async function createInvoice(payload: InvoicePayload) {
  const data = await apiSend<{ invoice: InvoiceApiRecord }>('/api/invoices/', 'POST', payload)
  return data.invoice
}

export async function updateInvoice(id: string, payload: InvoicePayload) {
  const data = await apiSend<{ invoice: InvoiceApiRecord }>(`/api/invoices/${id}/`, 'PATCH', payload)
  return data.invoice
}

export async function deleteInvoice(id: string) {
  await apiDelete(`/api/invoices/${id}/`, 'Could not delete the invoice.')
}

// One-time import of invoices saved by the old localStorage tool.
export async function importInvoices(invoices: unknown[]) {
  return apiSend<{ imported: number; skipped: number; errors: string[] }>(
    '/api/invoices/import/',
    'POST',
    { invoices },
  )
}
