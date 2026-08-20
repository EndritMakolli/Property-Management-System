import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import {
  adrByMonth,
  occupancyByMonth,
  platformRevenue,
} from './insightCalculations'
import { monthNames, type PropertyReportStat } from './reportCalculations'

const GREEN = '#1f6f5b'
const GREY = '#9bb8ad'

function euro(value: number) {
  return `EUR ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

/* (a) Revenue split by platform */

export function PlatformRevenueDonut({
  reservations,
  year,
  month,
}: {
  reservations: ReservationRecord[]
  year: number
  month: number
}) {
  const data = platformRevenue(reservations, year, month)
  const total = data.reduce((sum, row) => sum + row.value, 0)

  if (data.length === 0) {
    return <p className="list-empty">No revenue in this period yet.</p>
  }

  return (
    <div className="insight-donut-wrap">
      <div className="insight-donut">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              cx="50%"
              cy="50%"
              data={data}
              dataKey="value"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              stroke="var(--bg-panel)"
              strokeWidth={2}
            >
              {data.map((entry) => (
                <Cell fill={entry.color} key={entry.key} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [
                `${euro(Number(value))} (${total > 0 ? Math.round((Number(value) / total) * 100) : 0}%)`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="insight-donut-center">
          <strong>{euro(total)}</strong>
          <span>total revenue</span>
        </div>
      </div>
      <div className="chart-legend">
        {data.map((entry) => (
          <span key={entry.key}>
            <i style={{ background: entry.color }} /> {entry.label} — {euro(entry.value)}
          </span>
        ))}
      </div>
    </div>
  )
}

/* (a) Top apartments by revenue */

export function TopApartmentsBar({ stats }: { stats: PropertyReportStat[] }) {
  const data = [...stats]
    .filter((stat) => stat.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 10)
    .map((stat) => ({ name: stat.name, turnover: Math.round(stat.turnover) }))

  if (data.length === 0) {
    return <p className="list-empty">No revenue in this period yet.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
        <XAxis hide type="number" />
        <YAxis dataKey="name" tick={{ fontSize: 11 }} type="category" width={110} />
        <Tooltip formatter={(value) => [euro(Number(value)), 'Revenue']} />
        <Bar
          dataKey="turnover"
          fill={GREEN}
          label={{ position: 'right', fontSize: 11, formatter: (value: unknown) => euro(Number(value)) }}
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

/* (b) Occupancy % + nightly-rate trends (two charts, one axis each) */

function buildTrendRows(current: number[], previous: number[]) {
  return monthNames.map((name, index) => ({
    month: name,
    current: current[index],
    previous: previous[index],
  }))
}

export function OccupancyTrendChart({
  properties,
  reservations,
  year,
}: {
  properties: PropertyListing[]
  reservations: ReservationRecord[]
  year: number
}) {
  const rows = buildTrendRows(
    occupancyByMonth(properties.length, reservations, year),
    occupancyByMonth(properties.length, reservations, year - 1),
  )
  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="%" />
          <Tooltip
            formatter={(value, name) => [
              `${Number(value)}%`,
              name === 'current' ? String(year) : String(year - 1),
            ]}
          />
          <Line dataKey="previous" dot={false} name="previous" stroke={GREY} strokeWidth={2} />
          <Line dataKey="current" dot={{ r: 3 }} name="current" stroke={GREEN} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-legend">
        <span><i style={{ background: GREEN }} /> {year}</span>
        <span><i style={{ background: GREY }} /> {year - 1}</span>
      </div>
    </>
  )
}

export function AdrTrendChart({
  reservations,
  year,
}: {
  reservations: ReservationRecord[]
  year: number
}) {
  const rows = buildTrendRows(adrByMonth(reservations, year), adrByMonth(reservations, year - 1))
  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value, name) => [
              `EUR ${Number(value)} / night`,
              name === 'current' ? String(year) : String(year - 1),
            ]}
          />
          <Line dataKey="previous" dot={false} name="previous" stroke={GREY} strokeWidth={2} />
          <Line dataKey="current" dot={{ r: 3 }} name="current" stroke={GREEN} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
      <div className="chart-legend">
        <span><i style={{ background: GREEN }} /> {year}</span>
        <span><i style={{ background: GREY }} /> {year - 1}</span>
      </div>
    </>
  )
}

