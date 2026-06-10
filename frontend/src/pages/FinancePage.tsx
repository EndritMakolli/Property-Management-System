import { Pencil, Plus, Printer, Trash2, X } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  createExpenseCategory,
  createFinanceExpense,
  createFinancialObligation,
  createLoan,
  deleteExpenseCategory,
  updateExpenseCategory,
  deleteFinanceExpense,
  deleteFinancialObligation,
  deleteLoan,
  deleteTax,
  fetchAllFinanceExpenses,
  fetchExpenseCategories,
  fetchFinanceSummary,
  fetchTaxes,
  updateFinanceExpense,
  updateFinancialObligation,
  upsertTax,
  type FinanceExpensePayload,
  type FinancialObligationPayload,
  type LoanPayload,
  type MonthlyTaxPayload,
} from '../api/pmsApi'
import { usePlatform } from '../context/PlatformContext'
import { ExpensesYearlyChart } from '../features/reports/ReportCharts'
import { DateInput } from '../components/shared/DateInput'
import { Metric } from '../components/shared/Metric'
import { monthOptions, yearOptions } from '../features/reservations/monthOptions'
import type {
  ExpenseCategoryRecord,
  FinanceExpenseRecord,
  FinanceSummary,
  FinancialObligationRecord,
  LoanRecord,
  MonthlyTaxRecord,
} from '../types/domain'
import { formatDisplayDate } from '../utils/date'

const emptySummary: FinanceSummary = {
  airstay: { turnoverEur: '0.00', expensesEur: '0.00', profitEur: '0.00' },
  fleet: { turnoverEur: '0.00', expensesEur: '0.00', profitEur: '0.00' },
  loanPaymentsEur: '0.00',
  totalDebtEur: '0.00',
}

