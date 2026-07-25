import { ArrowLeft, Check, Eye, FileText, Pencil, Plus, Printer, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchCompanyProfile } from '../api/company'
import { fetchGuests } from '../api/guests'
import {
  deleteInvoice,
  fetchInvoices,
  importInvoices,
  updateInvoice,
  type InvoiceApiRecord,
  type InvoicePayload,
} from '../api/invoices'
import { InvoiceEditor } from '../features/invoices/InvoiceEditor'
import { InvoicePreview } from '../features/invoices/InvoicePreview'
import { fmtCurrency, fmtDate, loadLS, SK } from '../features/invoices/invoiceModel'
import { buildPrintHTML } from '../features/invoices/invoicePrint'
import { stayPeriods } from '../features/payments/paymentPeriods'
import type { ReservationRecord } from '../types/domain'
import '../styles/invoice.css'
import '../styles/invoices-page.css'

type PageView = 'list' | 'preview'

const MIGRATED_FLAG = 'pms.inv2.migrated'

// Draft a new invoice from a reservation ("Invoice" buttons around the app).
function reservationPrefill(r: ReservationRecord): InvoicePayload {
  const isMonthly = r.reservationType === 'monthly' && Number(r.monthlyPrice) > 0
  const quantity = isMonthly ? stayPeriods(r).length : r.totalNights
  const unitPrice = isMonthly ? String(r.monthlyPrice) : r.nightlyPrice
  const unitLabel = isMonthly ? 'months' : 'nights'
  return {
    clientName: r.guestName,
    clientPhone: r.guestPhone,
    clientEmail: r.guestEmail ?? '',
    guestId: r.guestId || '',
    reservationId: r.id,
    // Reservation totals are what the guest actually pays — prices include
    // VAT, so the 18% share is shown without changing the total.
    pricesIncludeVat: true,
    lineItems: [
      {
        description: `Accommodation — ${r.apartment}, ${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)} (${quantity} ${unitLabel})`,
        quantity: String(quantity || 1),
        unitPrice,
      },
    ],
  }
}

