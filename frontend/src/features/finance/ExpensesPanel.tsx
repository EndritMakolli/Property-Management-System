import { FileText, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  createExpenseCategory,
  createFinanceExpense,
  deleteExpenseCategory,
  deleteFinanceExpense,
  extractExpense,
  fetchExtractEnabled,
  setExpensePaidForMonth,
  updateExpenseCategory,
  uploadExpenseInvoice,
  type FinanceExpensePayload,
} from '../../api/pmsApi'
import { monthOptions, yearOptions } from '../reservations/monthOptions'
import type { ExpenseCategoryRecord, FinanceExpenseRecord } from '../../types/domain'
import { FinanceList } from './FinanceList'
import { money } from './financeUtils'

type ExpensesPanelProps = {
  categories: ExpenseCategoryRecord[]
  setCategories: Dispatch<SetStateAction<ExpenseCategoryRecord[]>>
  expenses: FinanceExpenseRecord[]
  selectedMonth: number
  selectedYear: number
  onReload: () => Promise<void>
  onError: (message: string) => void
  onEdit: (expense: FinanceExpenseRecord) => void
}

export function ExpensesPanel({
  categories,
  setCategories,
  expenses,
  selectedMonth,
  selectedYear,
  onReload,
  onError,
  onEdit,
}: ExpensesPanelProps) {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#6b7280')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')

  const [expenseForm, setExpenseForm] = useState<FinanceExpensePayload>({
    name: '',
    categoryId: '',
    amountEur: '',
    frequency: 'one_time',
    startYear: selectedYear,
    startMonth: selectedMonth,
    endYear: null,
    endMonth: null,
    platform: '',
    notes: '',
    paid: false,
    vendor: '',
    invoiceDate: '',
  })

  // AI invoice scan: file held locally, attached to the expense after create.
  const [aiEnabled, setAiEnabled] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractNote, setExtractNote] = useState('')
  const [unpaidOnly, setUnpaidOnly] = useState(false)
  const scanInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchExtractEnabled().then(setAiEnabled).catch(() => setAiEnabled(false))
  }, [])

  // Keep the form anchored to the selected period and default to the first category.
  useEffect(() => {
    setExpenseForm((current) => ({
      ...current,
      categoryId: current.categoryId || categories[0]?.id || '',
      startYear: selectedYear,
      startMonth: selectedMonth,
    }))
  }, [categories, selectedMonth, selectedYear])

  async function addCategory() {
    if (!newCategoryName.trim()) return
    try {
      const category = await createExpenseCategory({ name: newCategoryName, color: newCategoryColor })
      setCategories((current) =>
        current.some((item) => item.id === category.id) ? current : [...current, category],
      )
      setExpenseForm((current) => ({ ...current, categoryId: category.id }))
      setNewCategoryName('')
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : 'Could not create category.')
    }
  }

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const created = await createFinanceExpense(expenseForm)
      if (pendingFile) {
        await uploadExpenseInvoice(created.id, pendingFile)
      }
      setExpenseForm((current) => ({
        ...current,
        name: '',
        amountEur: '',
        notes: '',
        platform: '',
        paid: false,
        vendor: '',
        invoiceDate: '',
      }))
      setPendingFile(null)
      setExtractNote('')
      await onReload()
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : 'Could not create expense.')
    }
  }

  function handleScanPicked() {
    const file = scanInputRef.current?.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      onError('The file is larger than 10 MB — scan it at a lower resolution.')
      return
    }
    setPendingFile(file)
    setExtractNote('')
    if (scanInputRef.current) scanInputRef.current.value = ''
  }

  async function runExtract() {
    if (!pendingFile) return
    setExtracting(true)
    setExtractNote('')
    try {
      const extracted = await extractExpense(pendingFile)
      setExpenseForm((current) => ({
        ...current,
        name: extracted.name || current.name,
        vendor: extracted.vendor || current.vendor,
        amountEur: extracted.amountEur || current.amountEur,
        invoiceDate: extracted.invoiceDate || current.invoiceDate,
        categoryId: extracted.categoryId || current.categoryId,
        notes: extracted.notes || current.notes,
      }))
      setExtractNote(
        `Read by AI${extracted.vendor ? ` — ${extracted.vendor}` : ''}. Review the values, then add the expense (starts as unpaid).`,
      )
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : 'Extraction failed — fill the form manually.')
    } finally {
      setExtracting(false)
    }
  }

  // Paid/unpaid is month-specific: this toggles the SELECTED month only, so a
  // recurring wage paid in July still shows unpaid when August is selected.
  async function togglePaid(expense: FinanceExpenseRecord) {
    try {
      await setExpensePaidForMonth(expense.id, selectedYear, selectedMonth, !expense.paidForMonth)
      await onReload()
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : 'Could not update the payment status.')
    }
  }

  const visibleExpenses = unpaidOnly ? expenses.filter((expense) => !expense.paidForMonth) : expenses
  const unpaidCount = expenses.filter((expense) => !expense.paidForMonth).length

  return (
    <article className="panel finance-section">
      <h3>Expenses</h3>
      <div className="category-create">
        <input
          placeholder="New category, e.g. Wages"
          value={newCategoryName}
          onChange={(event) => setNewCategoryName(event.target.value)}
        />
        <input
          type="color"
          title="Category color"
          value={newCategoryColor}
          style={{ width: 36, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer', padding: 2 }}
          onChange={(e) => setNewCategoryColor(e.target.value)}
        />
        <button type="button" onClick={addCategory}>
          <Plus size={16} />
          Category
        </button>
      </div>
      {categories.length > 0 && (
        <div className="category-list">
          {categories.map((cat) => (
            <div key={cat.id} className="category-list-row">
              <input
                type="color"
                value={cat.color}
                title="Change color"
                className="category-color-btn"
                onChange={async (e) => {
                  const color = e.target.value
                  setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, color } : c))
                  try {
                    await updateExpenseCategory(cat.id, { color })
                  } catch {
                    onError('Could not update category color.')
                  }
                }}
              />
              {editingCategoryId === cat.id ? (
                <input
                  autoFocus
                  className="category-name-input"
                  value={editingCategoryName}
                  onChange={(e) => setEditingCategoryName(e.target.value)}
                  onBlur={async () => {
                    const name = editingCategoryName.trim()
                    setEditingCategoryId(null)
                    if (!name || name === cat.name) return
                    setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, name } : c))
                    try {
                      await updateExpenseCategory(cat.id, { name })
                    } catch {
                      onError('Could not update category name.')
                      setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, name: cat.name } : c))
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') { setEditingCategoryId(null) }
                  }}
                />
              ) : (
                <span
                  title="Click to rename"
                  style={{ cursor: 'text' }}
                  onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name) }}
                >
                  {cat.name}
                </span>
              )}
              <button
                className="category-delete-btn"
                title="Delete category"
                type="button"
                onClick={async () => {
                  try {
                    await deleteExpenseCategory(cat.id)
                    setCategories((prev) => prev.filter((c) => c.id !== cat.id))
                  } catch (e) {
                    onError(e instanceof Error ? e.message : 'Could not delete category.')
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* AI invoice scan — pick a file, extract, review, save (unpaid by default). */}
      <div className="expense-scan-block">
        <p className="expense-scan-title">
          <FileText size={15} /> Upload an invoice
        </p>
        <p className="expense-scan-hint">
          Drop a photo or PDF of a supplier invoice here — {aiEnabled ? 'the AI reads the vendor, amount and date for you, ' : ''}
          the file is attached to the expense, and it starts as <strong>unpaid</strong> until you mark it paid.
        </p>
        <div className="expense-scan-row">
          <label className="dropzone" style={{ padding: 14, flexDirection: 'row', gap: 8 }}>
            {pendingFile ? (
              <span className="dropzone-file-chip">
                <FileText size={14} /> {pendingFile.name}
              </span>
            ) : (
              <>
                <FileText size={16} />
                <span>Click to choose the invoice file (image or PDF)</span>
              </>
            )}
            <input accept="image/*,application/pdf" ref={scanInputRef} type="file" onChange={handleScanPicked} />
          </label>
          {pendingFile && aiEnabled && (
            <button className="pill-button accent" disabled={extracting} type="button" onClick={runExtract}>
              <Sparkles size={14} /> {extracting ? 'Reading…' : 'Extract with AI'}
            </button>
          )}
          {pendingFile && (
            <button
              className="pill-button"
              type="button"
              onClick={() => {
                setPendingFile(null)
                setExtractNote('')
              }}
            >
              Clear
            </button>
          )}
        </div>
        {extractNote && <p className="form-success-note">{extractNote}</p>}
      </div>

      <form className="finance-form" onSubmit={addExpense}>
        <input
          required
          placeholder="Expense name"
          value={expenseForm.name}
          onChange={(event) => setExpenseForm({ ...expenseForm, name: event.target.value })}
        />
        <input
          required
          min="0"
          placeholder="Value"
          step="0.01"
          type="number"
          value={expenseForm.amountEur}
          onChange={(event) => setExpenseForm({ ...expenseForm, amountEur: event.target.value })}
        />
        <select
          required
          value={expenseForm.categoryId}
          onChange={(event) => setExpenseForm({ ...expenseForm, categoryId: event.target.value })}
        >
          <option value="">Choose category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          value={expenseForm.platform}
          onChange={(event) =>
            setExpenseForm({
              ...expenseForm,
              platform: event.target.value as FinanceExpensePayload['platform'],
            })
          }
        >
          <option value="">Shared (both)</option>
          <option value="airstay">AirStay</option>
          <option value="fleet">Fleet</option>
        </select>
        <select
          value={expenseForm.frequency}
          onChange={(event) =>
            setExpenseForm({
              ...expenseForm,
              frequency: event.target.value as FinanceExpensePayload['frequency'],
            })
          }
        >
          <option value="one_time">One time</option>
          <option value="repeated">Repeated</option>
        </select>
        {expenseForm.frequency === 'repeated' && (
          <>
            <select
              value={expenseForm.endMonth || selectedMonth}
              onChange={(event) => setExpenseForm({ ...expenseForm, endMonth: Number(event.target.value) })}
            >
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>End {month.label}</option>
              ))}
            </select>
            <select
              value={expenseForm.endYear || selectedYear}
              onChange={(event) => setExpenseForm({ ...expenseForm, endYear: Number(event.target.value) })}
            >
              {yearOptions().map((year) => (
                <option key={year} value={year}>End {year}</option>
              ))}
            </select>
          </>
        )}
        <label className="form-checkbox-row" title="New expenses start unpaid until you mark them paid">
          <input
            checked={expenseForm.paid ?? false}
            type="checkbox"
            onChange={(event) => setExpenseForm({ ...expenseForm, paid: event.target.checked })}
          />
          Paid
        </label>
        <button className="primary-button" type="submit">Add expense</button>
      </form>

      <div className="pill-toggle-group" style={{ margin: '10px 0' }}>
        <button
          className={`pill-toggle${!unpaidOnly ? ' active' : ''}`}
          type="button"
          onClick={() => setUnpaidOnly(false)}
        >
          All
        </button>
        <button
          className={`pill-toggle${unpaidOnly ? ' active' : ''}`}
          type="button"
          onClick={() => setUnpaidOnly(true)}
        >
          Unpaid{unpaidCount > 0 ? ` (${unpaidCount})` : ''}
        </button>
      </div>

      <FinanceList
        rows={visibleExpenses}
        empty={unpaidOnly ? 'No unpaid expenses — everything is settled.' : 'No expenses for this month.'}
        onDelete={(id) => deleteFinanceExpense(id).then(onReload)}
        onEdit={onEdit}
        render={(expense) => (
          <>
            <div className="expense-category-dot-row">
              <span
                className="category-dot"
                style={{ background: expense.categoryColor || '#6b7280' }}
              />
              <strong>{expense.name}</strong>
              {expense.invoiceFileUrl && (
                <a
                  href={expense.invoiceFileUrl}
                  rel="noreferrer"
                  target="_blank"
                  title="View attached invoice"
                  style={{ display: 'inline-flex', color: 'var(--text-muted)' }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <FileText size={13} />
                </a>
              )}
            </div>
            <span>{expense.categoryName}</span>
            <span>{expense.frequency === 'repeated' ? 'Repeated' : 'One time'}</span>
            <span className={`finance-platform-badge${expense.platform ? ` platform-${expense.platform}` : ''}`}>
              {expense.platform === 'airstay' ? 'AirStay' : expense.platform === 'fleet' ? 'Fleet' : 'Shared'}
            </span>
            <button
              className={`payment-badge ${expense.paidForMonth ? 'paid' : 'unpaid'}`}
              style={{ border: 'none', cursor: 'pointer' }}
              title={
                expense.paidForMonth
                  ? 'Mark this month as unpaid'
                  : 'Mark this month as paid'
              }
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                togglePaid(expense)
              }}
            >
              {expense.paidForMonth ? 'Paid' : 'Unpaid'}
            </button>
            <strong>EUR {money(expense.amountEur)}</strong>
          </>
        )}
      />
    </article>
  )
}
