import { CheckSquare, CircleDollarSign, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateReservationPayment } from '../../api/pmsApi'
import { PanelHeader } from '../../components/shared/PanelHeader'
import type { ReservationRecord } from '../../types/domain'
import { toDateInputValue } from '../../utils/date'
import { buildDueRows, togglePayload, type DueRow } from '../payments/paymentPeriods'

type PaymentsDuePanelProps = {
  reservations: ReservationRecord[]
  onReservationUpdated: (saved: ReservationRecord) => void
}

export function PaymentsDuePanel({ reservations, onReservationUpdated }: PaymentsDuePanelProps) {
  const navigate = useNavigate()
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
      const saved = await updateReservationPayment(row.reservation.id, togglePayload(row))
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
      <PanelHeader
        icon={CircleDollarSign}
        title={`Payments due — ${remaining} remaining`}
        action="View all →"
        onAction={() => navigate('/payments')}
      />

      <div className="payments-due-totals">
        <span>
          Owed: <strong className="money">EUR {owed.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
        </span>
        <span>
          Payments remaining: <strong>{remaining}</strong>
        </span>
        <span>
          Total value: <strong className="money">EUR {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
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
                    <em className="payments-due-month">{row.dueLabel}</em>
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

              <strong className="payments-due-amount money">
                EUR {row.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
