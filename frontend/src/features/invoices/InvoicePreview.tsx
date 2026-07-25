import { ArrowLeft, Check, Pencil, Printer } from 'lucide-react'
import type { InvoiceApiRecord } from '../../api/invoices'
import { fmtCurrency, fmtDate } from './invoiceModel'

type InvoicePreviewProps = {
  inv: InvoiceApiRecord
  onPrint: () => void
  onBack: () => void
  onEdit: () => void
  onTogglePaid: () => void
}

export function InvoicePreview({ inv, onPrint, onBack, onEdit, onTogglePaid }: InvoicePreviewProps) {
  const c = inv.companySnapshot
  const taxPct = parseFloat(inv.taxRate) || 0

  return (
    <div className="inv-preview-wrap">
      <div className="inv-preview-controls">
        <button className="inv-back-btn" type="button" onClick={onBack}>
          <ArrowLeft size={15} /> Back to list
        </button>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span className={`inv-status-badge inv-status-${inv.status}`} style={{ alignSelf: 'center' }}>
            {inv.status}
          </span>
          <button className="btn-ghost inv-mark-paid-btn" type="button" onClick={onTogglePaid}>
            <Check size={15} /> {inv.paid ? 'Mark unpaid' : 'Mark as paid'}
          </button>
          <button className="btn-ghost" type="button" onClick={onEdit}>
            <Pencil size={15} /> Edit
          </button>
          <button className="btn-primary" type="button" onClick={onPrint}>
            <Printer size={16} /> Print / Save PDF
          </button>
        </div>
      </div>

      <div className="inv-doc panel">
        {/* Header */}
        <div className="inv-doc-header">
          <div className="inv-doc-from">
            {c.logoUrl && <img alt="" className="inv-doc-logo" src={c.logoUrl} />}
            {c.name && <strong className="inv-doc-company-name">{c.name}</strong>}
            {c.address && <span>{c.address}</span>}
            {(c.city || c.country) && <span>{[c.city, c.country].filter(Boolean).join(', ')}</span>}
            {c.taxId && <span>Business No. (NUI): {c.taxId}</span>}
            {c.vatId && <span>VAT: {c.vatId}</span>}
            {c.email && <span>{c.email}</span>}
            {c.phone && <span>{c.phone}</span>}
            {c.website && <span>{c.website}</span>}
          </div>
          <div className="inv-doc-title-block">
            <h2 className="inv-doc-title">INVOICE</h2>
            <div className="inv-doc-meta">
              <div><span>Number</span><strong>{inv.number}</strong></div>
              <div><span>Date</span><strong>{fmtDate(inv.issueDate)}</strong></div>
              {inv.dueDate && <div><span>Due</span><strong>{fmtDate(inv.dueDate)}</strong></div>}
              <div><span>Currency</span><strong>{inv.currency}</strong></div>
            </div>
          </div>
        </div>

        {/* Bill To */}
        <div className="inv-doc-bill-to">
          <p className="inv-doc-section-label">Bill To</p>
          {inv.clientName && <strong>{inv.clientName}</strong>}
          {inv.clientAddress && <span>{inv.clientAddress}</span>}
          {(inv.clientCity || inv.clientCountry) && (
            <span>{[inv.clientCity, inv.clientCountry].filter(Boolean).join(', ')}</span>
          )}
          {inv.clientTaxId && <span>Tax ID: {inv.clientTaxId}</span>}
          {inv.clientVatId && <span>VAT: {inv.clientVatId}</span>}
          {inv.clientEmail && <span>{inv.clientEmail}</span>}
          {inv.clientPhone && <span>{inv.clientPhone}</span>}
        </div>

        {/* Items */}
        <div className="table-scroll-x">
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
              {inv.lineItems.map((line, index) => {
                const qty = parseFloat(line.quantity) || 0
                const price = parseFloat(line.unitPrice) || 0
                return (
                  <tr key={index}>
                    <td>{line.description}</td>
                    <td style={{ textAlign: 'center' }}>{qty}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(price, inv.currency)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtCurrency(qty * price, inv.currency)}</td>
                  </tr>
                )
              })}
              {inv.lineItems.length === 0 && (
                <tr><td colSpan={4} className="invoice-no-data">No items</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="invoice-totals">
          <div className="invoice-totals-grid">
            <span>{inv.pricesIncludeVat ? 'Price without VAT' : 'Subtotal'}</span>
            <span>{fmtCurrency(Number(inv.subtotal), inv.currency)}</span>
            {taxPct > 0 && (
              <><span>VAT ({taxPct}%)</span><span>{fmtCurrency(Number(inv.taxAmount), inv.currency)}</span></>
            )}
            <strong>Total{inv.pricesIncludeVat && taxPct > 0 ? ' (incl. VAT)' : ''}</strong>
            <strong>{fmtCurrency(Number(inv.total), inv.currency)}</strong>
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

        <p className="inv-doc-footer">
          {[c.name, c.taxId ? `NUI ${c.taxId}` : '', c.vatId ? `VAT ${c.vatId}` : '']
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  )
}
