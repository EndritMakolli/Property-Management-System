import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  Printer,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import '../styles/invoice.css'
import '../styles/invoices-page.css'

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface CompanyProfile {
  name: string; address: string; city: string; country: string
  taxId: string; vatId: string; email: string; phone: string; website: string
  bankName: string; iban: string; swift: string
  bankName2: string; iban2: string; swift2: string
}

interface SavedClient {
  id: string; name: string; address: string; city: string; country: string
  taxId: string; vatId: string; email: string; phone: string
}

interface LineItem {
  id: string; description: string; quantity: string; unitPrice: string
}

interface InvoiceRecord {
  id: string; invoiceNumber: string; issueDate: string; dueDate: string; currency: string
  company: CompanyProfile; client: Omit<SavedClient, 'id'>
  lineItems: LineItem[]; taxRate: string; notes: string
  status: 'draft' | 'paid'; createdAt: string
}

interface FormState {
  invoiceNumber: string; issueDate: string; dueDate: string; currency: string
  client: Omit<SavedClient, 'id'>; lineItems: LineItem[]; taxRate: string; notes: string
}

/* ── Storage ────────────────────────────────────────────────────────────────── */

const SK = {
  company: 'pms.inv2.company',
  clients: 'pms.inv2.clients',
  invoices: 'pms.inv2.list',
  counter: 'pms.inv2.counter',
}

function loadLS<T>(key: string, fb: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fb }
  catch { return fb }
}
function saveLS(key: string, val: unknown) { localStorage.setItem(key, JSON.stringify(val)) }

/* ── Helpers ────────────────────────────────────────────────────────────────── */

const BLANK_COMPANY: CompanyProfile = {
  name: '', address: '', city: '', country: '', taxId: '', vatId: '',
  email: '', phone: '', website: '',
  bankName: '', iban: '', swift: '',
  bankName2: '', iban2: '', swift2: '',
}

function blankClient(): Omit<SavedClient, 'id'> {
  return { name: '', address: '', city: '', country: '', taxId: '', vatId: '', email: '', phone: '' }
}

function newLine(): LineItem {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, description: '', quantity: '1', unitPrice: '0' }
}

function makeInvoiceNumber(counter: number): string {
  return `${String(counter).padStart(2, '0')}-${new Date().getFullYear()}`
}

function calcSubtotal(lines: LineItem[]): number {
  return lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)
}

function fmtCurrency(amount: number, currency: string): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount) }
  catch { return `${currency} ${amount.toFixed(2)}` }
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d} ${months[m - 1]} ${y}`
}

function isoPlus(base: string, days: number): string {
  const d = new Date(base); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function buildDefaultForm(counter: number, today: string): FormState {
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

/* ── Print HTML ─────────────────────────────────────────────────────────────── */

function buildPrintHTML(inv: InvoiceRecord): string {
  const sub = calcSubtotal(inv.lineItems)
  const taxPct = parseFloat(inv.taxRate) || 0
  const tax = sub * (taxPct / 100)
  const total = sub + tax
  const c = inv.company
  const cl = inv.client

  const rows = inv.lineItems.filter(l => l.description.trim()).map(l => {
    const qty = parseFloat(l.quantity) || 0
    const price = parseFloat(l.unitPrice) || 0
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #edf0eb">${l.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #edf0eb;text-align:center">${qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #edf0eb;text-align:right">${fmtCurrency(price, inv.currency)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #edf0eb;text-align:right">${fmtCurrency(qty * price, inv.currency)}</td>
    </tr>`
  }).join('')

  const opt = (val: string, label: string) => val ? `<div style="font-size:0.85rem;color:#4d5a55">${label ? `<strong>${label}:</strong> ` : ''}${val}</div>` : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoiceNumber}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d2522;background:#fff;padding:40px}.doc{max-width:800px;margin:0 auto}h1{font-size:2rem;color:#1f6f5b;letter-spacing:.06em}table{width:100%;border-collapse:collapse;font-size:.88rem}th{background:#1f6f5b;color:#fff;padding:10px 12px;text-align:left;font-size:.78rem}@media print{body{padding:20px}}</style>
