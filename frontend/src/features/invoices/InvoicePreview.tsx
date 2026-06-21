import { ArrowLeft, Check, Printer } from 'lucide-react'
import { calcSubtotal, fmtCurrency, fmtDate, type InvoiceRecord } from './invoiceModel'

type InvoicePreviewProps = {
  inv: InvoiceRecord
  onPrint: () => void
  onBack: () => void
  onMarkPaid: () => void
}

export function InvoicePreview({ inv, onPrint, onBack, onMarkPaid }: InvoicePreviewProps) {
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
