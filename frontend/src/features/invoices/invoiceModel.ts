/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface CompanyProfile {
  name: string; address: string; city: string; country: string
  taxId: string; vatId: string; email: string; phone: string; website: string
  bankName: string; iban: string; swift: string
  bankName2: string; iban2: string; swift2: string
}

export interface SavedClient {
  id: string; name: string; address: string; city: string; country: string
  taxId: string; vatId: string; email: string; phone: string
}

export interface LineItem {
  id: string; description: string; quantity: string; unitPrice: string
}

export interface InvoiceRecord {
  id: string; invoiceNumber: string; issueDate: string; dueDate: string; currency: string
  company: CompanyProfile; client: Omit<SavedClient, 'id'>
  lineItems: LineItem[]; taxRate: string; notes: string
  status: 'draft' | 'paid'; createdAt: string
}

export interface InvoiceFormState {
  invoiceNumber: string; issueDate: string; dueDate: string; currency: string
  client: Omit<SavedClient, 'id'>; lineItems: LineItem[]; taxRate: string; notes: string
}

/* ── Storage ────────────────────────────────────────────────────────────────── */

export const SK = {
  company: 'pms.inv2.company',
  clients: 'pms.inv2.clients',
  invoices: 'pms.inv2.list',
  counter: 'pms.inv2.counter',
}

export function loadLS<T>(key: string, fb: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fb }
  catch { return fb }
}
export function saveLS(key: string, val: unknown) { localStorage.setItem(key, JSON.stringify(val)) }

/* ── Constants & factories ──────────────────────────────────────────────────── */

export const BLANK_COMPANY: CompanyProfile = {
  name: '', address: '', city: '', country: '', taxId: '', vatId: '',
  email: '', phone: '', website: '',
  bankName: '', iban: '', swift: '',
  bankName2: '', iban2: '', swift2: '',
}

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'ALL', 'RSD', 'BAM', 'HRK', 'MKD']

export const COMPANY_FIELDS: [keyof CompanyProfile, string, boolean][] = [
  ['name', 'Company Name', false],
  ['address', 'Address', true],
  ['city', 'City', false],
  ['country', 'Country', false],
  ['taxId', 'Tax ID / Business ID', false],
  ['vatId', 'VAT Number', false],
  ['email', 'Email', false],
  ['phone', 'Phone', false],
  ['website', 'Website', false],
]

export const CLIENT_FIELDS: [keyof Omit<SavedClient, 'id'>, string, boolean][] = [
  ['address', 'Address', true],
  ['city', 'City', false],
  ['country', 'Country', false],
  ['taxId', 'Tax ID', false],
  ['vatId', 'VAT Number', false],
  ['email', 'Email', false],
  ['phone', 'Phone', false],
]

export function blankClient(): Omit<SavedClient, 'id'> {
  return { name: '', address: '', city: '', country: '', taxId: '', vatId: '', email: '', phone: '' }
}

export function newLine(): LineItem {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, description: '', quantity: '1', unitPrice: '0' }
}

export function makeInvoiceNumber(counter: number): string {
  return `${String(counter).padStart(2, '0')}-${new Date().getFullYear()}`
}

export function buildDefaultForm(counter: number, today: string): InvoiceFormState {
  return {
    invoiceNumber: makeInvoiceNumber(counter),
    issueDate: today,
    dueDate: isoPlus(today, 30),
    currency: 'EUR',
    client: blankClient(),
    lineItems: [newLine()],
    taxRate: '0',
    notes: '',
  }
}

/* ── Calculation & formatting helpers ───────────────────────────────────────── */

export function calcSubtotal(lines: LineItem[]): number {
  return lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)
}

export function fmtCurrency(amount: number, currency: string): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount) }
  catch { return `${currency} ${amount.toFixed(2)}` }
}

export function fmtDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d} ${months[m - 1]} ${y}`
}

export function isoPlus(base: string, days: number): string {
  const d = new Date(base); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
