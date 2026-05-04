import type {
  EditableReservation,
  PropertyListing,
  ReservationPlatform,
} from '../../types/domain'
import { DateInput } from '../../components/shared/DateInput'
import { reservationTypeOptions } from './reservationOptions'

type ReservationsTableProps = {
  onDelete: (reservation: EditableReservation) => void
  onInvoice?: (reservation: EditableReservation) => void
  onPasteRows?: (rows: PastedRow[]) => void
  onSort: (key: ReservationSortKey) => void
  onUpdate: (id: string, updates: Partial<EditableReservation>) => void
  properties: PropertyListing[]
  rows: EditableReservation[]
  sort: ReservationSort
}

export type PastedRow = {
  guestName?: string
  paymentDue?: string
  paid?: string
  guestPhone?: string
  reservationType?: string
  apartmentRef?: string   // raw paste value like "2" — matched to a property in the page
  notes?: string          // col[6] "Lloji i baneses" description kept as notes
  checkIn?: string
  checkOut?: string
  nightlyPrice?: string
  totalPaid?: string
}

export type ReservationSortKey =
  | 'guestName'
  | 'guestPhone'
  | 'paymentDue'
  | 'paid'
  | 'notes'
  | 'reservationType'
  | 'apartment'
  | 'apartmentType'
  | 'checkIn'
  | 'checkOut'
  | 'totalNights'
  | 'nightlyPrice'
  | 'totalPaid'

export type ReservationSort = {
  direction: 'asc' | 'desc'
  key: ReservationSortKey
}

// Columns ordered to match the Excel sheet exactly
const columns: Array<{ key: ReservationSortKey; label: string }> = [
  { key: 'guestName',       label: 'Emri & Mbiemri' },
  { key: 'paymentDue',      label: 'Payment Due' },
  { key: 'paid',            label: 'Pagesa' },
  { key: 'guestPhone',      label: 'Numri' },
  { key: 'reservationType', label: 'Lloji rezervimit' },
  { key: 'apartment',       label: 'Banesa' },
  { key: 'apartmentType',   label: 'Lloji i baneses' },
  { key: 'checkIn',         label: 'Check-in' },
  { key: 'checkOut',        label: 'Check-out' },
  { key: 'totalNights',     label: 'Totali i nateve' },
  { key: 'nightlyPrice',    label: 'Pagesa per nate' },
  { key: 'totalPaid',       label: 'Totali i pageses' },
]