export function FinancePage() {
  const { platform } = usePlatform()
  const today = new Date()
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [categories, setCategories] = useState<ExpenseCategoryRecord[]>([])
  const [expenses, setExpenses] = useState<FinanceExpenseRecord[]>([])
  const [allExpenses, setAllExpenses] = useState<FinanceExpenseRecord[]>([])
  const [loans, setLoans] = useState<LoanRecord[]>([])
  const [obligations, setObligations] = useState<FinancialObligationRecord[]>([])
  const [summary, setSummary] = useState<FinanceSummary>(emptySummary)
  const [taxes, setTaxes] = useState<MonthlyTaxRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#6b7280')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [taxesColor, setTaxesColor] = useState('#e53935')
  const [taxDraft, setTaxDraft] = useState({ tvsh: '', tatimNeFitim: '', notes: '' })
  const [savingTax, setSavingTax] = useState(false)

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
  const [loanForm, setLoanForm] = useState<LoanPayload>({
    name: '',
    monthlyValueEur: '',
    startYear: selectedYear,
    startMonth: selectedMonth,
    endYear: selectedYear,
    endMonth: selectedMonth,
    notes: '',
  })
  const [obligationForm, setObligationForm] = useState<FinancialObligationPayload>({
    companyName: '',
    description: '',
    amountEur: '',
    dueDate: '',
    paid: false,
    notes: '',
  })

  const loadFinance = useCallback(async () => {
    try {
      setStatus('loading')
      setError('')
      const [categoryRows, financeData, taxRows, allExpenseRows] = await Promise.all([
        fetchExpenseCategories(),
        fetchFinanceSummary({ month: selectedMonth, year: selectedYear }),
        fetchTaxes(),
        fetchAllFinanceExpenses(),
      ])
      setCategories(categoryRows)
      setExpenses(financeData.expenses)
      setAllExpenses(allExpenseRows)
      setLoans(financeData.loans)
      setObligations(financeData.obligations)
      setSummary(financeData.summary)
      setTaxes(taxRows)
      setExpenseForm((current) => ({
        ...current,
        categoryId: current.categoryId || categoryRows[0]?.id || '',
        startYear: selectedYear,
        startMonth: selectedMonth,
      }))
      setLoanForm((current) => ({
        ...current,
        startYear: selectedYear,
        startMonth: selectedMonth,
        endYear: Math.max(current.endYear, selectedYear),
      }))

      // Pre-fill tax draft if record exists for selected month
      const existingTax = taxRows.find(
        (t) => t.year === selectedYear && t.month === selectedMonth,
      )
      setTaxDraft({
        tvsh: existingTax?.tvsh || '',
        tatimNeFitim: existingTax?.tatimNeFitim || '',
        notes: existingTax?.notes || '',
      })

      setStatus('ready')
    } catch (caughtError) {
      setStatus('error')
      setError(caughtError instanceof Error ? caughtError.message : 'Could not load finance data.')
    }
  }, [selectedMonth, selectedYear])

  useEffect(() => {
    loadFinance()
  }, [loadFinance])

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
      setError(caughtError instanceof Error ? caughtError.message : 'Could not create category.')
    }
  }

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await createFinanceExpense(expenseForm)
      setExpenseForm((current) => ({ ...current, name: '', amountEur: '', notes: '', platform: '' }))
      await loadFinance()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not create expense.')
    }
  }

  async function addLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await createLoan(loanForm)
      setLoanForm((current) => ({ ...current, name: '', monthlyValueEur: '', notes: '' }))
      await loadFinance()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not create loan.')
    }
  }

  async function addObligation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await createFinancialObligation(obligationForm)
      setObligationForm({ companyName: '', description: '', amountEur: '', dueDate: '', paid: false, notes: '' })
      await loadFinance()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not create obligation.')
    }
  }

  async function toggleObligationPaid(obligation: FinancialObligationRecord) {
    await updateFinancialObligation(obligation.id, {
      companyName: obligation.companyName,
      description: obligation.description,
      amountEur: obligation.amountEur,
      dueDate: obligation.dueDate,
      paid: !obligation.paid,
      notes: obligation.notes,
    })
    await loadFinance()
  }

  async function saveTax() {
    setSavingTax(true)
    try {
      const payload: MonthlyTaxPayload = {
        year: selectedYear,
        month: selectedMonth,
        tvsh: taxDraft.tvsh || '0',
        tatimNeFitim: taxDraft.tatimNeFitim || '0',
        notes: taxDraft.notes,
      }
      const updated = await upsertTax(payload)
      setTaxes((prev) => {
        const exists = prev.find((t) => t.year === selectedYear && t.month === selectedMonth)
        if (exists) return prev.map((t) => (t.id === updated.id ? updated : t))
        return [...prev, updated]
      })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not save tax record.')
    } finally {
      setSavingTax(false)
    }
  }

  async function deleteTaxRecord(id: string) {
    await deleteTax(id)
    setTaxes((prev) => prev.filter((t) => t.id !== id))
    setTaxDraft({ tvsh: '', tatimNeFitim: '', notes: '' })
  }

  const currentTax = taxes.find((t) => t.year === selectedYear && t.month === selectedMonth)
  const monthLabel = monthOptions.find((m) => m.value === selectedMonth)?.label || selectedMonth
  const [editingExpense, setEditingExpense] = useState<FinanceExpenseRecord | null>(null)

  const TAXES_VIRTUAL_ID = '__taxes__'
  const [excludedCategoryIds, setExcludedCategoryIds] = useState<string[]>([])

  function toggleExcludeCategory(id: string) {
    setExcludedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  const excludedCategorySet = new Set(excludedCategoryIds)
  const taxesExcluded = excludedCategorySet.has(TAXES_VIRTUAL_ID)
  const visibleAllExpenses = allExpenses.filter((e) => !excludedCategorySet.has(e.categoryId))
  const visibleExpenses = expenses.filter((e) => !excludedCategorySet.has(e.categoryId))

  return (
    <section className="finance-page">
      <div className="finance-header">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>Monthly finance window</h2>
        </div>
        <div className="finance-period-controls">
          <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
            {yearOptions().map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
            {monthOptions.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
          <button
            className="icon-row-button"
            title="Print / export to PDF"
            type="button"
            onClick={() => window.print()}
          >
            <Printer size={15} />
            Export PDF
          </button>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading finance...</p>}
      {status === 'error' && <p className="form-error">{error}</p>}
      {error && status === 'ready' && <p className="form-error">{error}</p>}

      {(() => {
        const ps = summary[platform.id]
        const turnover = dec(ps.turnoverEur)
        const loans = dec(summary.loanPaymentsEur)
        const excludedAmount = expenses
          .filter((e) => excludedCategorySet.has(e.categoryId) && (!e.platform || e.platform === platform.id))
          .reduce((sum, e) => sum + dec(e.amountEur), 0)
        const expensesTotal = dec(ps.expensesEur) - excludedAmount
        const profit = turnover - expensesTotal
        const profitAfterLoans = profit - loans
        const taxes = dec(currentTax?.tvsh ?? '0') + dec(currentTax?.tatimNeFitim ?? '0')
        const net = profitAfterLoans - taxes
        return (
          <section className="metric-row finance-metrics">
            <Metric label="Turnover" value={`EUR ${money(String(turnover.toFixed(2)))}`} />
            <Metric label="Expenses" value={`EUR ${money(String(expensesTotal.toFixed(2)))}`} />
            <Metric label="Profit" value={`EUR ${money(String(profit.toFixed(2)))}`} />
            <Metric label="Loans" value={`EUR ${money(summary.loanPaymentsEur)}`} />
            <Metric label="Profit – Loans" value={`EUR ${money(String(profitAfterLoans.toFixed(2)))}`} />
            <Metric label={`Taxes (${monthLabel})`} value={`EUR ${money(String(taxes.toFixed(2)))}`} />
            <Metric label="Net Profit" value={`EUR ${money(String(net.toFixed(2)))}`} />
            <Metric label="Total Debt" value={`EUR ${money(summary.totalDebtEur)}`} />
          </section>
        )
      })()}

      {(categories.length > 0 || taxes.length > 0) && (
        <section className="panel exclusions-panel">
          <div className="stats-section-header">
            <h3 className="stats-section-title">Exclude from chart</h3>
            {excludedCategoryIds.length > 0 && (
              <button className="action-link" type="button" onClick={() => setExcludedCategoryIds([])}>
                Clear
              </button>
            )}
          </div>
          <div className="excluded-apartment-grid">
            {categories.map((cat) => (
              <label className="excluded-apartment-option" key={cat.id}>
                <input
                  type="checkbox"
                  checked={excludedCategorySet.has(cat.id)}
                  onChange={() => toggleExcludeCategory(cat.id)}
                />
                <span className="category-dot" style={{ background: cat.color, display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 4 }} />
                <span>{cat.name}</span>
              </label>
            ))}
            <label className="excluded-apartment-option">
              <input
                type="checkbox"
                checked={taxesExcluded}
                onChange={() => toggleExcludeCategory(TAXES_VIRTUAL_ID)}
              />
              <input
                type="color"
                value={taxesColor}
                title="Change taxes color"
                className="category-color-btn"
                style={{ width: 10, height: 10 }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setTaxesColor(e.target.value)}
              />
              <span>Taxes</span>
            </label>
          </div>
        </section>
      )}

      <ExpensesYearlyChart
        allExpenses={visibleAllExpenses}
        categories={categories.filter((c) => !excludedCategorySet.has(c.id))}
        taxes={taxes}
        year={selectedYear}
        platformId={platform.id}
        showTaxes={!taxesExcluded}
        taxesColor={taxesColor}
      />

      <section className="finance-sections">
        {/* ── Expenses ── */}
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
                        setError('Could not update category color.')
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
                          setError('Could not update category name.')
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
                        setError(e instanceof Error ? e.message : 'Could not delete category.')
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
            rows={visibleExpenses.filter((e) => !e.platform || e.platform === platform.id)}
            empty="No expenses for this month."
            onDelete={(id) => deleteFinanceExpense(id).then(loadFinance)}
            onEdit={(expense) => setEditingExpense(expense)}
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

        {/* ── Loans ── */}
        <article className="panel finance-section">
          <h3>Loans</h3>
          <form className="finance-form" onSubmit={addLoan}>
            <input
              required
              placeholder="Loan name"
              value={loanForm.name}
              onChange={(event) => setLoanForm({ ...loanForm, name: event.target.value })}
            />
            <input
              required
              min="0"
              placeholder="Monthly value"
              step="0.01"
              type="number"
              value={loanForm.monthlyValueEur}
              onChange={(event) => setLoanForm({ ...loanForm, monthlyValueEur: event.target.value })}
            />
            <select value={loanForm.endMonth} onChange={(event) => setLoanForm({ ...loanForm, endMonth: Number(event.target.value) })}>
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>Ends {month.label}</option>
              ))}
            </select>
            <select value={loanForm.endYear} onChange={(event) => setLoanForm({ ...loanForm, endYear: Number(event.target.value) })}>
              {yearOptions().map((year) => (
                <option key={year} value={year}>Ends {year}</option>
              ))}
            </select>
            <button className="primary-button" type="submit">Add loan</button>
          </form>
          <FinanceList
            rows={loans}
            empty="No active loans for this month."
            onDelete={(id) => deleteLoan(id).then(loadFinance)}
            render={(loan) => (
              <>
                <strong>{loan.name}</strong>
                <span>{monthName(loan.startMonth)} {loan.startYear} to {monthName(loan.endMonth)} {loan.endYear}</span>
                <strong>EUR {money(loan.monthlyValueEur)}</strong>
              </>
            )}
          />
        </article>

        {/* ── Financial Obligations ── */}
        <article className="panel finance-section">
          <h3>Financial Obligations</h3>
          <form className="finance-form" onSubmit={addObligation}>
            <input
              required
              placeholder="Company"
              value={obligationForm.companyName}
              onChange={(event) => setObligationForm({ ...obligationForm, companyName: event.target.value })}
            />
            <input
              placeholder="Description"
              value={obligationForm.description}
              onChange={(event) => setObligationForm({ ...obligationForm, description: event.target.value })}
            />
            <input
              required
              min="0"
              placeholder="Debt value"
              step="0.01"
              type="number"
              value={obligationForm.amountEur}
              onChange={(event) => setObligationForm({ ...obligationForm, amountEur: event.target.value })}
            />
            <DateInput ariaLabel="Due date" value={obligationForm.dueDate} onChange={(value) => setObligationForm({ ...obligationForm, dueDate: value })} />
            <button className="primary-button" type="submit">Add obligation</button>
          </form>
          <FinanceList
            rows={obligations}
            empty="No obligations yet."
            onDelete={(id) => deleteFinancialObligation(id).then(loadFinance)}
            render={(obligation) => (
              <>
                <strong>{obligation.companyName}</strong>
                <span>{obligation.description || 'No description'}</span>
                <span>{obligation.dueDate ? formatDisplayDate(obligation.dueDate) : 'No due date'}</span>
                <span>{obligation.paid ? 'Paid' : 'Unpaid'}</span>
                <strong>EUR {money(obligation.amountEur)}</strong>
                <button type="button" onClick={() => toggleObligationPaid(obligation)}>
                  {obligation.paid ? 'Mark unpaid' : 'Mark paid'}
                </button>
              </>
            )}
          />
        </article>

        {/* ── Taxes ── */}
        <article className="panel finance-section">
          <h3>Taxes — {monthLabel} {selectedYear}</h3>
          <div className="tax-form">
            <label>
              TVSH (VAT)
              <input
                min="0"
                placeholder="0.00"
                step="0.01"
                type="number"
                value={taxDraft.tvsh}
                onChange={(e) => setTaxDraft((d) => ({ ...d, tvsh: e.target.value }))}
              />
            </label>
            <label>
              Tatim në Fitim (Profit Tax)
              <input
                min="0"
                placeholder="0.00"
                step="0.01"
                type="number"
                value={taxDraft.tatimNeFitim}
                onChange={(e) => setTaxDraft((d) => ({ ...d, tatimNeFitim: e.target.value }))}
              />
            </label>
            <label>
              Notes
              <input
                placeholder="Optional notes"
                type="text"
                value={taxDraft.notes}
                onChange={(e) => setTaxDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </label>
            <div className="tax-form-actions">
              <button
                className="primary-button"
                disabled={savingTax}
                type="button"
                onClick={saveTax}
              >
                {savingTax ? 'Saving...' : currentTax ? 'Update taxes' : 'Save taxes'}
              </button>
              {currentTax && (
                <button
                  type="button"
                  onClick={() => deleteTaxRecord(currentTax.id)}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {taxes.length > 0 && (
            <div className="tax-history">
              <h4>Tax history</h4>
              <table className="tax-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>TVSH</th>
                    <th>Tatim në Fitim</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {taxes
                    .slice()
                    .sort((a, b) => b.year - a.year || b.month - a.month)
                    .map((tax) => (
                      <tr key={tax.id} className={tax.year === selectedYear && tax.month === selectedMonth ? 'tax-row-current' : ''}>
                        <td>{monthName(tax.month)} {tax.year}</td>
                        <td>EUR {money(tax.tvsh)}</td>
                        <td>EUR {money(tax.tatimNeFitim)}</td>
                        <td>{tax.notes || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>

      {editingExpense && (
        <EditExpenseModal
          expense={editingExpense}
          categories={categories}
          onClose={() => setEditingExpense(null)}
          onSaved={() => { setEditingExpense(null); loadFinance() }}
        />
      )}
    </section>
  )
}

type FinanceListProps<T extends { id: string }> = {
  empty: string
  onDelete: (id: string) => void
  onEdit?: (row: T) => void
  render: (row: T) => ReactNode
  rows: T[]
}

function FinanceList<T extends { id: string }>({ empty, onDelete, onEdit, render, rows }: FinanceListProps<T>) {
  if (rows.length === 0) {
    return <p className="list-empty">{empty}</p>
  }

  return (
    <div className="finance-list">
      {rows.map((row) => (
        <article className="finance-list-row" key={row.id}>
          <div>{render(row)}</div>
          <div className="finance-list-actions">
            {onEdit && (
              <button type="button" title="Edit" onClick={() => onEdit(row)}>
                <Pencil size={13} />
              </button>
            )}
            <button type="button" onClick={() => onDelete(row.id)}>
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

function EditExpenseModal({
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

  async function handleSubmit(e: React.FormEvent) {
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
          <label style={{ display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 }}>
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              style={{ minHeight: 38, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 }}>
              Amount (EUR)
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.amountEur}
                onChange={(e) => setForm({ ...form, amountEur: e.target.value })}
                style={{ minHeight: 38, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 }}>
              Category
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                style={{ minHeight: 38, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              >
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 }}>
              Business
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value as FinanceExpensePayload['platform'] })}
                style={{ minHeight: 38, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              >
                <option value="">Shared (both)</option>
                <option value="airstay">AirStay</option>
                <option value="fleet">Fleet</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 }}>
              Frequency
              <select
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as FinanceExpensePayload['frequency'] })}
                style={{ minHeight: 38, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              >
                <option value="one_time">One time</option>
                <option value="repeated">Repeated</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            {(['startMonth', 'startYear'] as const).map((field) => (
              <label key={field} style={{ display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 }}>
                {field === 'startMonth' ? 'Start month' : 'Start year'}
                <select
                  value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: Number(e.target.value) })}
                  style={{ minHeight: 38, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                >
                  {field === 'startMonth'
                    ? monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)
                    : yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            ))}
            {form.frequency === 'repeated' && (['endMonth', 'endYear'] as const).map((field) => (
              <label key={field} style={{ display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 }}>
                {field === 'endMonth' ? 'End month' : 'End year'}
                <select
                  value={form[field] ?? (field === 'endMonth' ? form.startMonth : form.startYear)}
                  onChange={(e) => setForm({ ...form, [field]: Number(e.target.value) })}
                  style={{ minHeight: 38, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                >
                  {field === 'endMonth'
                    ? monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)
                    : yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            ))}
          </div>
          <label style={{ display: 'grid', gap: 5, fontSize: '0.84rem', fontWeight: 700 }}>
            Notes
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={{ minHeight: 38, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
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

function money(value: string) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })
}

function dec(value: string | undefined) {
  return parseFloat(value || '0') || 0
}

function monthName(month: number) {
  return monthOptions.find((item) => item.value === month)?.label || ''
}
