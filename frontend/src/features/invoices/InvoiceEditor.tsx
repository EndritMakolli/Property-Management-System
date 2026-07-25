import { Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchGuests } from '../../api/guests'
import {
  createInvoice,
  updateInvoice,
  type InvoiceApiRecord,
  type InvoiceLineItem,
  type InvoicePayload,
  type InvoiceStatus,
} from '../../api/invoices'
import type { GuestRecord } from '../../types/domain'
import { toDateInputValue } from '../../utils/date'
import { CURRENCIES, fmtCurrency, isoPlus } from './invoiceModel'

type InvoiceEditorProps = {
  invoice?: InvoiceApiRecord | null
  prefill?: InvoicePayload | null
  defaultTaxRate: string
  onSaved: (saved: InvoiceApiRecord) => void
  onCancel: () => void
}

type EditorState = {
  number: string
  issueDate: string
  dueDate: string
  currency: string
  taxRate: string
  pricesIncludeVat: boolean
  status: InvoiceStatus
  paid: boolean
  clientName: string
  clientAddress: string
  clientCity: string
  clientCountry: string
  clientTaxId: string
  clientVatId: string
  clientEmail: string
  clientPhone: string
  guestId: string
  reservationId: string
  lineItems: InvoiceLineItem[]
  notes: string
}

function blankLine(): InvoiceLineItem {
  return { description: '', quantity: '1', unitPrice: '0' }
}

