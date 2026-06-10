import { AlertTriangle, Check, Edit2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchReservations, updateReservation } from '../api/pmsApi'
import type { ReservationRecord } from '../types/domain'
import { formatDisplayDate } from '../utils/date'

type IncompleteRow = ReservationRecord & {
  draftGuestName: string
  draftPhone: string
  draftNightlyPrice: string
  editing: boolean
  saving: boolean
  saved: boolean
}

function detectIncomplete(reservations: ReservationRecord[]): IncompleteRow[] {
  return reservations
    .filter(
      (r) =>
        (r.reservationType === 'airbnb' || r.reservationType === 'booking') &&
        (!r.guestName || r.guestName === 'Airbnb' || r.guestName === 'Booking') &&
        !r.guestPhone &&
        Number(r.totalPaid) === 0,
    )
    .map((r) => ({
      ...r,
      draftGuestName: '',
      draftPhone: '',
      draftNightlyPrice: '',
      editing: false,
      saving: false,
      saved: false,
    }))
}

// ── Missing price rows ─────────────────────────────────────────────────────────
type MissingPriceRow = ReservationRecord & {
  draftNightlyPrice: string
  editing: boolean
  saving: boolean
  saved: boolean
}

function detectMissingPrice(reservations: ReservationRecord[]): MissingPriceRow[] {
  return reservations
    .filter(
      (r) =>
        !r.isArchived &&
        r.reservationType !== 'maintenance' &&
        Number(r.nightlyPrice) === 0,
    )
    .map((r) => ({
      ...r,
      draftNightlyPrice: '',
      editing: false,
      saving: false,
      saved: false,
    }))
}

type ConflictGroup = {
  propertyName: string
  reservations: ReservationRecord[]
}

function detectConflicts(reservations: ReservationRecord[]): ConflictGroup[] {
  const byProperty = new Map<string, ReservationRecord[]>()
  for (const r of reservations) {
    if (!byProperty.has(r.propertyId)) byProperty.set(r.propertyId, [])
    byProperty.get(r.propertyId)!.push(r)
  }

  const groups: ConflictGroup[] = []
  for (const [, rows] of byProperty) {
    const sorted = [...rows].sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    const conflicting = new Set<ReservationRecord>()
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      if (a.checkOut > b.checkIn) {
        conflicting.add(a)
        conflicting.add(b)
      }
    }
    if (conflicting.size > 0) {
      groups.push({
        propertyName: rows[0].apartment,
        reservations: [...conflicting].sort((a, b) => a.checkIn.localeCompare(b.checkIn)),
      })
    }
  }
  return groups
}