export function InvoicesPage() {
  const location = useLocation()
  const navigate = useNavigate()

  const [invoices, setInvoices] = useState<InvoiceApiRecord[]>([])
  const [clientsCount, setClientsCount] = useState(0)
  const [defaultTaxRate, setDefaultTaxRate] = useState('18.00')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  const [view, setView] = useState<PageView>('list')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<InvoiceApiRecord | null>(null)
  const [prefill, setPrefill] = useState<InvoicePayload | null>(null)
  const [previewInv, setPreviewInv] = useState<InvoiceApiRecord | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')

  const [localInvoices, setLocalInvoices] = useState<unknown[]>([])
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState('')

  async function loadData() {
    try {
      const [invoiceRows, guestRows, company] = await Promise.all([
        fetchInvoices(),
        fetchGuests().catch(() => []),
        fetchCompanyProfile().catch(() => null),
      ])
      setInvoices(invoiceRows)
      setClientsCount(guestRows.length)
      if (company?.defaultTaxRate) setDefaultTaxRate(company.defaultTaxRate)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    loadData()
    // Offer a one-time import of invoices the old tool kept in this browser.
    if (!window.localStorage.getItem(MIGRATED_FLAG)) {
      const stored = loadLS<unknown[]>(SK.invoices, [])
      if (Array.isArray(stored) && stored.length > 0) setLocalInvoices(stored)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Invoice" buttons navigate here with the reservation in router state.
  useEffect(() => {
    const reservation = (location.state as { reservation?: ReservationRecord } | null)?.reservation
    if (reservation) {
      setPrefill(reservationPrefill(reservation))
      setEditing(null)
      setEditorOpen(true)
      // Clear the state so refresh/back doesn't re-open the editor.
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const yearOptions = useMemo(() => {
    const years = new Set<string>()
    for (const invoice of invoices) years.add(invoice.issueDate.slice(0, 4))
    return [...years].sort().reverse()
  }, [invoices])

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return invoices.filter((invoice) => {
      if (statusFilter && invoice.status !== statusFilter) return false
      if (yearFilter && invoice.issueDate.slice(0, 4) !== yearFilter) return false
      if (query && !invoice.number.toLowerCase().includes(query) && !invoice.clientName.toLowerCase().includes(query))
        return false
      return true
    })
  }, [invoices, searchQuery, statusFilter, yearFilter])

  const counts = useMemo(
    () => ({
      draft: invoices.filter((invoice) => invoice.status === 'draft').length,
      finalized: invoices.filter((invoice) => invoice.status === 'finalized').length,
      archived: invoices.filter((invoice) => invoice.status === 'archived').length,
    }),
    [invoices],
  )

  function handleSaved(saved: InvoiceApiRecord) {
    setInvoices((current) => {
      const exists = current.some((invoice) => invoice.id === saved.id)
      return exists ? current.map((invoice) => (invoice.id === saved.id ? saved : invoice)) : [saved, ...current]
    })
    setPreviewInv(saved)
    setPrefill(null)
    setEditing(null)
    setEditorOpen(false)
    setView('preview')
  }

  async function handleDelete(invoice: InvoiceApiRecord) {
    if (!window.confirm(`Delete invoice ${invoice.number}? This cannot be undone.`)) return
    setError('')
    try {
      await deleteInvoice(invoice.id)
      setInvoices((current) => current.filter((row) => row.id !== invoice.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the invoice.')
    }
  }

  async function togglePaid(invoice: InvoiceApiRecord) {
    setError('')
    try {
      const saved = await updateInvoice(invoice.id, {
        paid: !invoice.paid,
        status: !invoice.paid && invoice.status === 'draft' ? 'finalized' : invoice.status,
      })
      setInvoices((current) => current.map((row) => (row.id === saved.id ? saved : row)))
      setPreviewInv((current) => (current?.id === saved.id ? saved : current))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the invoice.')
    }
  }

  function printInvoice(invoice: InvoiceApiRecord) {
    const win = window.open('', '_blank')
    if (!win) {
      window.alert('Allow popups for this site to print invoices.')
      return
    }
    win.document.write(buildPrintHTML(invoice))
    win.document.close()
    win.addEventListener('load', () => win.print())
  }

  async function runImport() {
    setImporting(true)
    setError('')
    try {
      const result = await importInvoices(localInvoices)
      window.localStorage.setItem(MIGRATED_FLAG, '1')
      setLocalInvoices([])
      setImportNote(
        `Imported ${result.imported} invoice${result.imported !== 1 ? 's' : ''}` +
          (result.skipped ? ` (${result.skipped} skipped)` : '') +
          ' from this browser.',
      )
      await loadData()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="inv-page">
      <div className="inv-header">
        <div className="inv-title">
          <FileText size={22} />
          <h1>Invoices</h1>
        </div>
        {view === 'list' ? (
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null)
              setPrefill(null)
              setEditorOpen(true)
            }}
          >
            <Plus size={16} /> New Invoice
          </button>
        ) : (
          <button
            className="inv-back-btn"
            type="button"
            onClick={() => {
              setView('list')
            }}
          >
            <ArrowLeft size={15} /> Back to list
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {importNote && <p className="admin-panel-message">{importNote}</p>}

      {view === 'list' && (
        <>
          {localInvoices.length > 0 && (
            <div className="inv-import-banner">
              <span>
                Found <strong>{localInvoices.length}</strong> invoice{localInvoices.length !== 1 ? 's' : ''} saved only
                in this browser by the old invoice tool.
              </span>
              <button className="pill-button primary" disabled={importing} type="button" onClick={runImport}>
                <Upload size={14} /> {importing ? 'Importing…' : 'Import to server'}
              </button>
              <button
                className="pill-button"
                type="button"
                onClick={() => {
                  window.localStorage.setItem(MIGRATED_FLAG, '1')
                  setLocalInvoices([])
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="inv-stat-row">
            <div className="inv-stat">
              <span>Draft</span>
              <strong>{counts.draft}</strong>
              <small>waiting to be finalized</small>
            </div>
            <div className="inv-stat">
              <span>Finalized</span>
              <strong>{counts.finalized}</strong>
              <small>issued invoices</small>
            </div>
            <div className="inv-stat">
              <span>Archived</span>
              <strong>{counts.archived}</strong>
              <small>out of circulation</small>
            </div>
            <div className="inv-stat">
              <span>Clients</span>
              <strong>{clientsCount}</strong>
              <small>in your directory</small>
            </div>
          </div>

          <div className="inv-filters">
            <input
              placeholder="Search number or client…"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="finalized">Finalized</option>
              <option value="archived">Archived</option>
            </select>
            <select aria-label="Year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="">All years</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <section className="panel inv-list-panel">
            {status === 'loading' && <div className="inv-empty"><p>Loading invoices…</p></div>}
            {status === 'error' && <div className="inv-empty"><p>Could not load invoices.</p></div>}
            {status === 'ready' && filtered.length === 0 && (
              <div className="inv-empty">
                <FileText size={30} />
                <p>No invoices {invoices.length > 0 ? 'match these filters' : 'yet — create your first one'}.</p>
              </div>
            )}
            {status === 'ready' && filtered.length > 0 && (
              <div className="table-scroll-x">
                <table className="inv-list-table">
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Client</th>
                      <th>Status</th>
                      <th>Amount</th>
                      <th>Issued</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((invoice) => (
                      <tr className="inv-list-row" key={invoice.id}>
                        <td className="inv-num-cell">{invoice.number}</td>
                        <td>{invoice.clientName || '—'}</td>
                        <td>
                          <span className={`inv-status-badge inv-status-${invoice.status}`}>{invoice.status}</span>{' '}
                          <span className={`inv-status-badge inv-status-${invoice.paid ? 'paid' : 'unpaid'}`}>
                            {invoice.paid ? 'paid' : 'unpaid'}
                          </span>
                        </td>
                        <td className="inv-amount-cell">{fmtCurrency(Number(invoice.total), invoice.currency)}</td>
                        <td>{fmtDate(invoice.issueDate)}</td>
                        <td>
                          <div className="inv-list-actions">
                            <button
                              className="inv-icon-btn"
                              title="View"
                              type="button"
                              onClick={() => {
                                setPreviewInv(invoice)
                                setView('preview')
                              }}
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              className="inv-icon-btn"
                              title="Edit"
                              type="button"
                              onClick={() => {
                                setEditing(invoice)
                                setPrefill(null)
                                setEditorOpen(true)
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="inv-icon-btn inv-paid-btn"
                              title={invoice.paid ? 'Mark unpaid' : 'Mark paid'}
                              type="button"
                              onClick={() => togglePaid(invoice)}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              className="inv-icon-btn"
                              title="Print"
                              type="button"
                              onClick={() => printInvoice(invoice)}
                            >
                              <Printer size={14} />
                            </button>
                            <button
                              className="inv-icon-btn inv-delete-btn"
                              title="Delete"
                              type="button"
                              onClick={() => handleDelete(invoice)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {view === 'preview' && previewInv && (
        <InvoicePreview
          inv={previewInv}
          onBack={() => setView('list')}
          onEdit={() => {
            setEditing(previewInv)
            setPrefill(null)
            setEditorOpen(true)
          }}
          onPrint={() => printInvoice(previewInv)}
          onTogglePaid={() => togglePaid(previewInv)}
        />
      )}

      {editorOpen && (
        <InvoiceEditor
          key={editing?.id ?? 'new'}
          defaultTaxRate={defaultTaxRate}
          invoice={editing}
          prefill={prefill}
          onCancel={() => {
            setEditorOpen(false)
            setPrefill(null)
            setEditing(null)
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
