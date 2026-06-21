import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMonthlyReceipts, upsertDailyEntry } from '../api/pmsApi'
import { monthOptions, yearOptions } from '../features/reservations/monthOptions'
import { DayDetailModal } from '../features/receipts/DayDetailModal'
import type { DailyDayRecord, ReceiptTotals } from '../types/domain'

const STORAGE_YEAR = 'pms.receipts.year'
const STORAGE_MONTH = 'pms.receipts.month'

export function ReceiptsPage() {
  const today = new Date()

  const [year, setYear] = useState<number>(() => {
    const s = localStorage.getItem(STORAGE_YEAR)
    return s ? Number(s) : today.getFullYear()
  })
  const [month, setMonth] = useState<number>(() => {
    const s = localStorage.getItem(STORAGE_MONTH)
    return s ? Number(s) : today.getMonth() + 1
  })
  const [days, setDays] = useState<DailyDayRecord[]>([])
  const [totals, setTotals] = useState<ReceiptTotals>({
    receiptTotal: '0.00',
    depositTotal: '0.00',
    leftToDeposit: '0.00',
  })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const autosaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const loadMonth = useCallback(async () => {
    setStatus('loading')
    try {
      const data = await fetchMonthlyReceipts(year, month)
      setDays(data.days)
      setTotals(data.totals)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [year, month])

  useEffect(() => {
    loadMonth()
  }, [loadMonth])

  useEffect(() => {
    const timers = autosaveTimers.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
    }
  }, [])

  function updateDay(date: string, patch: Partial<DailyDayRecord>) {
    setDays((prev) => prev.map((d) => (d.date === date ? { ...d, ...patch } : d)))
    scheduleSave(date)
  }

  function scheduleSave(date: string) {
    const existing = autosaveTimers.current.get(date)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      autosaveTimers.current.delete(date)
      const current = await new Promise<DailyDayRecord | undefined>((resolve) => {
        setDays((prev) => {
          const found = prev.find((d) => d.date === date)
          resolve(found)
          return prev
        })
      })
      if (!current) return
      try {
        const saved = await upsertDailyEntry({
          date,
          depositAmount: current.depositAmount,
          receiptLeft: current.receiptLeft,
          note: current.note,
        })
        setDays((prev) =>
          prev.map((d) =>
            d.date === date ? { ...d, id: saved.id ?? d.id } : d,
          ),
        )
      } catch {
        // silent — user can retry by interacting again
      }
    }, 600)
    autosaveTimers.current.set(date, timer)
  }

  function handleDayUpdated(updatedDay: Partial<DailyDayRecord> & { date: string }) {
    setDays((prev) =>
      prev.map((d) => (d.date === updatedDay.date ? { ...d, ...updatedDay } : d)),
    )
    // Recompute totals from updated days
    setDays((prev) => {
      const receiptTotal = prev.reduce((sum, d) => sum + parseFloat(d.receiptTotal || '0'), 0)
      const depositTotal = prev.reduce((sum, d) => sum + parseFloat(d.depositAmount || '0'), 0)
      setTotals({
        receiptTotal: receiptTotal.toFixed(2),
        depositTotal: depositTotal.toFixed(2),
        leftToDeposit: (receiptTotal - depositTotal).toFixed(2),
      })
      return prev
    })
  }

  const leftNum = parseFloat(totals.leftToDeposit)

  return (
    <section className="receipts-page">
      <div className="receipts-header">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>Receipts &amp; Deposits</h2>
        </div>

        <div className="receipts-month-picker">
          <label>
            Year
            <select
              value={year}
              onChange={(e) => {
                const v = Number(e.target.value)
                setYear(v)
                localStorage.setItem(STORAGE_YEAR, String(v))
              }}
            >
              {yearOptions().map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            Month
            <select
              value={month}
              onChange={(e) => {
                const v = Number(e.target.value)
                setMonth(v)
                localStorage.setItem(STORAGE_MONTH, String(v))
              }}
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Monthly summary */}
      <div className="receipts-summary">
        <SummaryCard
          label="Total receipts"
          value={totals.receiptTotal}
          variant="neutral"
        />
        <SummaryCard
          label="Total deposited"
          value={totals.depositTotal}
          variant="neutral"
        />
        <SummaryCard
          label="Left to deposit"
          value={totals.leftToDeposit}
          variant={leftNum > 0 ? 'warning' : leftNum < 0 ? 'danger' : 'ok'}
        />
      </div>

      {status === 'loading' && <p className="listings-message">Loading...</p>}
      {status === 'error' && (
        <p className="form-error">Could not load receipts. Start the server and refresh.</p>
      )}

      {status === 'ready' && (
        <div className="table-scroll receipts-table-scroll">
          <table className="receipts-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="col-right">Receipt total</th>
                <th className="col-center">Left</th>
                <th className="col-right">Deposit</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <DayRow
                  key={day.date}
                  day={day}
                  onOpenDetail={() => setSelectedDate(day.date)}
                  onUpdate={updateDay}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedDate && (
        <DayDetailModal
          date={selectedDate}
          month={month}
          year={year}
          onClose={() => setSelectedDate(null)}
          onDayUpdated={handleDayUpdated}
        />
      )}
    </section>
  )
}

function SummaryCard({
  label,
  value,
  variant,
}: {
  label: string
  value: string
  variant: 'neutral' | 'ok' | 'warning' | 'danger'
}) {
  return (
    <div className={`receipts-summary-card receipts-summary-${variant}`}>
      <span className="summary-label">{label}</span>
      <strong className="summary-value">€ {parseFloat(value).toFixed(2)}</strong>
    </div>
  )
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} · ${DAY_NAMES[d.getDay()]}`
}

function DayRow({
  day,
  onOpenDetail,
  onUpdate,
}: {
  day: DailyDayRecord
  onOpenDetail: () => void
  onUpdate: (date: string, patch: Partial<DailyDayRecord>) => void
}) {
  const receiptNum = parseFloat(day.receiptTotal || '0')
  const hasReceipts = day.itemCount > 0

  return (
    <tr className={hasReceipts ? 'row-has-receipts' : ''}>
      <td>
        <button className="receipts-date-btn" type="button" onClick={onOpenDetail}>
          {formatDayLabel(day.date)}
          {hasReceipts && (
            <span className="receipts-item-count">{day.itemCount}</span>
          )}
        </button>
      </td>
      <td className="col-right receipts-receipt-total">
        <button className="receipts-total-cell" type="button" onClick={onOpenDetail}>
          {receiptNum > 0 ? (
            <span className="receipts-amount">€ {receiptNum.toFixed(2)}</span>
          ) : (
            <span className="receipts-zero">—</span>
          )}
          <span className="receipts-add-btn" title="Add receipt">
            <Plus size={13} />
          </span>
        </button>
      </td>
      <td className="col-center">
        <input
          checked={day.receiptLeft}
          className="receipts-checkbox"
          title="Receipt left"
          type="checkbox"
          onChange={(e) => onUpdate(day.date, { receiptLeft: e.target.checked })}
        />
      </td>
      <td className="col-right">
        <input
          className="receipts-deposit-input"
          min="0"
          placeholder="0.00"
          step="0.01"
          type="number"
          value={day.depositAmount === '0.00' ? '' : day.depositAmount}
          onChange={(e) =>
            onUpdate(day.date, { depositAmount: e.target.value || '0.00' })
          }
        />
      </td>
      <td>
        <input
          className="receipts-note-input"
          placeholder="Note..."
          type="text"
          value={day.note}
          onChange={(e) => onUpdate(day.date, { note: e.target.value })}
        />
      </td>
    </tr>
  )
}