export function NeedsAttentionPage() {
  const [allReservations, setAllReservations] = useState<ReservationRecord[]>([])
  const [incompleteRows, setIncompleteRows] = useState<IncompleteRow[]>([])
  const [missingPriceRows, setMissingPriceRows] = useState<MissingPriceRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let ignore = false
    fetchReservations()
      .then((rows) => {
        if (!ignore) {
          setAllReservations(rows)
          setIncompleteRows(detectIncomplete(rows))
          setMissingPriceRows(detectMissingPrice(rows))
          setStatus('ready')
        }
      })
      .catch(() => { if (!ignore) setStatus('error') })
    return () => { ignore = true }
  }, [])

  const conflicts = useMemo(() => detectConflicts(allReservations), [allReservations])

  function startEdit(id: string) {
    setIncompleteRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, editing: true } : r)),
    )
  }

  function cancelEdit(id: string) {
    setIncompleteRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, editing: false } : r)),
    )
  }

  function updateDraft(id: string, field: 'draftGuestName' | 'draftPhone' | 'draftNightlyPrice', value: string) {
    setIncompleteRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    )
  }

  async function saveRow(row: IncompleteRow) {
    setIncompleteRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, saving: true } : r)),
    )
    try {
      await updateReservation(row.id, {
        guestName: row.draftGuestName || row.guestName,
        guestPhone: row.draftPhone || row.guestPhone,
        nightlyPrice: row.draftNightlyPrice || row.nightlyPrice,
        paymentDue: row.paymentDue,
        paid: row.paid,
        notes: row.notes,
        reservationType: row.reservationType,
        propertyId: row.propertyId,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
      })
      setIncompleteRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                guestName: row.draftGuestName || r.guestName,
                guestPhone: row.draftPhone || r.guestPhone,
                nightlyPrice: row.draftNightlyPrice || r.nightlyPrice,
                editing: false,
                saving: false,
                saved: true,
              }
            : r,
        ),
      )
    } catch {
      setIncompleteRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, saving: false } : r)),
      )
    }
  }

  // ── Missing price row handlers ──────────────────────────────────────────────
  function startPriceEdit(id: string) {
    setMissingPriceRows((prev) => prev.map((r) => (r.id === id ? { ...r, editing: true } : r)))
  }

  function cancelPriceEdit(id: string) {
    setMissingPriceRows((prev) => prev.map((r) => (r.id === id ? { ...r, editing: false } : r)))
  }

  function updatePriceDraft(id: string, value: string) {
    setMissingPriceRows((prev) => prev.map((r) => (r.id === id ? { ...r, draftNightlyPrice: value } : r)))
  }

  async function savePriceRow(row: MissingPriceRow) {
    setMissingPriceRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, saving: true } : r)))
    try {
      await updateReservation(row.id, {
        guestName: row.guestName,
        guestPhone: row.guestPhone,
        paymentDue: row.paymentDue,
        paid: row.paid,
        notes: row.notes,
        reservationType: row.reservationType,
        propertyId: row.propertyId,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        nightlyPrice: row.draftNightlyPrice || row.nightlyPrice,
      })
      setMissingPriceRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, nightlyPrice: row.draftNightlyPrice || r.nightlyPrice, editing: false, saving: false, saved: true }
            : r,
        ),
      )
    } catch {
      setMissingPriceRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, saving: false } : r)))
    }
  }

  const pendingCount = incompleteRows.filter((r) => !r.saved).length
  const missingPriceCount = missingPriceRows.filter((r) => !r.saved).length
  const conflictCount = conflicts.reduce((sum, g) => sum + g.reservations.length, 0)

  return (
    <div className="needs-attention-page">
      <div className="needs-attention-header">
        <AlertTriangle size={22} />
        <div>
          <h2>Needs Attention</h2>
          <p>
            {pendingCount > 0 && `${pendingCount} incomplete import${pendingCount !== 1 ? 's' : ''}`}
            {pendingCount > 0 && (missingPriceCount > 0 || conflictCount > 0) && ' · '}
            {missingPriceCount > 0 && `${missingPriceCount} missing price${missingPriceCount !== 1 ? 's' : ''}`}
            {missingPriceCount > 0 && conflictCount > 0 && ' · '}
            {conflictCount > 0 && `${conflictCount} conflict${conflictCount !== 1 ? 's' : ''}`}
            {pendingCount === 0 && missingPriceCount === 0 && conflictCount === 0 && 'All clear'}
          </p>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading...</p>}
      {status === 'error' && <p className="form-error">Could not load reservations.</p>}

      {status === 'ready' && (
        <>
          <section className="attention-section">
            <h3 className="attention-section-title">
              Incomplete iCal imports
              <span className="attention-count">{pendingCount}</span>
            </h3>
            <p className="attention-description">
              These reservations were imported from Airbnb or Booking.com iCal feeds but are missing guest details or pricing.
            </p>
            {incompleteRows.length === 0 ? (
              <div className="attention-empty">
                <Check size={16} />
                No incomplete imports
              </div>
            ) : (
              <div className="table-scroll">
                <table className="attention-table">
                  <thead>
                    <tr>
                      <th>Apartment</th>
                      <th>Source</th>
                      <th>Check-in</th>
                      <th>Check-out</th>
                      <th>Nights</th>
                      <th>Guest name</th>
                      <th>Phone</th>
                      <th>Nightly price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incompleteRows.map((row) => (
                      <tr key={row.id} className={row.saved ? 'row-saved' : ''}>
                        <td><strong>{row.apartment}</strong></td>
                        <td>
                          <span className={`attention-platform platform-${row.reservationType}`}>
                            {row.reservationType}
                          </span>
                        </td>
                        <td>{formatDisplayDate(row.checkIn)}</td>
                        <td>{formatDisplayDate(row.checkOut)}</td>
                        <td className="col-narrow">{row.totalNights}</td>
                        <td>
                          {row.editing ? (
                            <input
                              autoFocus
                              placeholder="Guest name"
                              type="text"
                              value={row.draftGuestName}
                              onChange={(e) => updateDraft(row.id, 'draftGuestName', e.target.value)}
                            />
                          ) : (
                            <span className="attention-missing">{row.guestName || '—'}</span>
                          )}
                        </td>
                        <td>
                          {row.editing ? (
                            <input
                              placeholder="Phone"
                              type="tel"
                              value={row.draftPhone}
                              onChange={(e) => updateDraft(row.id, 'draftPhone', e.target.value)}
                            />
                          ) : (
                            <span className="attention-missing">{row.guestPhone || '—'}</span>
                          )}
                        </td>
                        <td>
                          {row.editing ? (
                            <input
                              min="0"
                              placeholder="0.00"
                              step="0.01"
                              type="number"
                              value={row.draftNightlyPrice}
                              onChange={(e) => updateDraft(row.id, 'draftNightlyPrice', e.target.value)}
                            />
                          ) : (
                            <span className="attention-missing">{row.nightlyPrice} EUR</span>
                          )}
                        </td>
                        <td>
                          {row.saved ? (
                            <span className="attention-done"><Check size={13} /> Saved</span>
                          ) : row.editing ? (
                            <div className="table-actions">
                              <button
                                className="primary-button"
                                disabled={row.saving}
                                onClick={() => saveRow(row)}
                              >
                                {row.saving ? '...' : 'Save'}
                              </button>
                              <button onClick={() => cancelEdit(row.id)}>
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button className="attention-edit-btn" onClick={() => startEdit(row.id)}>
                              <Edit2 size={13} />
                              Fill in
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Missing price section ── */}
          <section className="attention-section">
            <h3 className="attention-section-title">
              Missing price
              <span className="attention-count">{missingPriceCount}</span>
            </h3>
            <p className="attention-description">
              These reservations have no nightly price set (0.00 EUR). Set a price to keep revenue tracking accurate.
            </p>
            {missingPriceRows.length === 0 ? (
              <div className="attention-empty">
                <Check size={16} />
                All reservations have a price set
              </div>
            ) : (
              <div className="table-scroll">
                <table className="attention-table">
                  <thead>
                    <tr>
                      <th>Apartment</th>
                      <th>Guest</th>
                      <th>Source</th>
                      <th>Check-in</th>
                      <th>Check-out</th>
                      <th>Nights</th>
                      <th>Nightly price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingPriceRows.map((row) => (
                      <tr key={row.id} className={row.saved ? 'row-saved' : ''}>
                        <td><strong>{row.apartment}</strong></td>
                        <td>{row.guestName || row.guestPhone || <span className="attention-missing">—</span>}</td>
                        <td>
                          <span className={`attention-platform platform-${row.reservationType}`}>
                            {row.reservationType}
                          </span>
                        </td>
                        <td>{formatDisplayDate(row.checkIn)}</td>
                        <td>{formatDisplayDate(row.checkOut)}</td>
                        <td className="col-narrow">{row.totalNights}</td>
                        <td>
                          {row.editing ? (
                            <input
                              autoFocus
                              min="0"
                              placeholder="0.00"
                              step="0.01"
                              type="number"
                              value={row.draftNightlyPrice}
                              onChange={(e) => updatePriceDraft(row.id, e.target.value)}
                            />
                          ) : (
                            <span className="attention-missing">{row.nightlyPrice} EUR</span>
                          )}
                        </td>
                        <td>
                          {row.saved ? (
                            <span className="attention-done"><Check size={13} /> Saved</span>
                          ) : row.editing ? (
                            <div className="table-actions">
                              <button
                                className="primary-button"
                                disabled={row.saving}
                                onClick={() => savePriceRow(row)}
                              >
                                {row.saving ? '...' : 'Save'}
                              </button>
                              <button onClick={() => cancelPriceEdit(row.id)}>
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button className="attention-edit-btn" onClick={() => startPriceEdit(row.id)}>
                              <Edit2 size={13} />
                              Set price
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="attention-section">
            <h3 className="attention-section-title">
              Conflicts
              <span className="attention-count warning">{conflictCount}</span>
            </h3>
            <p className="attention-description">
              These reservations have overlapping dates for the same apartment.
            </p>
            {conflicts.length === 0 ? (
              <div className="attention-empty">
                <Check size={16} />
                No conflicts detected
              </div>
            ) : (
              <div className="attention-conflicts">
                {conflicts.map((group, index) => (
                  <div key={index} className="conflict-group">
                    <div className="conflict-group-header">
                      <AlertTriangle size={15} />
                      <strong>{group.propertyName}</strong>
                      <span>{group.reservations.length} overlapping reservations</span>
                    </div>
                    <table className="attention-table">
                      <thead>
                        <tr>
                          <th>Guest</th>
                          <th>Source</th>
                          <th>Check-in</th>
                          <th>Check-out</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.reservations.map((r) => (
                          <tr key={r.id} className="conflict-row">
                            <td><strong>{r.guestName || r.guestPhone || '—'}</strong></td>
                            <td>
                              <span className={`attention-platform platform-${r.reservationType}`}>
                                {r.reservationType}
                              </span>
                            </td>
                            <td>{formatDisplayDate(r.checkIn)}</td>
                            <td>{formatDisplayDate(r.checkOut)}</td>
                            <td>{r.totalPaid} EUR</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