// Popup invoice editor (same design as the reservation/client modals).
export function InvoiceEditor({ invoice, prefill, defaultTaxRate, onSaved, onCancel }: InvoiceEditorProps) {
  const today = toDateInputValue(new Date())
  const [form, setForm] = useState<EditorState>(() => ({
    number: invoice?.number ?? '',
    issueDate: invoice?.issueDate || today,
    dueDate: invoice?.dueDate || isoPlus(today, 14),
    currency: invoice?.currency ?? 'EUR',
    taxRate: invoice?.taxRate ?? prefill?.taxRate ?? defaultTaxRate,
    pricesIncludeVat: invoice?.pricesIncludeVat ?? prefill?.pricesIncludeVat ?? true,
    status: invoice?.status ?? 'draft',
    paid: invoice?.paid ?? false,
    clientName: invoice?.clientName ?? prefill?.clientName ?? '',
    clientAddress: invoice?.clientAddress ?? prefill?.clientAddress ?? '',
    clientCity: invoice?.clientCity ?? prefill?.clientCity ?? '',
    clientCountry: invoice?.clientCountry ?? prefill?.clientCountry ?? '',
    clientTaxId: invoice?.clientTaxId ?? '',
    clientVatId: invoice?.clientVatId ?? '',
    clientEmail: invoice?.clientEmail ?? prefill?.clientEmail ?? '',
    clientPhone: invoice?.clientPhone ?? prefill?.clientPhone ?? '',
    guestId: invoice?.guestId ?? prefill?.guestId ?? '',
    reservationId: invoice?.reservationId ?? prefill?.reservationId ?? '',
    lineItems: invoice?.lineItems?.length
      ? invoice.lineItems
      : prefill?.lineItems?.length
        ? prefill.lineItems
        : [blankLine()],
    notes: invoice?.notes ?? prefill?.notes ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── client picker ──
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerResults, setPickerResults] = useState<GuestRecord[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)

  useEffect(() => {
    if (!pickerOpen) return
    let ignore = false
    setPickerLoading(true)
    const timer = window.setTimeout(() => {
      fetchGuests(pickerQuery)
        .then((rows) => {
          if (!ignore) setPickerResults(rows.slice(0, 25))
        })
        .catch(() => {
          if (!ignore) setPickerResults([])
        })
        .finally(() => {
          if (!ignore) setPickerLoading(false)
        })
    }, 250)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [pickerOpen, pickerQuery])

  function update(patch: Partial<EditorState>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  function updateLine(index: number, patch: Partial<InvoiceLineItem>) {
    setForm((current) => ({
      ...current,
      lineItems: current.lineItems.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }))
  }

  function removeLine(index: number) {
    setForm((current) => ({
      ...current,
      lineItems: current.lineItems.filter((_, i) => i !== index),
    }))
  }

  function pickClient(guest: GuestRecord) {
    update({
      clientName: guest.fullName,
      clientPhone: guest.phone,
      clientEmail: guest.email,
      clientCountry: guest.nationality || form.clientCountry,
      guestId: guest.id,
    })
    setPickerOpen(false)
    setPickerQuery('')
  }

  const lineSum = useMemo(
    () =>
      form.lineItems.reduce(
        (sum, line) => sum + (parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0),
        0,
      ),
    [form.lineItems],
  )
  const taxPct = parseFloat(form.taxRate) || 0
  const taxAmount = form.pricesIncludeVat
    ? lineSum - lineSum / (1 + taxPct / 100)
    : lineSum * (taxPct / 100)
  const subtotal = form.pricesIncludeVat ? lineSum - taxAmount : lineSum
  const total = form.pricesIncludeVat ? lineSum : lineSum + taxAmount

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const payload: InvoicePayload = {
      number: form.number.trim(),
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      currency: form.currency,
      taxRate: form.taxRate,
      pricesIncludeVat: form.pricesIncludeVat,
      status: form.status,
      paid: form.paid,
      clientName: form.clientName,
      clientAddress: form.clientAddress,
      clientCity: form.clientCity,
      clientCountry: form.clientCountry,
      clientTaxId: form.clientTaxId,
      clientVatId: form.clientVatId,
      clientEmail: form.clientEmail,
      clientPhone: form.clientPhone,
      guestId: form.guestId,
      reservationId: form.reservationId,
      lineItems: form.lineItems,
      notes: form.notes,
    }
    try {
      const saved = invoice ? await updateInvoice(invoice.id, payload) : await createInvoice(payload)
      onSaved(saved)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the invoice.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal form-modal form-modal--wide" aria-modal="true" role="dialog">
        <div className="form-modal-head">
          <div>
            <h3>{invoice ? `Edit invoice ${invoice.number}` : 'New invoice'}</h3>
            <p>{invoice ? 'Update and reprint this invoice.' : 'Fill it in, save, then print — VAT is worked out for you.'}</p>
          </div>
          <button className="form-modal-close" aria-label="Close" type="button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <form className="form-modal-body" id="invoice-form" onSubmit={save}>
          {error && <p className="form-error">{error}</p>}

          <div className="form-section">
            <p className="form-section-title">Invoice</p>
            <div className="form-grid">
              <label className="form-field">
                Number
                <input
                  placeholder="Auto (INV-2026-001)"
                  type="text"
                  value={form.number}
                  onChange={(e) => update({ number: e.target.value })}
                />
                {!invoice && <span className="form-field-hint">Leave empty to number automatically.</span>}
              </label>
              <label className="form-field">
                Issue date
                <input required type="date" value={form.issueDate} onChange={(e) => update({ issueDate: e.target.value })} />
              </label>
              <label className="form-field">
                Due date
                <input type="date" value={form.dueDate} onChange={(e) => update({ dueDate: e.target.value })} />
              </label>
              <label className="form-field">
                Currency
                <select value={form.currency} onChange={(e) => update({ currency: e.target.value })}>
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                VAT rate (%)
                <input
                  min="0"
                  max="100"
                  step="0.01"
                  type="number"
                  value={form.taxRate}
                  onChange={(e) => update({ taxRate: e.target.value })}
                />
              </label>
              <label className="form-field">
                Status
                <select value={form.status} onChange={(e) => update({ status: e.target.value as InvoiceStatus })}>
                  <option value="draft">Draft</option>
                  <option value="finalized">Finalized</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <label className="form-checkbox-row">
                <input
                  checked={form.pricesIncludeVat}
                  type="checkbox"
                  onChange={(e) => update({ pricesIncludeVat: e.target.checked })}
                />
                Prices include VAT
              </label>
              <label className="form-checkbox-row">
                <input checked={form.paid} type="checkbox" onChange={(e) => update({ paid: e.target.checked })} />
                Paid
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Bill to</p>
            <div className="pill-toggle-group" style={{ marginBottom: 10 }}>
              <button
                className={`pill-button${pickerOpen ? ' accent' : ''}`}
                type="button"
                onClick={() => setPickerOpen((current) => !current)}
              >
                <Search size={14} /> Pick from clients
              </button>
            </div>
            {pickerOpen && (
              <div className="form-inline-panel" style={{ marginBottom: 12 }}>
                <input
                  autoFocus
                  placeholder="Search clients…"
                  type="search"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  style={{ width: '100%', marginBottom: 10 }}
                />
                {pickerLoading ? (
                  <p className="listings-message">Searching…</p>
                ) : pickerResults.length === 0 ? (
                  <p className="listings-message">No matching clients.</p>
                ) : (
                  <ul className="form-inline-list">
                    {pickerResults.map((guest) => (
                      <li key={guest.id}>
                        <span>
                          <strong>{guest.fullName}</strong>
                          {guest.phone ? ` · ${guest.phone}` : ''}
                        </span>
                        <button className="pill-button primary" type="button" onClick={() => pickClient(guest)}>
                          Select
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="form-grid">
              <label className="form-field">
                Name
                <input type="text" value={form.clientName} onChange={(e) => update({ clientName: e.target.value })} />
              </label>
              <label className="form-field">
                Phone
                <input type="tel" value={form.clientPhone} onChange={(e) => update({ clientPhone: e.target.value })} />
              </label>
              <label className="form-field">
                Email
                <input type="email" value={form.clientEmail} onChange={(e) => update({ clientEmail: e.target.value })} />
              </label>
              <label className="form-field">
                Address
                <input type="text" value={form.clientAddress} onChange={(e) => update({ clientAddress: e.target.value })} />
              </label>
              <label className="form-field">
                City
                <input type="text" value={form.clientCity} onChange={(e) => update({ clientCity: e.target.value })} />
              </label>
              <label className="form-field">
                Country
                <input type="text" value={form.clientCountry} onChange={(e) => update({ clientCountry: e.target.value })} />
              </label>
              <label className="form-field">
                Tax ID
                <input type="text" value={form.clientTaxId} onChange={(e) => update({ clientTaxId: e.target.value })} />
              </label>
              <label className="form-field">
                VAT number
                <input type="text" value={form.clientVatId} onChange={(e) => update({ clientVatId: e.target.value })} />
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Line items</p>
            <div className="table-scroll-x">
              <table className="invoice-table inv-editor-lines">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style={{ width: 90 }}>Qty</th>
                    <th style={{ width: 130 }}>Unit price</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Total</th>
                    <th style={{ width: 44 }} aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {form.lineItems.map((line, index) => (
                    <tr key={index}>
                      <td>
                        <input
                          placeholder="Accommodation — Apartment #3, 3 nights"
                          type="text"
                          value={line.description}
                          onChange={(e) => updateLine(index, { description: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          min="0"
                          step="any"
                          type="number"
                          value={line.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          min="0"
                          step="0.01"
                          type="number"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                        />
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {fmtCurrency((parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0), form.currency)}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          disabled={form.lineItems.length === 1}
                          title="Remove line"
                          type="button"
                          onClick={() => removeLine(index)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="pill-button"
              style={{ marginTop: 10 }}
              type="button"
              onClick={() => update({ lineItems: [...form.lineItems, blankLine()] })}
            >
              <Plus size={14} /> Add line
            </button>

            <div className="invoice-totals" style={{ marginTop: 14 }}>
              <div className="invoice-totals-grid">
                <span>{form.pricesIncludeVat ? 'Price without VAT' : 'Subtotal'}</span>
                <span>{fmtCurrency(subtotal, form.currency)}</span>
                {taxPct > 0 && (
                  <>
                    <span>VAT ({taxPct}%)</span>
                    <span>{fmtCurrency(taxAmount, form.currency)}</span>
                  </>
                )}
                <strong>Total</strong>
                <strong>{fmtCurrency(total, form.currency)}</strong>
              </div>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Notes</p>
            <label className="form-field">
              <textarea
                placeholder="Payment terms, thank-you note…"
                value={form.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </label>
          </div>
        </form>

        <div className="form-modal-footer">
          <span className="form-modal-summary">
            Total <strong>{fmtCurrency(total, form.currency)}</strong>
            {taxPct > 0 && form.pricesIncludeVat ? ` (incl. ${taxPct}% VAT)` : ''}
          </span>
          <button className="pill-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="pill-button accent" disabled={saving} form="invoice-form" type="submit">
            {saving ? 'Saving…' : invoice ? 'Save changes' : 'Create invoice'}
          </button>
        </div>
      </section>
    </div>
  )
}
