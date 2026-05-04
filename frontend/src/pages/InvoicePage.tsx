import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ReservationRecord } from '../types/domain'
import { formatDisplayDate } from '../utils/date'

const companyStorageKey = 'pms.invoice.company'

type CompanyInfo = {
  name: string
  businessId: string
  address: string
  phone: string
  email: string
}

type ClientInfo = {
  name: string
  businessId: string
  address: string
  phone: string
}

type InvoiceDetails = {
  invoiceNumber: string
  invoiceDate: string
  notes: string
}

const defaultCompany: CompanyInfo = {
  name: '',
  businessId: '',
  address: '',
  phone: '',
  email: '',
}

function loadCompany(): CompanyInfo {
  try {
    const stored = window.localStorage.getItem(companyStorageKey)
    if (stored) return { ...defaultCompany, ...JSON.parse(stored) }
  } catch {
    // ignore
  }
  return { ...defaultCompany }
}

function saveCompany(info: CompanyInfo) {
  window.localStorage.setItem(companyStorageKey, JSON.stringify(info))
}

const VAT_RATE = 0.18

export function InvoicePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const reservation: ReservationRecord | null = (location.state as { reservation?: ReservationRecord })?.reservation ?? null

  const [company, setCompany] = useState<CompanyInfo>(loadCompany)
  const [client, setClient] = useState<ClientInfo>({
    name: reservation?.guestName || '',
    businessId: '',
    address: '',
    phone: reservation?.guestPhone || '',
  })
  const [details, setDetails] = useState<InvoiceDetails>({
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    invoiceDate: new Date().toISOString().slice(0, 10),
    notes: reservation?.notes || '',
  })
  const [totalOverride, setTotalOverride] = useState<string>(
    reservation ? Number(reservation.totalPaid).toFixed(2) : '0.00',
  )
  const [editingCompany, setEditingCompany] = useState(!company.name)

  useEffect(() => {
    if (reservation) {
      setClient((c) => ({
        ...c,
        name: c.name || reservation.guestName || '',
        phone: c.phone || reservation.guestPhone || '',
      }))
      setTotalOverride(Number(reservation.totalPaid).toFixed(2))
    }
  }, [])

  const totalAmount = parseFloat(totalOverride) || 0
  const vatAmount = totalAmount - totalAmount / (1 + VAT_RATE)
  const priceWithoutVat = totalAmount - vatAmount

  function updateCompany(updates: Partial<CompanyInfo>) {
    setCompany((c) => {
      const next = { ...c, ...updates }
      saveCompany(next)
      return next
    })
  }

  function updateClient(updates: Partial<ClientInfo>) {
    setClient((c) => ({ ...c, ...updates }))
  }

  function updateDetails(updates: Partial<InvoiceDetails>) {
    setDetails((d) => ({ ...d, ...updates }))
  }

  return (
    <div className="invoice-page">
      {/* ── Controls (hidden on print) ── */}
      <div className="invoice-controls no-print">
        <button className="icon-button" onClick={() => navigate(-1)} title="Go back">
          <ArrowLeft size={18} />
          Back
        </button>
        {editingCompany ? (
          <button
            className="primary-button"
            onClick={() => {
              saveCompany(company)
              setEditingCompany(false)
            }}
          >
            Save company info
          </button>
        ) : (
          <button onClick={() => setEditingCompany(true)}>Edit company</button>
        )}
        <button className="primary-button" onClick={() => window.print()}>
          <Printer size={16} />
          Print / Save PDF
        </button>
      </div>

      {/* ── Company editor (hidden on print) ── */}
      {editingCompany && (
        <div className="invoice-company-editor no-print panel">
          <h3>Company Information</h3>
          <div className="invoice-editor-grid">
            <label>
              Company name
              <input value={company.name} onChange={(e) => updateCompany({ name: e.target.value })} />
            </label>
            <label>
              Business ID (NUI/NIF)
              <input value={company.businessId} onChange={(e) => updateCompany({ businessId: e.target.value })} />
            </label>
            <label>
              Address
              <input value={company.address} onChange={(e) => updateCompany({ address: e.target.value })} />
            </label>
            <label>
              Phone
              <input value={company.phone} onChange={(e) => updateCompany({ phone: e.target.value })} />
            </label>
            <label>
              Email
              <input value={company.email} onChange={(e) => updateCompany({ email: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {/* ── Invoice document ── */}
      <div className="invoice-document">
        {/* Header */}
        <div className="invoice-doc-header">
          <div className="invoice-from">
            <strong className="invoice-company-name">{company.name || 'Your Company Name'}</strong>
            {company.businessId && <span>ID: {company.businessId}</span>}
            {company.address && <span>{company.address}</span>}
            {company.phone && <span>{company.phone}</span>}
            {company.email && <span>{company.email}</span>}
          </div>
          <div className="invoice-title-block">
            <h1 className="invoice-title">INVOICE</h1>
            <div className="invoice-meta">
              <label>
                Invoice #
                <input
                  className="invoice-field no-print"
                  value={details.invoiceNumber}
                  onChange={(e) => updateDetails({ invoiceNumber: e.target.value })}
                />
                <span className="print-only">{details.invoiceNumber}</span>
              </label>
              <label>
                Date
                <input
                  className="invoice-field no-print"
                  type="date"
                  value={details.invoiceDate}
                  onChange={(e) => updateDetails({ invoiceDate: e.target.value })}
                />
                <span className="print-only">{details.invoiceDate}</span>
              </label>
            </div>
          </div>
        </div>

        {/* Bill to */}
        <div className="invoice-bill-to">
          <p className="invoice-label">BILL TO</p>
          <input
            className="invoice-field no-print"
            placeholder="Client name"
            value={client.name}
            onChange={(e) => updateClient({ name: e.target.value })}
          />
          <span className="print-only">{client.name}</span>
          <input
            className="invoice-field no-print"
            placeholder="Business ID (optional)"
            value={client.businessId}
            onChange={(e) => updateClient({ businessId: e.target.value })}
          />
          {client.businessId && <span className="print-only">ID: {client.businessId}</span>}
          <input
            className="invoice-field no-print"
            placeholder="Address"
            value={client.address}
            onChange={(e) => updateClient({ address: e.target.value })}
          />
          {client.address && <span className="print-only">{client.address}</span>}
          <input
            className="invoice-field no-print"
            placeholder="Phone"
            value={client.phone}
            onChange={(e) => updateClient({ phone: e.target.value })}
          />
          {client.phone && <span className="print-only">{client.phone}</span>}
        </div>

        {/* Line items */}
        <table className="invoice-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Nights</th>
              <th>Rate / night</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {reservation ? (
              <tr>
                <td>
                  Accommodation — {reservation.apartment}
                  {reservation.apartmentType && ` (${reservation.apartmentType})`}
                </td>
                <td>{formatDisplayDate(reservation.checkIn)}</td>
                <td>{formatDisplayDate(reservation.checkOut)}</td>
                <td>{reservation.totalNights}</td>
                <td>EUR {Number(reservation.nightlyPrice).toFixed(2)}</td>
                <td>
                  <input
                    className="invoice-field amount-field no-print"
                    type="number"
                    min="0"
                    step="0.01"
                    value={totalOverride}
                    onChange={(e) => setTotalOverride(e.target.value)}
                  />
                  <span className="print-only">EUR {totalAmount.toFixed(2)}</span>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={6} className="invoice-no-data">
                  No reservation data. Navigate here from the Reservations page.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="invoice-totals">
          <div className="invoice-totals-grid">
            <span>Price without VAT:</span>
            <span>EUR {priceWithoutVat.toFixed(2)}</span>
            <span>VAT (18%):</span>
            <span>EUR {vatAmount.toFixed(2)}</span>
            <strong>Total:</strong>
            <strong>EUR {totalAmount.toFixed(2)}</strong>
          </div>
        </div>

        {/* Notes */}
        <div className="invoice-notes">
          <p className="invoice-label">NOTES</p>
          <textarea
            className="invoice-field no-print"
            placeholder="Payment instructions, thank-you message, etc."
            value={details.notes}
            rows={3}
            onChange={(e) => updateDetails({ notes: e.target.value })}
          />
          {details.notes && <p className="print-only">{details.notes}</p>}
        </div>
      </div>
    </div>
  )
}
