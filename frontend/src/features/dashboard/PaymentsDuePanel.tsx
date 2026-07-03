import { CheckSquare, CircleDollarSign, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { updateReservationPayment } from '../../api/pmsApi'
import { PanelHeader } from '../../components/shared/PanelHeader'
import { monthNames, revenueInsideMonth } from '../reports/reportCalculations'
import type { ReservationRecord } from '../../types/domain'
import { formatDisplayDate, parseDateValue, toDateInputValue } from '../../utils/date'

// One row per outstanding payment: a whole reservation, or — for "monthly"
// stays — one instalment per month of the stay.
type DueRow = {
  key: string
  reservation: ReservationRecord
  monthKey: string | null // "YYYY-MM" for a monthly instalment, null for full
  label: string
  dueLabel: string
  sortKey: string
  amount: number
  paid: boolean
}

// Months ("YYYY-MM") a stay touches: check-in month through the month of the
// last night (check-out day itself is not a night).
function stayMonthKeys(reservation: ReservationRecord): string[] {
  const lastNight = parseDateValue(reservation.checkOut)
  lastNight.setDate(lastNight.getDate() - 1)
  const keys: string[] = []
  const cursor = parseDateValue(reservation.checkIn)
  cursor.setDate(1)
  while (
    cursor.getFullYear() < lastNight.getFullYear() ||
    (cursor.getFullYear() === lastNight.getFullYear() && cursor.getMonth() <= lastNight.getMonth())
  ) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return keys
}

function monthKeyLabel(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return `${monthNames[month - 1]} ${year}`
}

function buildDueRows(reservations: ReservationRecord[], today: string): DueRow[] {
  const rows: DueRow[] = []

  for (const r of reservations) {
    if (r.reservationType === 'maintenance' || r.isArchived) continue
    // Only stays that have already checked in owe anything yet.
    if (r.checkIn > today) continue
    const guest = r.guestName || r.guestPhone || 'Guest'

    if (r.reservationType === 'monthly') {
      const paidMonths = new Set(r.paidMonths ?? [])
      for (const key of stayMonthKeys(r)) {
        // Future months are not due yet — they appear once the month starts.
        if (`${key}-01` > today) continue
        const [year, month] = key.split('-').map(Number)
        const amount = revenueInsideMonth(r, year, month)
        if (amount <= 0) continue
        rows.push({
          key: `${r.id}-${key}`,
          reservation: r,
          monthKey: key,
          label: `${guest} · ${r.apartment}`,
          dueLabel: monthKeyLabel(key),
          sortKey: `${key}-01`,
          amount,
          paid: paidMonths.has(key),
        })
      }
    } else {
      const amount = Number(r.totalPaid)
      if (!Number.isFinite(amount) || amount <= 0) continue
      rows.push({
        key: r.id,
        reservation: r,
        monthKey: null,
        label: `${guest} · ${r.apartment}`,
        dueLabel: r.paymentDue
          ? `due ${formatDisplayDate(r.paymentDue)}`
          : `check-in ${formatDisplayDate(r.checkIn)}`,
        sortKey: r.paymentDue || r.checkIn,
        amount,
        paid: r.paid,
      })
    }
  }

  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
}

type PaymentsDuePanelProps = {
  reservations: ReservationRecord[]
  onReservationUpdated: (saved: ReservationRecord) => void
}

export function PaymentsDuePanel({ reservations, onReservationUpdated }: PaymentsDuePanelProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Rows checked in this session stay visible (greyed) so a mis-click can be undone.
  const [touchedKeys, setTouchedKeys] = useState<Set<string>>(new Set())

  const today = toDateInputValue(new Date())
  const allRows = useMemo(() => buildDueRows(reservations, today), [reservations, today])
  const rows = useMemo(
    () => allRows.filter((row) => !row.paid || touchedKeys.has(row.key)),
    [allRows, touchedKeys],
  )

  const owed = rows.filter((row) => !row.paid).reduce((sum, row) => sum + row.amount, 0)
  const remaining = rows.filter((row) => !row.paid).length
  const totalValue = useMemo(() => {
    const seen = new Set<string>()
    let sum = 0
    for (const row of rows) {
      if (seen.has(row.reservation.id)) continue
      seen.add(row.reservation.id)
      sum += Number(row.reservation.totalPaid) || 0
    }
    return sum
  }, [rows])

  async function toggle(row: DueRow) {
    setBusyKey(row.key)
    setError('')
    try {
      let saved: ReservationRecord
      if (row.monthKey) {
        const current = new Set(row.reservation.paidMonths ?? [])
        if (row.paid) current.delete(row.monthKey)
        else current.add(row.monthKey)
        const paidMonths = [...current].sort()
        const allPaid = stayMonthKeys(row.reservation).every((key) => current.has(key))
        saved = await updateReservationPayment(row.reservation.id, { paidMonths, paid: allPaid })
      } else {
        saved = await updateReservationPayment(row.reservation.id, { paid: !row.paid })
      }
      setTouchedKeys((prev) => new Set(prev).add(row.key))
      onReservationUpdated(saved)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the payment.')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section className="panel payments-due-panel">
      <PanelHeader icon={CircleDollarSign} title={`Payments due — ${remaining} remaining`} />

      <div className="payments-due-totals">
        <span>
          Owed: <strong>EUR {owed.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
        </span>
        <span>
          Payments remaining: <strong>{remaining}</strong>
        </span>
        <span>
          Total value: <strong>EUR {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
        </span>
      </div>

      {error && <p className="form-error">{error}</p>}

      {rows.length === 0 ? (
        <p className="list-empty">Everything is paid — nothing outstanding.</p>
      ) : (
        <ul className="payments-due-list">
          {rows.map((row) => (
            <li key={row.key} className={`payments-due-row${row.paid ? ' done' : ''}`}>
              <label
                className="cleaning-check"
                title={row.paid ? 'Mark as not paid' : 'Mark as paid'}
              >
                <input
                  type="checkbox"
                  checked={row.paid}
                  disabled={busyKey === row.key}
                  onChange={() => toggle(row)}
                />
                {row.paid ? <CheckSquare size={19} /> : <Square size={19} />}
              </label>

              <div className="payments-due-info">
                <strong>{row.label}</strong>
                <span>
                  {row.monthKey ? (
                    <>
                      <em className="payments-due-month">{row.dueLabel}</em>
                      {' · '}
                      {formatDisplayDate(row.reservation.checkIn)} → {formatDisplayDate(row.reservation.checkOut)}
                    </>
                  ) : (
                    <>
                      {row.dueLabel} · {row.reservation.totalNights} night
                      {row.reservation.totalNights !== 1 ? 's' : ''}
                    </>
                  )}
                </span>
              </div>

              <span className={`search-res-platform search-res-platform-${row.reservation.reservationType}`}>
                {row.reservation.reservationType}
              </span>

              <strong className="payments-due-amount">
                EUR {row.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
