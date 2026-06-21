import { Check, FileText, Printer, Trash2 } from 'lucide-react'
import { calcSubtotal, fmtCurrency, fmtDate, type InvoiceRecord } from './invoiceModel'

type InvoiceListTableProps = {
  invoices: InvoiceRecord[]
  onPreview: (invoice: InvoiceRecord) => void
  onMarkPaid: (id: string) => void
  onDelete: (id: string) => void
}

export function InvoiceListTable({ invoices, onPreview, onMarkPaid, onDelete }: InvoiceListTableProps) {
  if (invoices.length === 0) {
    return (
      <div className="panel inv-list-panel">
        <div className="inv-empty">
          <FileText size={36} />
          <p>No invoices yet — click <strong>New Invoice</strong> to create one.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel inv-list-panel">
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
          {invoices.map(inv => {
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
                  <button className="inv-icon-btn" title="View / Print" onClick={() => onPreview(inv)}>
                    <Printer size={15} />
                  </button>
                  {inv.status === 'draft' && (
                    <button className="inv-icon-btn inv-paid-btn" title="Mark as paid" onClick={() => onMarkPaid(inv.id)}>
                      <Check size={15} />
                    </button>
                  )}
                  <button className="inv-icon-btn inv-delete-btn" title="Delete" onClick={() => onDelete(inv.id)}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
