import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  createExpenseCategory,
  createFinanceExpense,
  deleteExpenseCategory,
  deleteFinanceExpense,
  updateExpenseCategory,
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
  })

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
      await createFinanceExpense(expenseForm)
      setExpenseForm((current) => ({ ...current, name: '', amountEur: '', notes: '', platform: '' }))
      await onReload()
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : 'Could not create expense.')
    }
  }

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
        <button className="primary-button" type="submit">Add expense</button>
      </form>
      <FinanceList
        rows={expenses}
        empty="No expenses for this month."
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
            </div>
            <span>{expense.categoryName}</span>
            <span>{expense.frequency === 'repeated' ? 'Repeated' : 'One time'}</span>
            <span className={`finance-platform-badge${expense.platform ? ` platform-${expense.platform}` : ''}`}>
              {expense.platform === 'airstay' ? 'AirStay' : expense.platform === 'fleet' ? 'Fleet' : 'Shared'}
            </span>
            <strong>EUR {money(expense.amountEur)}</strong>
          </>
        )}
      />
    </article>
  )
}