</head><body><div class="doc">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
    <div>
      ${c.name ? `<div style="font-size:1.15rem;font-weight:700;margin-bottom:6px">${c.name}</div>` : ''}
      ${opt(c.address,'')}${opt(`${c.city}${c.country?', '+c.country:''}`,'')}
      ${opt(c.taxId,'Tax ID')}${opt(c.vatId,'VAT')}${opt(c.email,'')}${opt(c.phone,'')}
    </div>
    <div style="text-align:right">
      <h1>INVOICE</h1>
      <div style="margin-top:12px;font-size:.88rem;color:#4d5a55">
        <div><strong>#</strong> ${inv.invoiceNumber}</div>
        <div style="margin-top:4px"><strong>Date:</strong> ${fmtDate(inv.issueDate)}</div>
        ${inv.dueDate ? `<div style="margin-top:4px"><strong>Due:</strong> ${fmtDate(inv.dueDate)}</div>` : ''}
      </div>
    </div>
  </div>
  <div style="margin-bottom:28px;padding:16px;background:#f7f9f7;border-radius:8px">
    <div style="font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#68746f;margin-bottom:8px">Bill To</div>
    ${cl.name ? `<div style="font-size:1rem;font-weight:600">${cl.name}</div>` : ''}
    ${opt(cl.address,'')}${opt(`${cl.city}${cl.country?', '+cl.country:''}`,'')}
    ${opt(cl.taxId,'Tax ID')}${opt(cl.vatId,'VAT')}${opt(cl.email,'')}${opt(cl.phone,'')}
  </div>
  <table style="margin-bottom:24px">
    <thead><tr>
      <th>Description</th>
      <th style="text-align:center;width:70px">Qty</th>
      <th style="text-align:right;width:130px">Unit Price</th>
      <th style="text-align:right;width:130px">Total</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#68746f;font-style:italic">No items</td></tr>'}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-bottom:28px">
    <div style="min-width:260px;background:#f7f9f7;border:1px solid #dfe5dd;border-radius:8px;padding:16px 20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem"><span style="color:#4d5a55">Subtotal</span><span>${fmtCurrency(sub, inv.currency)}</span></div>
      ${taxPct > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem"><span style="color:#4d5a55">Tax (${taxPct}%)</span><span>${fmtCurrency(tax, inv.currency)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;border-top:1px solid #dfe5dd;padding-top:10px;margin-top:4px;font-weight:700;font-size:1rem"><span>Total</span><span style="color:#1f6f5b">${fmtCurrency(total, inv.currency)}</span></div>
    </div>
  </div>
  ${(c.iban || c.bankName) ? `<div style="border-top:1px solid #dfe5dd;padding-top:16px;margin-bottom:16px">
    <div style="font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#68746f;margin-bottom:8px">Payment Details</div>
    ${opt(c.bankName,'Bank')}${opt(c.iban,'IBAN')}${opt(c.swift,'SWIFT/BIC')}
    ${(c.iban2||c.bankName2)?`<div style="margin-top:8px">${opt(c.bankName2,'Bank 2')}${opt(c.iban2,'IBAN 2')}${opt(c.swift2,'SWIFT 2')}</div>`:''}
  </div>` : ''}
  ${inv.notes ? `<div style="border-top:1px solid #dfe5dd;padding-top:16px">
    <div style="font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#68746f;margin-bottom:8px">Notes</div>
    <div style="font-size:.85rem;color:#4d5a55;white-space:pre-wrap">${inv.notes}</div>
  </div>` : ''}
</div></body></html>`
}

/* ── Component ──────────────────────────────────────────────────────────────── */

type PageView = 'list' | 'new' | 'preview'

const COMPANY_FIELDS: [keyof CompanyProfile, string, boolean][] = [
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

const CLIENT_FIELDS: [keyof Omit<SavedClient, 'id'>, string, boolean][] = [
  ['address', 'Address', true],
  ['city', 'City', false],
  ['country', 'Country', false],
  ['taxId', 'Tax ID', false],
  ['vatId', 'VAT Number', false],
  ['email', 'Email', false],
  ['phone', 'Phone', false],
]

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'ALL', 'RSD', 'BAM', 'HRK', 'MKD']

export function InvoicesPage() {
  const [company, setCompany] = useState<CompanyProfile>(() => loadLS(SK.company, BLANK_COMPANY))
  const [savedClients, setSavedClients] = useState<SavedClient[]>(() => loadLS(SK.clients, []))
  const [allInvoices, setAllInvoices] = useState<InvoiceRecord[]>(() => loadLS(SK.invoices, []))
  const [counter, setCounter] = useState<number>(() => loadLS(SK.counter, 1))

  const [view, setView] = useState<PageView>('list')
  const [previewInv, setPreviewInv] = useState<InvoiceRecord | null>(null)

  const [companyOpen, setCompanyOpen] = useState(false)
  const [companyDraft, setCompanyDraft] = useState<CompanyProfile>(BLANK_COMPANY)

  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState<FormState>(() => buildDefaultForm(counter, today))
  const [clientQuery, setClientQuery] = useState('')
  const [clientDropOpen, setClientDropOpen] = useState(false)

  const suggestions = useMemo(() => {
    const q = clientQuery.trim().toLowerCase()
    if (!q) return savedClients.slice(0, 6)
    return savedClients.filter(c =>
      c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    ).slice(0, 6)
  }, [clientQuery, savedClients])

  const subtotal = calcSubtotal(form.lineItems)
  const taxPct = parseFloat(form.taxRate) || 0
  const taxAmt = subtotal * (taxPct / 100)
  const total = subtotal + taxAmt

  /* ── Company ───────────────────────────────────────────────── */
  function saveCompanyProfile() {
    setCompany(companyDraft)
    saveLS(SK.company, companyDraft)
    setCompanyOpen(false)
  }

  /* ── Form helpers ──────────────────────────────────────────── */
  function pickClient(c: SavedClient) {
    const { id: _id, ...rest } = c
    setForm(f => ({ ...f, client: rest }))
    setClientQuery(c.name)
    setClientDropOpen(false)
  }

  function updateClientField(field: keyof Omit<SavedClient, 'id'>, val: string) {
    setForm(f => ({ ...f, client: { ...f.client, [field]: val } }))
  }

  function updateLine(id: string, field: keyof Omit<LineItem, 'id'>, val: string) {
    setForm(f => ({ ...f, lineItems: f.lineItems.map(l => l.id === id ? { ...l, [field]: val } : l) }))
  }

  /* ── Generate ──────────────────────────────────────────────── */
  function generateInvoice() {
    const record: InvoiceRecord = {
      id: `inv-${Date.now()}`,
      invoiceNumber: form.invoiceNumber,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      currency: form.currency,
      company: { ...company },
      client: { ...form.client },
      lineItems: form.lineItems.filter(l => l.description.trim()),
      taxRate: form.taxRate,
      notes: form.notes,
      status: 'draft',
      createdAt: new Date().toISOString(),
    }

    const updatedInvoices = [record, ...allInvoices]
    setAllInvoices(updatedInvoices)
    saveLS(SK.invoices, updatedInvoices)

    const next = counter + 1
    setCounter(next)
    saveLS(SK.counter, next)

    if (form.client.name.trim()) {
      const existing = savedClients.find(c => c.name.toLowerCase() === form.client.name.toLowerCase())
      let updatedClients: SavedClient[]
      if (!existing) {
        updatedClients = [{ id: `cli-${Date.now()}`, ...form.client }, ...savedClients]
      } else {
        updatedClients = savedClients.map(c => c.id === existing.id ? { ...c, ...form.client } : c)
      }
      setSavedClients(updatedClients)
      saveLS(SK.clients, updatedClients)
    }

    setPreviewInv(record)
    setView('preview')
  }

  function openNew() {
    const t = new Date().toISOString().slice(0, 10)
    setForm(buildDefaultForm(counter, t))
    setClientQuery('')
    setView('new')
  }

  function deleteInvoice(id: string) {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return
    const updated = allInvoices.filter(i => i.id !== id)
    setAllInvoices(updated)
    saveLS(SK.invoices, updated)
  }

  function markPaid(id: string) {
    const updated = allInvoices.map(i => i.id === id ? { ...i, status: 'paid' as const } : i)
    setAllInvoices(updated)
    saveLS(SK.invoices, updated)
  }

  function printInvoice(inv: InvoiceRecord) {
    const win = window.open('', '_blank')
    if (!win) { window.alert('Allow popups for this site to print invoices.'); return }
    win.document.write(buildPrintHTML(inv))
    win.document.close()
    win.addEventListener('load', () => win.print())
  }

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="inv-page">

      {/* Header */}
      <div className="inv-header">
        <div className="inv-title">
          <FileText size={22} />
          <h1>Invoices</h1>
        </div>
        {view === 'list' ? (
          <button className="btn-primary" onClick={openNew}>
            <Plus size={16} /> New Invoice
          </button>
        ) : (
          <button className="inv-back-btn" type="button" onClick={() => setView('list')}>
            <ArrowLeft size={15} /> Back to list
          </button>
        )}
      </div>

      {/* ── LIST VIEW ─────────────────────────────────────────── */}
      {view === 'list' && (
        <>
          {/* Company panel */}
          <div className="inv-company-panel panel">
            <button
              className="inv-company-toggle"
              type="button"
              onClick={() => { setCompanyDraft({ ...company }); setCompanyOpen(o => !o) }}
            >
              <Building2 size={16} />
              <span>My Company Profile</span>
              {company.name
                ? <span className="inv-company-name-tag">{company.name}</span>
                : <span className="inv-company-hint">Not configured — add your details to appear on invoices</span>}
              {companyOpen ? <ChevronUp size={15} className="inv-company-chevron" /> : <ChevronDown size={15} className="inv-company-chevron" />}
            </button>

            {companyOpen && (
              <div className="inv-company-body">
                <p className="inv-section-label">Company Details</p>
                <div className="inv-grid-4">
                  {COMPANY_FIELDS.map(([field, label, wide]) => (
                    <label key={field} className={wide ? 'inv-span-2' : ''}>
                      {label}
                      <input
                        value={companyDraft[field]}
                        placeholder={label}
                        onChange={e => setCompanyDraft(p => ({ ...p, [field]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>

                <p className="inv-section-label inv-mt">Bank Account 1</p>
                <div className="inv-grid-3">
                  {([ ['bankName','Bank Name'], ['iban','IBAN'], ['swift','SWIFT / BIC'] ] as [keyof CompanyProfile, string][]).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        value={companyDraft[field]}
                        placeholder={label}
                        onChange={e => setCompanyDraft(p => ({ ...p, [field]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>

                <p className="inv-section-label inv-mt">
                  Bank Account 2 <span className="inv-optional">(optional)</span>
                </p>
                <div className="inv-grid-3">
                  {([ ['bankName2','Bank Name'], ['iban2','IBAN'], ['swift2','SWIFT / BIC'] ] as [keyof CompanyProfile, string][]).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        value={companyDraft[field]}
                        placeholder={label}
                        onChange={e => setCompanyDraft(p => ({ ...p, [field]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>

                <div className="inv-company-actions">
                  <button className="btn-ghost" type="button" onClick={() => setCompanyOpen(false)}>Cancel</button>
                  <button className="btn-primary" type="button" onClick={saveCompanyProfile}>
                    <Check size={15} /> Save Profile
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Invoice list */}
          <div className="panel inv-list-panel">
            {allInvoices.length === 0 ? (
              <div className="inv-empty">
                <FileText size={36} />
                <p>No invoices yet — click <strong>New Invoice</strong> to create one.</p>
              </div>
            ) : (
              <table className="inv-list-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Due</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {allInvoices.map(inv => {
                    const sub = calcSubtotal(inv.lineItems)
                    const t = sub + sub * ((parseFloat(inv.taxRate) || 0) / 100)
                    return (
                      <tr key={inv.id} className="inv-list-row">
                        <td className="inv-num-cell">{inv.invoiceNumber}</td>
                        <td>{inv.client.name || '—'}</td>
                        <td>{fmtDate(inv.issueDate)}</td>
                        <td>{fmtDate(inv.dueDate)}</td>
                        <td className="inv-amount-cell">{fmtCurrency(t, inv.currency)}</td>
                        <td>
                          <span className={`inv-status-badge inv-status-${inv.status}`}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="inv-list-actions">
                          <button className="inv-icon-btn" title="View / Print"
                            onClick={() => { setPreviewInv(inv); setView('preview') }}>
                            <Printer size={15} />
                          </button>
                          {inv.status === 'draft' && (
                            <button className="inv-icon-btn inv-paid-btn" title="Mark as paid"
                              onClick={() => markPaid(inv.id)}>
                              <Check size={15} />
                            </button>
                          )}
                          <button className="inv-icon-btn inv-delete-btn" title="Delete"
                            onClick={() => deleteInvoice(inv.id)}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── NEW INVOICE ───────────────────────────────────────── */}
      {view === 'new' && (
        <div className="inv-form-page">

          {/* Invoice meta */}
          <div className="panel inv-form-section">
            <p className="inv-section-label">Invoice Details</p>
            <div className="inv-grid-4">
              <label>
                Invoice Number
                <input value={form.invoiceNumber}
                  onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} />
              </label>
              <label>
                Issue Date
                <input type="date" value={form.issueDate}
                  onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
              </label>
              <label>
                Due Date
                <input type="date" value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </label>
              <label>
                Currency
                <select value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
          </div>

          {/* Client */}
          <div className="panel inv-form-section">
            <p className="inv-section-label"><User size={13} /> Client</p>

            <div className="inv-client-row">
              <label className="inv-client-name-label">
                Client Name
                <div className="inv-autocomplete-wrap">
                  <input
                    value={clientQuery}
                    placeholder="Search saved clients or enter a new name…"
                    onChange={e => {
                      setClientQuery(e.target.value)
                      updateClientField('name', e.target.value)
                      setClientDropOpen(true)
                    }}
                    onFocus={() => setClientDropOpen(true)}
                    onBlur={() => setTimeout(() => setClientDropOpen(false), 150)}
                  />
                  {clientDropOpen && suggestions.length > 0 && (
                    <div className="inv-client-dropdown">
                      {suggestions.map(c => (
                        <button key={c.id} className="inv-client-option" type="button"
                          onMouseDown={() => pickClient(c)}>
                          <strong>{c.name}</strong>
                          {c.email && <span>{c.email}</span>}
                          {(c.city || c.country) && <small>{[c.city, c.country].filter(Boolean).join(', ')}</small>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div className="inv-grid-4">
              {CLIENT_FIELDS.map(([field, label, wide]) => (
                <label key={field} className={wide ? 'inv-span-2' : ''}>
                  {label}
                  <input
                    value={form.client[field]}
                    placeholder={label}
                    onChange={e => updateClientField(field, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div className="panel inv-form-section">
            <div className="inv-section-label-row">
              <p className="inv-section-label" style={{ margin: 0 }}>Line Items</p>
              <button className="inv-add-line-btn" type="button"
                onClick={() => setForm(f => ({ ...f, lineItems: [...f.lineItems, newLine()] }))}>
                <Plus size={14} /> Add row
              </button>
            </div>

            <div className="inv-lines-wrap">
              <div className="inv-lines-header">
                <span>Description</span>
                <span>Qty</span>
                <span>Unit Price</span>
                <span>Total</span>
                <span />
              </div>
              {form.lineItems.map(line => {
                const lineTotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0)
                return (
                  <div key={line.id} className="inv-line-row">
                    <input className="inv-line-desc" placeholder="Description…"
                      value={line.description}
                      onChange={e => updateLine(line.id, 'description', e.target.value)} />
                    <input className="inv-line-num" type="number" min="0" step="0.01"
                      value={line.quantity}
                      onChange={e => updateLine(line.id, 'quantity', e.target.value)} />
                    <input className="inv-line-num" type="number" min="0" step="0.01"
                      value={line.unitPrice}
                      onChange={e => updateLine(line.id, 'unitPrice', e.target.value)} />
                    <span className="inv-line-total">{fmtCurrency(lineTotal, form.currency)}</span>
                    <button className="inv-line-remove" type="button"
                      disabled={form.lineItems.length === 1}
                      onClick={() => setForm(f => ({ ...f, lineItems: f.lineItems.filter(l => l.id !== line.id) }))}>
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Notes + Totals */}
          <div className="inv-form-bottom">
            <div className="panel inv-notes-section">
              <p className="inv-section-label">Notes</p>
              <textarea
                rows={5}
                placeholder="Payment terms, bank details reminder, additional info…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="panel inv-totals-section">
              <div className="inv-totals-row">
                <span>Subtotal</span>
                <span>{fmtCurrency(subtotal, form.currency)}</span>
              </div>
              <div className="inv-totals-row">
                <label className="inv-tax-label">
                  Tax rate
                  <input className="inv-tax-input" type="number" min="0" max="100" step="0.5"
                    value={form.taxRate}
                    onChange={e => setForm(f => ({ ...f, taxRate: e.target.value }))} />
                  %
                </label>
                <span>{fmtCurrency(taxAmt, form.currency)}</span>
              </div>
              <div className="inv-totals-total">
                <span>Total</span>
                <strong>{fmtCurrency(total, form.currency)}</strong>
              </div>
              <button className="btn-primary inv-generate-btn" type="button" onClick={generateInvoice}>
                <FileText size={16} /> Generate Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PREVIEW ───────────────────────────────────────────── */}
      {view === 'preview' && previewInv && (
        <InvoicePreview
          inv={previewInv}
          onPrint={() => printInvoice(previewInv)}
          onBack={() => setView('list')}
          onMarkPaid={() => {
            markPaid(previewInv.id)
            setPreviewInv(prev => prev ? { ...prev, status: 'paid' } : prev)
          }}
        />
      )}
    </div>
  )
}

/* ── Invoice Preview sub-component ──────────────────────────────────────────── */

function InvoicePreview({
  inv, onPrint, onBack, onMarkPaid,
}: {
  inv: InvoiceRecord
  onPrint: () => void
  onBack: () => void
  onMarkPaid: () => void
}) {
  const sub = calcSubtotal(inv.lineItems)
  const taxPct = parseFloat(inv.taxRate) || 0
  const tax = sub * (taxPct / 100)
  const total = sub + tax
  const c = inv.company
  const cl = inv.client

  return (
    <div className="inv-preview-wrap">
      <div className="inv-preview-controls">
        <button className="inv-back-btn" type="button" onClick={onBack}>
          <ArrowLeft size={15} /> Back to list
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          {inv.status === 'draft' && (
            <button className="btn-ghost inv-mark-paid-btn" type="button" onClick={onMarkPaid}>
              <Check size={15} /> Mark as paid
            </button>
          )}
          {inv.status === 'paid' && (
            <span className="inv-status-badge inv-status-paid" style={{ alignSelf: 'center' }}>Paid</span>
          )}
          <button className="btn-primary" type="button" onClick={onPrint}>
            <Printer size={16} /> Print / Save PDF
          </button>
        </div>
      </div>

      <div className="inv-doc panel">
        {/* Header */}
        <div className="inv-doc-header">
          <div className="inv-doc-from">
            {c.name && <strong className="inv-doc-company-name">{c.name}</strong>}
            {c.address && <span>{c.address}</span>}
            {(c.city || c.country) && <span>{[c.city, c.country].filter(Boolean).join(', ')}</span>}
            {c.taxId && <span>Tax ID: {c.taxId}</span>}
            {c.vatId && <span>VAT: {c.vatId}</span>}
            {c.email && <span>{c.email}</span>}
            {c.phone && <span>{c.phone}</span>}
            {c.website && <span>{c.website}</span>}
          </div>
          <div className="inv-doc-title-block">
            <h2 className="inv-doc-title">INVOICE</h2>
            <div className="inv-doc-meta">
              <div><span>Number</span><strong>{inv.invoiceNumber}</strong></div>
              <div><span>Date</span><strong>{fmtDate(inv.issueDate)}</strong></div>
              {inv.dueDate && <div><span>Due</span><strong>{fmtDate(inv.dueDate)}</strong></div>}
              <div><span>Currency</span><strong>{inv.currency}</strong></div>
            </div>
          </div>
        </div>

        {/* Bill To */}
        <div className="inv-doc-bill-to">
          <p className="inv-doc-section-label">Bill To</p>
          {cl.name && <strong>{cl.name}</strong>}
          {cl.address && <span>{cl.address}</span>}
          {(cl.city || cl.country) && <span>{[cl.city, cl.country].filter(Boolean).join(', ')}</span>}
          {cl.taxId && <span>Tax ID: {cl.taxId}</span>}
          {cl.vatId && <span>VAT: {cl.vatId}</span>}
          {cl.email && <span>{cl.email}</span>}
          {cl.phone && <span>{cl.phone}</span>}
        </div>

        {/* Items */}
        <table className="invoice-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ textAlign: 'center', width: 70 }}>Qty</th>
              <th style={{ textAlign: 'right', width: 130 }}>Unit Price</th>
              <th style={{ textAlign: 'right', width: 130 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lineItems.filter(l => l.description.trim()).map(l => {
              const qty = parseFloat(l.quantity) || 0
              const price = parseFloat(l.unitPrice) || 0
              return (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td style={{ textAlign: 'center' }}>{qty}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCurrency(price, inv.currency)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCurrency(qty * price, inv.currency)}</td>
                </tr>
              )
            })}
            {inv.lineItems.filter(l => l.description.trim()).length === 0 && (
              <tr><td colSpan={4} className="invoice-no-data">No items</td></tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="invoice-totals">
          <div className="invoice-totals-grid">
            <span>Subtotal</span><span>{fmtCurrency(sub, inv.currency)}</span>
            {taxPct > 0 && (
              <><span>Tax ({taxPct}%)</span><span>{fmtCurrency(tax, inv.currency)}</span></>
            )}
            <strong>Total</strong><strong>{fmtCurrency(total, inv.currency)}</strong>
          </div>
        </div>

        {/* Payment details */}
        {(c.iban || c.bankName) && (
          <div className="inv-doc-bank">
            <p className="inv-doc-section-label">Payment Details</p>
            {c.bankName && <span><strong>Bank:</strong> {c.bankName}</span>}
            {c.iban && <span><strong>IBAN:</strong> {c.iban}</span>}
            {c.swift && <span><strong>SWIFT/BIC:</strong> {c.swift}</span>}
            {(c.iban2 || c.bankName2) && (
              <div className="inv-doc-bank-2">
                {c.bankName2 && <span><strong>Bank 2:</strong> {c.bankName2}</span>}
                {c.iban2 && <span><strong>IBAN 2:</strong> {c.iban2}</span>}
                {c.swift2 && <span><strong>SWIFT 2:</strong> {c.swift2}</span>}
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {inv.notes && (
          <div className="inv-doc-notes">
            <p className="inv-doc-section-label">Notes</p>
            <p className="inv-doc-notes-text">{inv.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
