import { Printer } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  fetchAllFinanceExpenses,
  fetchExpenseCategories,
  fetchFinanceSummary,
  fetchTaxes,
} from '../api/pmsApi'
import { usePlatform } from '../context/PlatformContext'
import { ExpensesYearlyChart } from '../features/reports/ReportCharts'
import { Metric } from '../components/shared/Metric'
import { EditExpenseModal } from '../features/finance/EditExpenseModal'
import { ExpensesPanel } from '../features/finance/ExpensesPanel'
import { LoansPanel } from '../features/finance/LoansPanel'
import { ObligationsPanel } from '../features/finance/ObligationsPanel'
import { TaxesPanel } from '../features/finance/TaxesPanel'
import { dec, money } from '../features/finance/financeUtils'
import { monthOptions, yearOptions } from '../features/reservations/monthOptions'
import type {
  ExpenseCategoryRecord,
  FinanceExpenseRecord,
  FinanceSummary,
  FinancialObligationRecord,
  LoanRecord,
  MonthlyTaxRecord,
} from '../types/domain'

const emptySummary: FinanceSummary = {
  airstay: { turnoverEur: '0.00', expensesEur: '0.00', profitEur: '0.00' },
  fleet: { turnoverEur: '0.00', expensesEur: '0.00', profitEur: '0.00' },
  loanPaymentsEur: '0.00',
  totalDebtEur: '0.00',
}

const TAXES_VIRTUAL_ID = '__taxes__'

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
  const [refreshKey, setRefreshKey] = useState(0)
  const [taxesColor, setTaxesColor] = useState('#e53935')
  const [editingExpense, setEditingExpense] = useState<FinanceExpenseRecord | null>(null)
  const [excludedCategoryIds, setExcludedCategoryIds] = useState<string[]>([])

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
      setRefreshKey((key) => key + 1)
      setStatus('ready')
    } catch (caughtError) {
      setStatus('error')
      setError(caughtError instanceof Error ? caughtError.message : 'Could not load finance data.')
    }
  }, [selectedMonth, selectedYear])

  useEffect(() => {
    loadFinance()
  }, [loadFinance])

  function toggleExcludeCategory(id: string) {
    setExcludedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  const currentTax = taxes.find((t) => t.year === selectedYear && t.month === selectedMonth)
  const monthLabel = monthOptions.find((m) => m.value === selectedMonth)?.label || selectedMonth

  const excludedCategorySet = new Set(excludedCategoryIds)
  const taxesExcluded = excludedCategorySet.has(TAXES_VIRTUAL_ID)
  const visibleAllExpenses = allExpenses.filter((e) => !excludedCategorySet.has(e.categoryId))
  const visibleExpenses = expenses.filter((e) => !excludedCategorySet.has(e.categoryId))

  const platformSummary = summary[platform.id]
  const turnover = dec(platformSummary.turnoverEur)
  const loanPayments = dec(summary.loanPaymentsEur)
  const excludedAmount = expenses
    .filter((e) => excludedCategorySet.has(e.categoryId) && (!e.platform || e.platform === platform.id))
    .reduce((sum, e) => sum + dec(e.amountEur), 0)
  const expensesTotal = dec(platformSummary.expensesEur) - excludedAmount
  const taxesTotal = dec(currentTax?.tvsh ?? '0') + dec(currentTax?.tatimNeFitim ?? '0')
  const netProfit = turnover - expensesTotal - taxesTotal
  const netProfitAfterLoans = netProfit - loanPayments

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

      <section className="metric-row finance-metrics">
        <Metric label="Turnover" value={`EUR ${money(turnover.toFixed(2))}`} />
        <Metric label="Expenses" value={`EUR ${money(expensesTotal.toFixed(2))}`} />
        <Metric label={`Taxes (${monthLabel})`} value={`EUR ${money(taxesTotal.toFixed(2))}`} />
        <Metric label="Net Profit" value={`EUR ${money(netProfit.toFixed(2))}`} />
        <Metric label="Net Profit – Loans" value={`EUR ${money(netProfitAfterLoans.toFixed(2))}`} />
        <Metric label="Total Debt" value={`EUR ${money(summary.totalDebtEur)}`} />
        <Metric label="Loans" value={`EUR ${money(summary.loanPaymentsEur)}`} />
      </section>

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
        <ExpensesPanel
          categories={categories}
          setCategories={setCategories}
          expenses={visibleExpenses.filter((e) => !e.platform || e.platform === platform.id)}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onReload={loadFinance}
          onError={setError}
          onEdit={setEditingExpense}
        />

        <LoansPanel
          loans={loans}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onReload={loadFinance}
          onError={setError}
        />

        <ObligationsPanel obligations={obligations} onReload={loadFinance} onError={setError} />

        <TaxesPanel
          taxes={taxes}
          setTaxes={setTaxes}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          monthLabel={monthLabel}
          refreshKey={refreshKey}
          onError={setError}
        />
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
