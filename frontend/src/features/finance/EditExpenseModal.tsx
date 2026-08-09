import { FileText, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  deleteExpenseInvoice,
  extractExpense,
  fetchExtractEnabled,
  updateFinanceExpense,
  uploadExpenseInvoice,
  type FinanceExpensePayload,
} from '../../api/pmsApi'
import { monthOptions, yearOptions } from '../reservations/monthOptions'
import type { ExpenseCategoryRecord, FinanceExpenseRecord } from '../../types/domain'

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
    vendor: expense.vendor,
    invoiceDate: expense.invoiceDate,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [invoiceFileUrl, setInvoiceFileUrl] = useState(expense.invoiceFileUrl)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractNote, setExtractNote] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchExtractEnabled().then(setAiEnabled).catch(() => setAiEnabled(false))
  }, [])

  function handleFilePicked() {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError('The file is larger than 10 MB — scan it at a lower resolution.')
      return
    }
    setError('')
    setPendingFile(file)
  }

  async function runExtract() {
    if (!pendingFile) return
    setExtracting(true)
    setError('')
    setExtractNote('')
    try {
      const extracted = await extractExpense(pendingFile)
      setForm((current) => ({
        ...current,
        name: extracted.name || current.name,
        vendor: extracted.vendor || current.vendor,
        amountEur: extracted.amountEur || current.amountEur,
        invoiceDate: extracted.invoiceDate || current.invoiceDate,
        categoryId: extracted.categoryId || current.categoryId,
        notes: extracted.notes || current.notes,
      }))
      setExtractNote(
        `Read by AI${extracted.vendor ? ` — ${extracted.vendor}` : ''}${extracted.currency && extracted.currency !== 'EUR' ? ` (currency: ${extracted.currency} — check the amount)` : ''}. Review before saving.`,
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Extraction failed — fill the form manually.')
    } finally {
      setExtracting(false)
    }
  }

  async function removeExistingInvoice() {
    setError('')
    try {
      await deleteExpenseInvoice(expense.id)
      setInvoiceFileUrl('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove the invoice file.')
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateFinanceExpense(expense.id, form)
      if (pendingFile) {
        await uploadExpenseInvoice(expense.id, pendingFile)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save expense.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="form-modal-head">
          <div>
            <h3>Edit expense</h3>
            <p>Update the expense, attach its invoice, or let AI read one.</p>
          </div>
          <button className="form-modal-close" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="form-modal-body" id="expense-form" onSubmit={handleSubmit}>
          {error && <p className="form-error">{error}</p>}
          {extractNote && <p className="form-success-note">{extractNote}</p>}

          <div className="form-section">
            <p className="form-section-title">Invoice file</p>
            {invoiceFileUrl && !pendingFile && (
              <div className="pill-toggle-group" style={{ marginBottom: 10 }}>
                <a className="pill-button" href={invoiceFileUrl} rel="noreferrer" target="_blank">
                  <FileText size={14} /> View attached invoice
                </a>
                <button className="pill-button danger" type="button" onClick={removeExistingInvoice}>
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            )}
            <label className="dropzone" style={{ padding: 16 }}>
              {pendingFile ? (
                <span className="dropzone-file-chip">
                  <FileText size={14} /> {pendingFile.name}
                </span>
              ) : (
                <>
                  <FileText size={20} />
                  <span>Click to upload the supplier invoice (image or PDF, max 10 MB)</span>
                </>
              )}
              <input
                accept="image/*,application/pdf"
                ref={fileInputRef}
                type="file"
                onChange={handleFilePicked}
              />
            </label>
            {pendingFile && aiEnabled && (
              <button
                className="pill-button accent"
                disabled={extracting}
                style={{ marginTop: 10 }}
                type="button"
                onClick={runExtract}
              >
                <Sparkles size={14} /> {extracting ? 'Reading invoice…' : 'Extract details with AI'}
              </button>
            )}
          </div>

          <div className="form-section">
            <p className="form-section-title">Details</p>
            <div className="form-grid">
              <label className="form-field">
                Name
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="form-field">
                Vendor
                <input
                  placeholder="Supplier name"
                  value={form.vendor ?? ''}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                />
              </label>
              <label className="form-field">
                Amount (EUR)
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.amountEur}
                  onChange={(e) => setForm({ ...form, amountEur: e.target.value })}
                />
              </label>
              <label className="form-field">
                Category
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Invoice date
                <input
                  type="date"
                  value={form.invoiceDate ?? ''}
                  onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
                />
              </label>
              {/* Paid status is month-specific — toggle it on the expense row
                  for the month you are viewing, not here. */}
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Accounting period</p>
            <div className="form-grid">
              <label className="form-field">
                Business
                <select
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value as FinanceExpensePayload['platform'] })}
                >
                  <option value="">Shared (both)</option>
                  <option value="airstay">AirStay</option>
                  <option value="fleet">Fleet</option>
                </select>
              </label>
              <label className="form-field">
                Frequency
                <select
                  value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value as FinanceExpensePayload['frequency'] })}
                >
                  <option value="one_time">One time</option>
                  <option value="repeated">Repeated</option>
                </select>
              </label>
              <label className="form-field">
                Start month
                <select
                  value={form.startMonth}
                  onChange={(e) => setForm({ ...form, startMonth: Number(e.target.value) })}
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Start year
                <select
                  value={form.startYear}
                  onChange={(e) => setForm({ ...form, startYear: Number(e.target.value) })}
                >
                  {yearOptions().map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              {form.frequency === 'repeated' && (
                <>
                  <label className="form-field">
                    End month
                    <select
                      value={form.endMonth ?? form.startMonth}
                      onChange={(e) => setForm({ ...form, endMonth: Number(e.target.value) })}
                    >
                      {monthOptions.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    End year
                    <select
                      value={form.endYear ?? form.startYear}
                      onChange={(e) => setForm({ ...form, endYear: Number(e.target.value) })}
                    >
                      {yearOptions().map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Notes</p>
            <label className="form-field">
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
        </form>

        <div className="form-modal-footer">
          <button className="pill-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="pill-button accent" disabled={saving || extracting} form="expense-form" type="submit">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
