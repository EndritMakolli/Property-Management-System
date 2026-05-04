import { Plus } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  createExpenseCategory,
  createFinanceExpense,
  createFinancialObligation,
  createLoan,
  deleteFinanceExpense,
  deleteFinancialObligation,
  deleteLoan,
  fetchExpenseCategories,
  fetchFinanceSummary,
  updateFinancialObligation,
  type FinanceExpensePayload,
  type FinancialObligationPayload,
  type LoanPayload,
} from '../api/pmsApi'
import { DateInput } from '../components/shared/DateInput'
import { Metric } from '../components/shared/Metric'
import { monthOptions, yearOptions } from '../features/reservations/monthOptions'
import type {
  ExpenseCategoryRecord,
  FinanceExpenseRecord,
  FinanceSummary,
  FinancialObligationRecord,
  LoanRecord,
} from '../types/domain'
import { formatDisplayDate } from '../utils/date'

const emptySummary: FinanceSummary = {
  turnoverEur: '0.00',
  expensesEur: '0.00',
  loanPaymentsEur: '0.00',
  profitEur: '0.00',
  profitAfterLoansEur: '0.00',
  totalDebtEur: '0.00',
}

export function FinancePage() {
  const today = new Date()
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [categories, setCategories] = useState<ExpenseCategoryRecord[]>([])
  const [expenses, setExpenses] = useState<FinanceExpenseRecord[]>([])
  const [loans, setLoans] = useState<LoanRecord[]>([])
  const [obligations, setObligations] = useState<FinancialObligationRecord[]>([])
  const [summary, setSummary] = useState<FinanceSummary>(emptySummary)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')

  const [expenseForm, setExpenseForm] = useState<FinanceExpensePayload>({
    name: '',
    categoryId: '',
    amountEur: '',
    frequency: 'one_time',
    startYear: selectedYear,
    startMonth: selectedMonth,
    endYear: null,
    endMonth: null,
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
      const [categoryRows, financeData] = await Promise.all([
        fetchExpenseCategories(),
        fetchFinanceSummary({ month: selectedMonth, year: selectedYear }),
      ])
      setCategories(categoryRows)
      setExpenses(financeData.expenses)
      setLoans(financeData.loans)
      setObligations(financeData.obligations)
      setSummary(financeData.summary)
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
    if (!newCategoryName.trim()) {
      return
    }

    try {
      const category = await createExpenseCategory({ name: newCategoryName })
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
      setExpenseForm((current) => ({ ...current, name: '', amountEur: '', notes: '' }))
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
      setObligationForm({
        companyName: '',
        description: '',
        amountEur: '',
        dueDate: '',
        paid: false,
        notes: '',
      })
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
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading finance...</p>}
      {status === 'error' && <p className="form-error">{error}</p>}
      {error && status === 'ready' && <p className="form-error">{error}</p>}

      <section className="metric-row finance-metrics">
        <Metric label="Turnover" value={`EUR ${money(summary.turnoverEur)}`} />
        <Metric label="Expenses" value={`EUR ${money(summary.expensesEur)}`} />
        <Metric label="Loans" value={`EUR ${money(summary.loanPaymentsEur)}`} />
        <Metric label="Profit" value={`EUR ${money(summary.profitEur)}`} />
        <Metric label="After loans" value={`EUR ${money(summary.profitAfterLoansEur)}`} />
        <Metric label="Total debt" value={`EUR ${money(summary.totalDebtEur)}`} />
      </section>

      <section className="finance-sections">
        <article className="panel finance-section">
          <h3>Expenses</h3>
          <div className="category-create">
            <input
              placeholder="New category, e.g. Wages"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
            />
            <button type="button" onClick={addCategory}>
              <Plus size={16} />
              Category
            </button>
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
                    <option key={month.value} value={month.value}>
                      End {month.label}
                    </option>
                  ))}
                </select>
                <select
                  value={expenseForm.endYear || selectedYear}
                  onChange={(event) => setExpenseForm({ ...expenseForm, endYear: Number(event.target.value) })}
                >
                  {yearOptions().map((year) => (
                    <option key={year} value={year}>
                      End {year}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button className="primary-button" type="submit">Add expense</button>
          </form>
          <FinanceList
            rows={expenses}
            empty="No expenses for this month."
            onDelete={(id) => deleteFinanceExpense(id).then(loadFinance)}
            render={(expense) => (
              <>
                <strong>{expense.name}</strong>
                <span>{expense.categoryName}</span>
                <span>{expense.frequency === 'repeated' ? 'Repeated' : 'One time'}</span>
                <strong>EUR {money(expense.amountEur)}</strong>
              </>
            )}
          />
        </article>

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
                <option key={month.value} value={month.value}>
                  Ends {month.label}
                </option>
              ))}
            </select>
            <select value={loanForm.endYear} onChange={(event) => setLoanForm({ ...loanForm, endYear: Number(event.target.value) })}>
              {yearOptions().map((year) => (
                <option key={year} value={year}>
                  Ends {year}
                </option>
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
                <span>
                  {monthName(loan.startMonth)} {loan.startYear} to {monthName(loan.endMonth)} {loan.endYear}
                </span>
                <strong>EUR {money(loan.monthlyValueEur)}</strong>
              </>
            )}
          />
        </article>

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
      </section>
    </section>
  )
}

type FinanceListProps<T extends { id: string }> = {
  empty: string
  onDelete: (id: string) => void
  render: (row: T) => ReactNode
  rows: T[]
}

function FinanceList<T extends { id: string }>({ empty, onDelete, render, rows }: FinanceListProps<T>) {
  if (rows.length === 0) {
    return <p className="list-empty">{empty}</p>
  }

  return (
    <div className="finance-list">
      {rows.map((row) => (
        <article className="finance-list-row" key={row.id}>
          <div>{render(row)}</div>
          <button type="button" onClick={() => onDelete(row.id)}>
            Delete
          </button>
        </article>
      ))}
    </div>
  )
}

function money(value: string) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })
}

function monthName(month: number) {
  return monthOptions.find((item) => item.value === month)?.label || ''
}
