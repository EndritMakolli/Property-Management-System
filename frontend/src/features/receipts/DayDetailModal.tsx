import { Check, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  createReceiptItem,
  deleteReceiptItem,
  fetchAvailableReservations,
  fetchDayDetail,
  updateReceiptItem,
  upsertDailyEntry,
} from '../../api/pmsApi'
import type { DailyDayRecord, LinkedReservation, ReceiptItemRecord } from '../../types/domain'

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDateFull(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

type EditableItem = ReceiptItemRecord & { isNew?: boolean; isDirty?: boolean }

type Props = {
  date: string
  month: number
  year: number
  onClose: () => void
  onDayUpdated: (day: Partial<DailyDayRecord> & { date: string }) => void
}

export function DayDetailModal({ date, month, year, onClose, onDayUpdated }: Props) {
  const [entry, setEntry] = useState<DailyDayRecord | null>(null)
  const [items, setItems] = useState<EditableItem[]>([])
  const [availableReservations, setAvailableReservations] = useState<LinkedReservation[]>([])
  const [pickerForItemId, setPickerForItemId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    load()
  }, [date])

  async function load() {
    setStatus('loading')
    setError('')
    try {
      const [detail, reservations] = await Promise.all([
        fetchDayDetail(date),
        fetchAvailableReservations(year, month),
      ])
      const entryDay: DailyDayRecord = {
        date,
        id: detail.entry.id ?? null,
        receiptTotal: calcReceiptTotal(detail.items),
        depositAmount: detail.entry.depositAmount,
        receiptLeft: detail.entry.receiptLeft,
        note: detail.entry.note,
        itemCount: detail.items.length,
      }
      setEntry(entryDay)
      setItems(detail.items.map((i) => ({ ...i, isDirty: false })))
      setAvailableReservations(reservations)
      setStatus('ready')
    } catch {
      setStatus('error')
      setError('Could not load day detail.')
    }
  }

  async function reloadReservations(currentItemId?: string) {
    try {
      const reservations = await fetchAvailableReservations(year, month, currentItemId)
      setAvailableReservations(reservations)
    } catch {
      // non-critical
    }
  }

  function calcReceiptTotal(list: ReceiptItemRecord[]) {
    return list.reduce((sum, i) => sum + parseFloat(i.value || '0'), 0).toFixed(2)
  }

  function updateEntry(patch: Partial<DailyDayRecord>) {
    setEntry((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  async function saveEntry() {
    if (!entry) return
    setSaving(true)
    setError('')
    try {
      await upsertDailyEntry({
        date: entry.date,
        depositAmount: entry.depositAmount,
        receiptLeft: entry.receiptLeft,
        note: entry.note,
      })
      onDayUpdated({ ...entry })
    } catch {
      setError('Could not save.')
    } finally {
      setSaving(false)
    }
  }

  function addItem() {
    const tempId = `new-${Date.now()}`
    setItems((prev) => [
      ...prev,
      { id: tempId, value: '', note: '', reservations: [], isNew: true, isDirty: true },
    ])
  }

  function updateItem(id: string, patch: Partial<EditableItem>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch, isDirty: true } : item)),
    )
  }

  function toggleReservationLink(itemId: string, reservation: LinkedReservation) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item
        const already = item.reservations.some((r) => r.id === reservation.id)
        const reservations = already
          ? item.reservations.filter((r) => r.id !== reservation.id)
          : [...item.reservations, reservation]
        return { ...item, reservations, isDirty: true }
      }),
    )
  }

  async function saveItem(item: EditableItem) {
    if (!item.isDirty) return
    setSaving(true)
    setError('')
    const reservationIds = item.reservations.map((r) => r.id)
    try {
      let saved: ReceiptItemRecord
      if (item.isNew) {
        saved = await createReceiptItem({
          date,
          value: item.value || '0.00',
          note: item.note,
          reservationIds,
        })
      } else {
        saved = await updateReceiptItem(item.id, {
          value: item.value || '0.00',
          note: item.note,
          reservationIds,
        })
      }
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...saved, isDirty: false, isNew: false } : i,
        ),
      )
      // Recompute receipt total on entry
      setItems((current) => {
        const newTotal = calcReceiptTotal(
          current.map((i) => (i.id === item.id ? { ...saved } : i)),
        )
        setEntry((e) => e ? { ...e, receiptTotal: newTotal, itemCount: current.length } : e)
        onDayUpdated({ date, receiptTotal: newTotal, itemCount: current.length })
        return current
      })
      await reloadReservations()
      setPickerForItemId(null)
    } catch {
      setError('Could not save receipt item.')
    } finally {
      setSaving(false)
    }
  }

  async function removeItem(item: EditableItem) {
    if (item.isNew) {
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      return
    }
    try {
      await deleteReceiptItem(item.id)
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== item.id)
        const newTotal = calcReceiptTotal(next)
        setEntry((e) => e ? { ...e, receiptTotal: newTotal, itemCount: next.length } : e)
        onDayUpdated({ date, receiptTotal: newTotal, itemCount: next.length })
        return next
      })
      await reloadReservations()
    } catch {
      setError('Could not delete receipt item.')
    }
  }

  // Day totals
  const totalReceiptValue = parseFloat(calcReceiptTotal(items))
  const totalLinkedPaid = items.reduce(
    (sum, item) =>
      sum + item.reservations.reduce((s, r) => s + parseFloat(r.totalPaid || '0'), 0),
    0,
  )
  const difference = totalReceiptValue - totalLinkedPaid

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div className="modal-backdrop day-detail-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="modal day-detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3>{formatDateFull(date)}</h3>
            {entry && (
              <small className="day-detail-subtitle">
                Receipts: €{parseFloat(entry.receiptTotal).toFixed(2)} ·
                Deposit: €{parseFloat(entry.depositAmount).toFixed(2)}
              </small>
            )}
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {status === 'loading' && <p className="listings-message">Loading...</p>}
        {status === 'error' && <p className="form-error">{error}</p>}

        {status === 'ready' && entry && (
          <div className="day-detail-body">
            {/* Day-level deposit + receipt_left */}
            <div className="day-entry-fields">
              <label className="day-entry-label">
                Deposit amount
                <input
                  className="day-entry-input"
                  min="0"
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={entry.depositAmount === '0.00' ? '' : entry.depositAmount}
                  onChange={(e) =>
                    updateEntry({ depositAmount: e.target.value || '0.00' })
                  }
                />
              </label>
              <label className="day-entry-label day-entry-checkbox-label">
                <input
                  checked={entry.receiptLeft}
                  type="checkbox"
                  onChange={(e) => updateEntry({ receiptLeft: e.target.checked })}
                />
                Receipt left
              </label>
              <label className="day-entry-label day-entry-note">
                Note
                <input
                  className="day-entry-input"
                  placeholder="Optional note..."
                  type="text"
                  value={entry.note}
                  onChange={(e) => updateEntry({ note: e.target.value })}
                />
              </label>
              <button
                className="primary-button day-entry-save-btn"
                disabled={saving}
                type="button"
                onClick={saveEntry}
              >
                {saving ? 'Saving...' : 'Save day'}
              </button>
            </div>

            {/* Receipt items */}
            <div className="receipt-items-section">
              <div className="receipt-items-header">
                <h4>Receipts</h4>
                <button className="icon-row-button" type="button" onClick={addItem}>
                  <Plus size={14} />
                  Add receipt
                </button>
              </div>

              {error && <p className="form-error">{error}</p>}

              {items.length === 0 && (
                <p className="listings-message">No receipts for this day yet.</p>
              )}

              {items.map((item) => (
                <ReceiptItemRow
                  key={item.id}
                  availableReservations={availableReservations}
                  item={item}
                  pickerOpen={pickerForItemId === item.id}
                  saving={saving}
                  onDelete={() => removeItem(item)}
                  onSave={() => saveItem(item)}
                  onTogglePicker={() =>
                    setPickerForItemId((prev) => (prev === item.id ? null : item.id))
                  }
                  onToggleReservation={(r) => toggleReservationLink(item.id, r)}
                  onUpdate={(patch) => updateItem(item.id, patch)}
                />
              ))}

              {/* Day totals */}
              {items.length > 0 && (
                <div className="receipt-day-totals">
                  <div className="receipt-total-row">
                    <span>Total receipt value</span>
                    <strong>€ {totalReceiptValue.toFixed(2)}</strong>
                  </div>
                  <div className="receipt-total-row">
                    <span>Total reservation paid</span>
                    <strong>€ {totalLinkedPaid.toFixed(2)}</strong>
                  </div>
                  <div className={`receipt-total-row receipt-diff-row${difference !== 0 ? ' has-diff' : ''}`}>
                    <span>Difference</span>
                    <strong className={difference !== 0 ? 'diff-nonzero' : ''}>
                      {difference > 0 ? '+' : ''}€ {difference.toFixed(2)}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ReceiptItemRow({
  availableReservations,
  item,
  pickerOpen,
  saving,
  onDelete,
  onSave,
  onTogglePicker,
  onToggleReservation,
  onUpdate,
}: {
  availableReservations: LinkedReservation[]
  item: EditableItem
  pickerOpen: boolean
  saving: boolean
  onDelete: () => void
  onSave: () => void
  onTogglePicker: () => void
  onToggleReservation: (r: LinkedReservation) => void
  onUpdate: (patch: Partial<EditableItem>) => void
}) {
  const linkedIds = new Set(item.reservations.map((r) => r.id))
  const linkedPaid = item.reservations.reduce(
    (sum, r) => sum + parseFloat(r.totalPaid || '0'),
    0,
  )
  const itemValue = parseFloat(item.value || '0')
  const diff = itemValue - linkedPaid

  return (
    <div className={`receipt-item-card${item.isDirty ? ' is-dirty' : ''}`}>
      <div className="receipt-item-top">
        <label className="receipt-item-field">
          Receipt value
          <input
            className="receipt-item-value-input"
            min="0"
            placeholder="0.00"
            step="0.01"
            type="number"
            value={item.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
          />
        </label>
        <div className="receipt-item-field receipt-item-note">
          <span>Note</span>
          <input
            placeholder="e.g. guest name, apartment..."
            type="text"
            value={item.note}
            onChange={(e) => onUpdate({ note: e.target.value })}
          />
          {item.reservations.length > 0 && (
            <div className="receipt-item-note-totals">
              <span>Receipt: <strong>€{itemValue.toFixed(2)}</strong></span>
              <span>Reservations: <strong>€{linkedPaid.toFixed(2)}</strong></span>
              <span className={diff !== 0 ? 'diff-nonzero' : ''}>
                Diff: <strong>{diff > 0 ? '+' : ''}€{diff.toFixed(2)}</strong>
              </span>
            </div>
          )}
        </div>
        <div className="receipt-item-actions">
          <button
            className="primary-button"
            disabled={saving || !item.isDirty}
            type="button"
            onClick={onSave}
          >
            Save
          </button>
          <button
            className="danger-text-btn"
            type="button"
            onClick={onDelete}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Linked reservations */}
      <div className="receipt-linked-reservations">
        {item.reservations.map((r) => (
          <div key={r.id} className="linked-reservation-chip">
            <span className="linked-res-name">{r.guestName}</span>
            <span className="linked-res-detail">
              {r.apartment} · {r.checkIn} → {r.checkOut}
            </span>
            <span className="linked-res-paid">€ {parseFloat(r.totalPaid).toFixed(2)}</span>
            <button
              className="linked-res-remove"
              title="Remove link"
              type="button"
              onClick={() => onToggleReservation(r)}
            >
              <X size={11} />
            </button>
          </div>
        ))}

        <button className="link-reservation-btn" type="button" onClick={onTogglePicker}>
          <Plus size={13} />
          {pickerOpen ? 'Close picker' : 'Link reservation'}
        </button>
      </div>

      {/* Reservation picker */}
      {pickerOpen && (
        <div className="reservation-picker">
          <p className="reservation-picker-hint">
            Select reservations to link. Already-linked ones are greyed out.
          </p>
          {availableReservations.length === 0 && (
            <p className="listings-message">No reservations available for this month.</p>
          )}
          {availableReservations.map((r) => {
            const selected = linkedIds.has(r.id)
            const unavailable = r.alreadyLinked && !selected
            return (
              <button
                key={r.id}
                className={`picker-reservation-row${selected ? ' selected' : ''}${unavailable ? ' unavailable' : ''}`}
                disabled={unavailable}
                type="button"
                onClick={() => !unavailable && onToggleReservation(r)}
              >
                <span className={`picker-check${selected ? ' visible' : ''}`}>
                  <Check size={13} />
                </span>
                <span className="picker-guest">{r.guestName}</span>
                <span className="picker-apt">{r.apartment}</span>
                <span className="picker-dates">
                  {r.checkIn} → {r.checkOut}
                </span>
                <span className="picker-paid">€ {parseFloat(r.totalPaid).toFixed(2)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
