import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { updateFinanceExpense, type FinanceExpensePayload } from '../../api/pmsApi'
import { monthOptions, yearOptions } from '../reservations/monthOptions'
import type { ExpenseCategoryRecord, FinanceExpenseRecord } from '../../types/domain'

const fieldStyle = {
  minHeight: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '0 10px',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
} as const

const labelStyle = { display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 } as const

export function EditExpenseModal({
  expense,
  categories,
  onClose,
  onSaved,
}: {
  expense: FinanceExpenseRecord
  categories: ExpenseCategoryRecord[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FinanceExpensePayload>({
    name: expense.name,
    categoryId: expense.categoryId,
    amountEur: expense.amountEur,
    frequency: expense.frequency,
    startYear: expense.startYear,
    startMonth: expense.startMonth,
    endYear: expense.endYear,
    endMonth: expense.endMonth,
    platform: expense.platform,
    notes: expense.notes,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateFinanceExpense(expense.id, form)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save expense.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ minWidth: 480, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit expense</h3>
          <button className="icon-button" type="button" onClick={onClose}><X size={18} /></button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          <label style={labelStyle}>
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={fieldStyle}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={labelStyle}>
              Amount (EUR)
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.amountEur}
                onChange={(e) => setForm({ ...form, amountEur: e.target.value })}
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              Category
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                style={fieldStyle}
              >
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={labelStyle}>
              Business
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value as FinanceExpensePayload['platform'] })}
                style={fieldStyle}
              >
                <option value="">Shared (both)</option>
                <option value="airstay">AirStay</option>
                <option value="fleet">Fleet</option>
              </select>
            </label>
            <label style={labelStyle}>
              Frequency
              <select
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as FinanceExpensePayload['frequency'] })}
                style={fieldStyle}
              >
                <option value="one_time">One time</option>
                <option value="repeated">Repeated</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            {(['startMonth', 'startYear'] as const).map((field) => (
              <label key={field} style={labelStyle}>
                {field === 'startMonth' ? 'Start month' : 'Start year'}
                <select
                  value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: Number(e.target.value) })}
                  style={fieldStyle}
                >
                  {field === 'startMonth'
                    ? monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)
                    : yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            ))}
            {form.frequency === 'repeated' && (['endMonth', 'endYear'] as const).map((field) => (
              <label key={field} style={labelStyle}>
                {field === 'endMonth' ? 'End month' : 'End year'}
                <select
                  value={form[field] ?? (field === 'endMonth' ? form.startMonth : form.startYear)}
                  onChange={(e) => setForm({ ...form, [field]: Number(e.target.value) })}
                  style={fieldStyle}
                >
                  {field === 'endMonth'
                    ? monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)
                    : yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            ))}
          </div>
          <label style={labelStyle}>
            Notes
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={fieldStyle}
            />
          </label>
          <div className="modal-footer" style={{ marginTop: 4 }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
