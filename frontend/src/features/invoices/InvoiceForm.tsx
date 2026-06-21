import { FileText, Plus, User, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  buildDefaultForm,
  calcSubtotal,
  CLIENT_FIELDS,
  CURRENCIES,
  fmtCurrency,
  newLine,
  type InvoiceFormState,
  type LineItem,
  type SavedClient,
} from './invoiceModel'

type InvoiceFormProps = {
  counter: number
  savedClients: SavedClient[]
  onGenerate: (form: InvoiceFormState) => void
}

export function InvoiceForm({ counter, savedClients, onGenerate }: InvoiceFormProps) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState<InvoiceFormState>(() => buildDefaultForm(counter, today))
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

  function pickClient(c: SavedClient) {
    const { id: _omitId, ...rest } = c
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

  return (
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
          <button className="btn-primary inv-generate-btn" type="button" onClick={() => onGenerate(form)}>
            <FileText size={16} /> Generate Invoice
          </button>
        </div>
      </div>
    </div>
  )
}
