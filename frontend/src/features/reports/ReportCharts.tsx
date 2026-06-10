import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ExpenseCategoryRecord, FinanceExpenseRecord, MonthlyTaxRecord } from '../../types/domain'
import { monthOptions, yearOptions } from '../reservations/monthOptions'
import { monthNames } from './reportCalculations'

// ── Expense helpers ────────────────────────────────────────────────────────

function periodNum(year: number, month: number) {
  return year * 12 + month
}

function expenseActiveForMonth(e: FinanceExpenseRecord, year: number, month: number): boolean {
  const selected = periodNum(year, month)
  const start = periodNum(e.startYear, e.startMonth)
  if (selected < start) return false
  if (e.frequency === 'one_time') return selected === start
  if (e.endYear !== null && e.endMonth !== null) return selected <= periodNum(e.endYear, e.endMonth)
  return true
}

const TAXES_KEY = 'Taxes'

type ExpensesYearlyChartProps = {
  allExpenses: FinanceExpenseRecord[]
  categories: ExpenseCategoryRecord[]
  taxes: MonthlyTaxRecord[]
  year: number
  platformId: 'airstay' | 'fleet'
  showTaxes: boolean
  taxesColor?: string
}

export function ExpensesYearlyChart({ allExpenses, categories, taxes, year, platformId, showTaxes, taxesColor = '#e53935' }: ExpensesYearlyChartProps) {
  const platformExpenses = allExpenses.filter(
    (e) => !e.platform || e.platform === platformId,
  )

  const activeCategories = categories.filter((cat) =>
    platformExpenses.some(
      (e) =>
        e.categoryId === cat.id &&
        monthNames.some((_, idx) => expenseActiveForMonth(e, year, idx + 1)),
    ),
  )

  const hasTaxData = showTaxes && taxes.some(
    (t) => t.year === year && (parseFloat(t.tvsh) > 0 || parseFloat(t.tatimNeFitim) > 0),
  )

  // All bar keys: categories + optional taxes at the top
  const allKeys = [...activeCategories.map((c) => c.name), ...(hasTaxData ? [TAXES_KEY] : [])]

  const data = monthNames.map((label, idx) => {
    const month = idx + 1
    const row: Record<string, string | number> = { label }
    for (const cat of activeCategories) {
      row[cat.name] = platformExpenses
        .filter((e) => e.categoryId === cat.id && expenseActiveForMonth(e, year, month))
        .reduce((sum, e) => sum + parseFloat(e.amountEur), 0)
    }
    if (hasTaxData) {
      const taxRecord = taxes.find((t) => t.year === year && t.month === month)
      row[TAXES_KEY] = taxRecord
        ? parseFloat(taxRecord.tvsh || '0') + parseFloat(taxRecord.tatimNeFitim || '0')
        : 0
    }
    return row
  })

  const total = data.reduce(
    (sum, row) => sum + allKeys.reduce((s, key) => s + ((row[key] as number) || 0), 0),
    0,
  )

  const isEmpty = activeCategories.length === 0 && !hasTaxData

  return (
    <section className="panel stats-chart-panel">
      <h3 className="stats-section-title">Monthly Expenses — {year}</h3>
      {isEmpty ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '12px 0' }}>
          No expenses recorded for {year}.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`}
                width={48}
              />
              <Tooltip formatter={(value, name) => [`EUR ${Number(value ?? 0).toLocaleString()}`, name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {activeCategories.map((cat, i) => (
                <Bar
                  key={cat.id}
                  dataKey={cat.name}
                  stackId="expenses"
                  fill={cat.color}
                  radius={!hasTaxData && i === activeCategories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
              {hasTaxData && (
                <Bar dataKey={TAXES_KEY} stackId="expenses" fill={taxesColor} radius={[4, 4, 0, 0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>
            Total {year}: EUR {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </>
      )}
    </section>
  )
}

type MonthlyRevenueRow = {
  label: string
  revenue: number
}

type OccupancyTrendRow = {
  date: string
  label: string
  pct: number
}

type CompareRevenueRow = {
  label: string
  primary: number
  secondary: number
}

type MonthlyRevenueChartProps = {
  data: MonthlyRevenueRow[]
  selectedYear: number
  today: Date
}

type DailyOccupancyChartProps = {
  data: OccupancyTrendRow[]
  month: number
  year: number
  onMonthChange: (month: number) => void
  onYearChange: (year: number) => void
}

type CompareRevenueChartProps = {
  data: CompareRevenueRow[]
  year: number
  primaryName: string
  secondaryName: string
}

export function MonthlyRevenueChart({ data, selectedYear, today }: MonthlyRevenueChartProps) {
  return (
    <section className="panel stats-chart-panel">
      <h3 className="stats-section-title">Monthly Revenue - {selectedYear}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`}
            width={48}
          />
          <Tooltip formatter={(value) => [`EUR ${Number(value ?? 0).toLocaleString()}`, 'Revenue']} />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.label === monthNames[today.getMonth()] ? '#1f6f5b' : '#56649a'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  )
}

export function DailyOccupancyChart({ data, month, year, onMonthChange, onYearChange }: DailyOccupancyChartProps) {
  return (
    <section className="panel stats-chart-panel">
      <div className="stats-section-header occupancy-header">
        <h3 className="stats-section-title">
          Daily Occupancy — {monthNames[month - 1]} {year}
        </h3>
        <div className="stay-duration-filters">
          <label>
            Month
            <select value={month} onChange={(e) => onMonthChange(Number(e.target.value))}>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select value={year} onChange={(e) => onYearChange(Number(e.target.value))}>
              {yearOptions().map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} width={45} domain={[0, 100]} />
          <Tooltip
            labelFormatter={(label) => `Day ${label}, ${monthNames[month - 1]} ${year}`}
            formatter={(value) => [`${Number(value ?? 0)}%`, 'Occupancy']}
          />
          <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.pct >= 100 ? '#9b3f20' : entry.pct >= 60 ? '#1f6f5b' : '#adc8be'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  )
}

export function CompareRevenueChart({ data, year, primaryName, secondaryName }: CompareRevenueChartProps) {
  return (
    <section className="panel stats-chart-panel">
      <h3 className="stats-section-title">Revenue Comparison — {year}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`}
            width={48}
          />
          <Tooltip
            formatter={(value, name) => [
              `EUR ${Number(value ?? 0).toLocaleString()}`,
              name === 'primary' ? primaryName : secondaryName,
            ]}
          />
          <Legend
            formatter={(value) => (value === 'primary' ? primaryName : secondaryName)}
          />
          <Bar dataKey="primary" name="primary" fill="#1f6f5b" radius={[4, 4, 0, 0]} />
          <Bar dataKey="secondary" name="secondary" fill="#56649a" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  )
}
