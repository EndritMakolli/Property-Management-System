import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ReservationRecord } from '../../types/domain'
import {
  newVsReturning,
  platformRevenue,
  type ApartmentRevenue,
  type SeriesType,
} from './insightCalculations'
import type { PropertyReportStat } from './reportCalculations'

const GREEN = '#1f6f5b'

function euro(value: number) {
  return `EUR ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

/* (a) Revenue split by platform */

export function PlatformRevenueDonut({
  reservations,
  year,
  month,
  types,
}: {
  reservations: ReservationRecord[]
  year: number
  month: number
  types: SeriesType[]
}) {
  const data = platformRevenue(reservations, year, month, types)
  const total = data.reduce((sum, row) => sum + row.value, 0)

  if (data.length === 0) {
    return <p className="list-empty">No revenue in this period yet.</p>
  }

  return (
    <div className="insight-donut-wrap">
      <div className="insight-donut">
        <ResponsiveContainer className="money-chart" width="100%" height={220}>
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
          <strong className="money">{euro(total)}</strong>
          <span>total revenue</span>
        </div>
      </div>
      <div className="chart-legend">
        {data.map((entry) => (
          <span key={entry.key}>
            <i style={{ background: entry.color }} /> {entry.label} —{' '}
            <span className="money">{euro(entry.value)}</span>
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
    <ResponsiveContainer className="money-chart" width="100%" height={Math.max(180, data.length * 34)}>
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

/* (b) Top apartments by revenue, over a rolling window */

export function TopApartmentsByRevenue({
  rows,
  monthsLabel,
}: {
  rows: ApartmentRevenue[]
  monthsLabel: string
}) {
  if (rows.length === 0) {
    return <p className="list-empty">No revenue in {monthsLabel} yet.</p>
  }

  return (
    <ResponsiveContainer className="money-chart" width="100%" height={Math.max(180, rows.length * 34)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 66, left: 8, bottom: 4 }}>
        <XAxis hide type="number" />
        <YAxis dataKey="name" tick={{ fontSize: 11 }} type="category" width={110} />
        <Tooltip formatter={(value) => [euro(Number(value)), 'Revenue']} />
        <Bar
          dataKey="revenue"
          fill={GREEN}
          label={{ position: 'right', fontSize: 11, formatter: (value: unknown) => euro(Number(value)) }}
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

/* (c) New versus returning guests */

const NEW_GUEST = '#1f6f5b'
const RETURNING_GUEST = '#d9a441'

export function GuestMixDonut({
  reservations,
  year,
  month,
}: {
  reservations: ReservationRecord[]
  year: number
  month: number
}) {
  const { newCount, returningCount, unlinked } = newVsReturning(reservations, year, month)
  const total = newCount + returningCount

  if (total === 0) {
    return <p className="list-empty">No arrivals in this period yet.</p>
  }

  const data = [
    { key: 'new', label: 'New', value: newCount, color: NEW_GUEST },
    { key: 'returning', label: 'Returning', value: returningCount, color: RETURNING_GUEST },
  ].filter((slice) => slice.value > 0)

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
                `${Number(value)} (${Math.round((Number(value) / total) * 100)}%)`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="insight-donut-center">
          <strong>{total}</strong>
          <span>{total === 1 ? 'guest' : 'guests'}</span>
        </div>
      </div>
      <div className="chart-legend">
        {data.map((entry) => (
          <span key={entry.key}>
            <i style={{ background: entry.color }} /> {entry.label} — {entry.value}
          </span>
        ))}
      </div>
      {unlinked > 0 && (
        // Said plainly rather than folded into "new": these arrivals have no
        // client record, so there is no way to know whether they had been before.
        <p className="insight-footnote">
          {unlinked} arrival{unlinked === 1 ? '' : 's'} not linked to a client, so not counted.
        </p>
      )}
    </div>
  )
}
