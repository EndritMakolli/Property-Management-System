import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchExpenseAnalytics, type ExpenseAnalyticsQuery } from '../../api/pmsApi'
import type { ExpenseAnalytics, ExpenseAnalyticsEntry } from '../../types/domain'
import { monthNames } from '../reports/reportCalculations'
import { money } from './financeUtils'

const PAID_COLOR = '#1f6f5b'
const UNPAID_COLOR = '#c26a3f'
const TAX_COLOR = '#9b3f20'

type PeriodMode = 'month' | 'year' | 'all' | 'custom'
type TopTab = 'expenses' | 'categories' | 'recurring'

function euro(value: number) {
  return `EUR ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function monthKeyLabel(year: number, month: number, withYear: boolean) {
  return withYear ? `${monthNames[month - 1]} ${String(year).slice(2)}` : monthNames[month - 1]
}

export function ExpenseAnalyticsSection({
  selectedYear,
  selectedMonth,
  refreshKey,
}: {
  selectedYear: number
  selectedMonth: number
  refreshKey: number
}) {
  const [periodMode, setPeriodMode] = useState<PeriodMode>('year')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [data, setData] = useState<ExpenseAnalytics | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [topTab, setTopTab] = useState<TopTab>('expenses')

  useEffect(() => {
    let query: ExpenseAnalyticsQuery
    if (periodMode === 'month') {
      const key = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
      query = { start: key, end: key }
    } else if (periodMode === 'year') {
      query = { year: selectedYear }
    } else if (periodMode === 'all') {
      query = { all: true }
    } else {
      if (!customStart || !customEnd) return
      query = { start: customStart, end: customEnd }
    }

    let ignore = false
    setStatus('loading')
    setError('')
    fetchExpenseAnalytics(query)
      .then((result) => {
        if (!ignore) {
          setData(result)
          setStatus('ready')
        }
      })
      .catch((caught) => {
        if (!ignore) {
          setStatus('error')
          setError(caught instanceof Error ? caught.message : 'Could not load expense analytics.')
        }
      })
    return () => {
      ignore = true
    }
  }, [periodMode, customStart, customEnd, selectedYear, selectedMonth, refreshKey])

  const months = useMemo(() => data?.months ?? [], [data])
  const spansYears = months.length > 0 && months[0].year !== months[months.length - 1].year

  // Category donut slices for the whole period.
  const categorySlices = useMemo(() => {
    if (!data) return []
    return data.topCategories
      .map((cat) => ({ ...cat, value: Number(cat.totalEur) }))
      .filter((cat) => cat.value > 0)
  }, [data])
  const periodTotal = categorySlices.reduce((sum, row) => sum + row.value, 0)

  // Monthly series for one selected category (the drill-down view).
  const categorySeries = useMemo(() => {
    if (!categoryFilter) return []
    return months.map((row) => ({
      label: monthKeyLabel(row.year, row.month, spansYears),
      value: Number(row.byCategory[categoryFilter] ?? 0),
    }))
  }, [months, categoryFilter, spansYears])
  const categoryTotal = categorySeries.reduce((sum, row) => sum + row.value, 0)
  const selectedCategory = data?.categories.find((cat) => cat.id === categoryFilter)

  const paidSeries = useMemo(
    () =>
      months.map((row) => ({
        label: monthKeyLabel(row.year, row.month, spansYears),
        Paid: Number(row.paidEur),
        Unpaid: Number(row.unpaidEur),
      })),
    [months, spansYears],
  )

  const taxSeries = useMemo(
    () =>
      months.map((row) => ({
        label: monthKeyLabel(row.year, row.month, spansYears),
        Taxes: Number(row.taxesEur),
      })),
    [months, spansYears],
  )
  const taxTotal = taxSeries.reduce((sum, row) => sum + row.Taxes, 0)

  const periodLabel =
    periodMode === 'month'
      ? `${monthNames[selectedMonth - 1]} ${selectedYear}`
      : periodMode === 'year'
        ? String(selectedYear)
        : periodMode === 'all'
          ? 'All time'
          : data
            ? `${data.start} → ${data.end}`
            : 'Custom range'

  const topRows: ExpenseAnalyticsEntry[] =
    topTab === 'expenses' ? (data?.topExpenses ?? []) : topTab === 'recurring' ? (data?.topRecurring ?? []) : []

  return (
    <section className="panel expense-analytics-panel">
      <div className="stats-section-header">
        <h3 className="stats-section-title">Expense analytics — {periodLabel}</h3>
        <div className="expense-period-controls">
          <div className="pill-toggle-group">
            {(
              [
                ['month', 'Month'],
                ['year', 'Year'],
                ['all', 'All time'],
                ['custom', 'Custom'],
              ] as [PeriodMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                className={`pill-toggle${periodMode === mode ? ' active' : ''}`}
                type="button"
                onClick={() => setPeriodMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {periodMode === 'custom' && (
            <span className="expense-custom-range">
              <input
                aria-label="Range start"
                type="month"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              →
              <input
                aria-label="Range end"
                type="month"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </span>
          )}
        </div>
      </div>

      {periodMode === 'custom' && (!customStart || !customEnd) && (
        <p className="list-empty">Pick a start and end month to load the custom range.</p>
      )}
      {status === 'loading' && <p className="list-empty">Loading analytics…</p>}
      {status === 'error' && <p className="form-error">{error}</p>}

      {status === 'ready' && data && (
        <>
          <div className="expense-analytics-grid">
            {/* Expenses by Category — donut, or one category's monthly trend */}
            <div className="expense-chart-cell">
              <div className="expense-chart-head">
                <h4>Expenses by category</h4>
                <select
                  aria-label="Category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">All categories</option>
                  {data.categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              {categoryFilter ? (
                categoryTotal === 0 ? (
                  <p className="list-empty">No spending in this category for {periodLabel}.</p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={categorySeries}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value) => euro(Number(value))} />
                        <Bar
                          dataKey="value"
                          fill={selectedCategory?.color || '#6b7280'}
                          name={selectedCategory?.name || 'Category'}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                    <p className="expense-chart-footer">
                      {selectedCategory?.name}: <strong>{euro(categoryTotal)}</strong> in {periodLabel}
                    </p>
                  </>
                )
              ) : categorySlices.length === 0 ? (
                <p className="list-empty">No expenses in this period yet.</p>
              ) : (
                <div className="insight-donut-wrap">
                  <div className="insight-donut">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          cx="50%"
                          cy="50%"
                          data={categorySlices}
                          dataKey="value"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={2}
                          stroke="var(--bg-panel)"
                          strokeWidth={2}
                        >
                          {categorySlices.map((entry) => (
                            <Cell fill={entry.color} key={entry.id} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [
                            `${euro(Number(value))} (${periodTotal > 0 ? Math.round((Number(value) / periodTotal) * 100) : 0}%)`,
                            name,
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="insight-donut-center">
                      <strong>{euro(periodTotal)}</strong>
                      <span>total expenses</span>
                    </div>
                  </div>
                  <div className="chart-legend">
                    {categorySlices.map((entry) => (
                      <span key={entry.id}>
                        <i style={{ background: entry.color }} /> {entry.name} — {euro(entry.value)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Paid vs Unpaid by month */}
            <div className="expense-chart-cell">
              <div className="expense-chart-head">
                <h4>Paid vs unpaid by month</h4>
              </div>
              {paidSeries.every((row) => row.Paid === 0 && row.Unpaid === 0) ? (
                <p className="list-empty">No expenses in this period yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={paidSeries}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => euro(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Paid" fill={PAID_COLOR} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Unpaid" fill={UNPAID_COLOR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Taxes by month */}
            <div className="expense-chart-cell">
              <div className="expense-chart-head">
                <h4>Taxes by month</h4>
              </div>
              {taxTotal === 0 ? (
                <p className="list-empty">No taxes recorded for this period.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={taxSeries}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(value) => euro(Number(value))} />
                      <Bar dataKey="Taxes" fill={TAX_COLOR} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="expense-chart-footer">
                    Total taxes: <strong>{euro(taxTotal)}</strong> in {periodLabel}
                  </p>
                </>
              )}
            </div>

            {/* Top expenses / categories / recurring */}
            <div className="expense-chart-cell">
              <div className="expense-chart-head">
                <h4>Top spending</h4>
                <div className="pill-toggle-group">
                  {(
                    [
                      ['expenses', 'Expenses'],
                      ['categories', 'Categories'],
                      ['recurring', 'Recurring'],
                    ] as [TopTab, string][]
                  ).map(([tab, label]) => (
                    <button
                      key={tab}
                      className={`pill-toggle${topTab === tab ? ' active' : ''}`}
                      type="button"
                      onClick={() => setTopTab(tab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {topTab === 'categories' ? (
                data.topCategories.length === 0 ? (
                  <p className="list-empty">No expenses in this period yet.</p>
                ) : (
                  <ol className="expense-top-list">
                    {data.topCategories.slice(0, 10).map((cat) => (
                      <li key={cat.id}>
                        <span className="category-dot" style={{ background: cat.color }} />
                        <span className="expense-top-name">{cat.name}</span>
                        <strong>EUR {money(cat.totalEur)}</strong>
                      </li>
                    ))}
                  </ol>
                )
              ) : topRows.length === 0 ? (
                <p className="list-empty">
                  {topTab === 'recurring'
                    ? 'No recurring expenses in this period.'
                    : 'No expenses in this period yet.'}
                </p>
              ) : (
                <ol className="expense-top-list">
                  {topRows.slice(0, 10).map((row) => (
                    <li key={row.id}>
                      <span className="category-dot" style={{ background: row.categoryColor }} />
                      <span className="expense-top-name">
                        {row.name}
                        <small>
                          {row.categoryName}
                          {row.frequency === 'repeated'
                            ? ` · EUR ${money(row.amountEur)}/month × ${row.monthsActive}`
                            : ''}
                        </small>
                      </span>
                      <strong>EUR {money(row.totalEur)}</strong>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