export function ReservationsTable({
  onDelete,
  onInvoice,
  onPasteRows,
  onSort,
  onUpdate,
  properties,
  rows,
  sort,
}: ReservationsTableProps) {
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData.getData('text/plain')
    if (!text.includes('\t')) return

    event.preventDefault()

    const pastedRows: PastedRow[] = text
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const cols = line.split('\t')
        // Columns match the Excel layout 1-to-1:
        // [0]  Emri & Mbiemri   → guestName
        // [1]  Payment Due      → paymentDue
        // [2]  Pagesa           → paid (TRUE/FALSE)
        // [3]  Numri            → guestPhone
        // [4]  Lloji rezervimit → reservationType
        // [5]  Banesa           → apartmentRef (matched to property)
        // [6]  Lloji i baneses  → notes (apartment type description)
        // [7]  Check-in         → checkIn
        // [8]  Check-out        → checkOut
        // [9]  Totali i nateve  → skip (derived)
        // [10] Pagesa per nate  → nightlyPrice
        // [11] Totali i pageses → totalPaid (can calculate nightly price)
        return {
          guestName:       cols[0],
          paymentDue:      cols[1],
          paid:            cols[2],
          guestPhone:      cols[3],
          reservationType: cols[4],
          apartmentRef:    cols[5],
          notes:           cols[6],
          checkIn:         cols[7],
          checkOut:        cols[8],
          nightlyPrice:    cols[10],
          totalPaid:       cols[11],
        }
      })

    onPasteRows?.(pastedRows)
  }

  return (
    <div className="table-scroll" onPaste={handlePaste}>
      <p className="paste-hint">
        Paste rows from your spreadsheet — columns must be in order:{' '}
        <em>
          Emri &amp; Mbiemri · Payment Due · Pagesa · Numri · Lloji rezervimit ·
          Banesa · Lloji i baneses · Check-in · Check-out · Totali i nateve ·
          Pagesa per nate · Totali i pageses
        </em>
      </p>
      <table className="reservations-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>
                <button className="sort-header" onClick={() => onSort(column.key)}>
                  {column.label}
                  <span>{sort.key === column.key ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                </button>
              </th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isAirbnbZero = row.reservationType === 'airbnb' && Number(row.nightlyPrice) === 0
            const rowClass = [
              row.isNew ? 'row-new' : row.isDirty ? 'row-dirty' : '',
              isAirbnbZero ? 'row-airbnb-zero' : '',
            ].filter(Boolean).join(' ')
            return (
            <tr key={row.id} className={rowClass}>

              {/* Emri & Mbiemri */}
              <td>
                <input
                  type="text"
                  value={row.guestName}
                  onChange={(e) => onUpdate(row.id, { guestName: e.target.value })}
                />
              </td>

              {/* Payment Due */}
              <td>
                <DateInput
                  ariaLabel="Payment due"
                  value={row.paymentDue}
                  onChange={(value) => onUpdate(row.id, { paymentDue: value })}
                />
              </td>

              {/* Pagesa (paid checkbox) */}
              <td className="col-center">
                <input
                  aria-label={`${row.guestName || row.guestPhone || 'Reservation'} paid`}
                  checked={row.paid}
                  type="checkbox"
                  onChange={(e) => onUpdate(row.id, { paid: e.target.checked })}
                />
              </td>

              {/* Numri (phone) */}
              <td>
                <input
                  type="tel"
                  value={row.guestPhone}
                  onChange={(e) => onUpdate(row.id, { guestPhone: e.target.value })}
                />
              </td>

              {/* Lloji rezervimit (source) */}
              <td>
                <select
                  value={row.reservationType}
                  onChange={(e) =>
                    onUpdate(row.id, {
                      reservationType: e.target.value as ReservationPlatform,
                      ...(e.target.value === 'airbnb' ? { nightlyPrice: '0.00' } : {}),
                    })
                  }
                >
                  {reservationTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </td>

              {/* Banesa (apartment dropdown) */}
              <td className="col-apartment">
                <select
                  value={row.propertyId}
                  onChange={(e) => {
                    const property = properties.find((item) => item.id === e.target.value)
                    onUpdate(row.id, {
                      apartment: property?.name || '',
                      apartmentType: property?.apartmentType || '',
                      propertyId: e.target.value,
                    })
                  }}
                >
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </td>

              {/* Lloji i baneses (apartment type — read-only, derived from property) */}
              <td className="col-muted">{row.apartmentType || '—'}</td>

              {/* Check-in */}
              <td>
                <DateInput
                  required
                  ariaLabel="Check-in"
                  value={row.checkIn}
                  onChange={(value) => onUpdate(row.id, { checkIn: value })}
                />
              </td>

              {/* Check-out */}
              <td>
                <DateInput
                  required
                  ariaLabel="Check-out"
                  min={row.checkIn}
                  value={row.checkOut}
                  onChange={(value) => onUpdate(row.id, { checkOut: value })}
                />
              </td>

              {/* Totali i nateve (read-only) */}
              <td className="col-narrow col-muted">{row.totalNights}</td>

              {/* Pagesa per nate */}
              <td>
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={row.nightlyPrice}
                  onChange={(e) => onUpdate(row.id, { nightlyPrice: e.target.value })}
                />
              </td>

              {/* Totali i pageses */}
              <td>
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={row.totalPaid}
                  onChange={(e) => onUpdate(row.id, { totalPaid: e.target.value })}
                />
              </td>

              {/* Actions */}
              <td>
                <div className="table-actions">
                  {onInvoice && !row.isNew && (
                    <button onClick={() => onInvoice(row)} title="Open invoice">
                      Invoice
                    </button>
                  )}
                  <button className="danger-text-btn" onClick={() => onDelete(row)}>
                    Del
                  </button>
                </div>
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
