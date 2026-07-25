import { PieChart as PieIcon } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { PanelHeader } from '../../components/shared/PanelHeader'
import {
  checkedInPaymentSplit,
  monthPaymentSplit,
  STATUS_COLORS,
  type PaymentSplit,
} from '../reports/insightCalculations'
import { monthNames } from '../reports/reportCalculations'
import type { ReservationRecord } from '../../types/domain'
import { toDateInputValue } from '../../utils/date'

function euro(value: number) {
  return `EUR ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function SplitDonut({ split, centerLabel }: { split: PaymentSplit; centerLabel: string }) {
  const total = split.paidCount + split.unpaidCount
  const paidPct = total > 0 ? Math.round((split.paidCount / total) * 100) : 0
  const data = [
    { name: 'Paid', value: split.paidCount, amount: split.paidAmount, color: STATUS_COLORS.paid },
    { name: 'Unpaid', value: split.unpaidCount, amount: split.unpaidAmount, color: STATUS_COLORS.unpaid },
  ].filter((entry) => entry.value > 0)

  if (total === 0) {
    return <p className="list-empty">Nothing due in this period.</p>
  }

  return (
    <div className="insight-donut-wrap">
      <div className="insight-donut">
        <ResponsiveContainer width="100%" height={190}>
          <PieChart>
            <Pie
              cx="50%"
              cy="50%"
              data={data}
              dataKey="value"
              innerRadius={52}
              outerRadius={80}
              paddingAngle={2}
              stroke="var(--bg-panel)"
              strokeWidth={2}
            >
              {data.map((entry) => (
                <Cell fill={entry.color} key={entry.name} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name, item) => [
                `${Number(value)} payment${Number(value) !== 1 ? 's' : ''} · ${euro(
                  ((item as { payload?: { amount?: number } })?.payload?.amount ?? 0),
                )}`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="insight-donut-center">
          <strong>{paidPct}% paid</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className="chart-legend">
        <span>
          <i style={{ background: STATUS_COLORS.paid }} /> Paid · {split.paidCount} · {euro(split.paidAmount)}
        </span>
        <span>
          <i style={{ background: STATUS_COLORS.unpaid }} /> Unpaid · {split.unpaidCount} · {euro(split.unpaidAmount)}
        </span>
      </div>
    </div>
  )
}

type PaymentStatusDonutsProps = {
  reservations: ReservationRecord[]
  year: number
  month: number
}

// User-requested payment donuts: how much of the selected month is settled
// (e.g. "50% paid — EUR 5,000 unpaid") and the same split for guests who are
// currently checked in.
export function PaymentStatusDonuts({ reservations, year, month }: PaymentStatusDonutsProps) {
  const today = toDateInputValue(new Date())
  const monthSplit = monthPaymentSplit(reservations, today, year, month)
  const inHouseSplit = checkedInPaymentSplit(reservations, today)

  return (
    <section className="panel payment-status-panel">
      <PanelHeader icon={PieIcon} title="Payment status" />
      <div className="payment-status-grid">
        <div>
          <h4 className="insight-subtitle">
            {monthNames[month - 1]} {year} — payments due
          </h4>
          <SplitDonut centerLabel={`${euro(monthSplit.unpaidAmount)} unpaid`} split={monthSplit} />
        </div>
        <div>
          <h4 className="insight-subtitle">Currently checked in</h4>
          <SplitDonut
            centerLabel={`${inHouseSplit.paidCount + inHouseSplit.unpaidCount} guest${
              inHouseSplit.paidCount + inHouseSplit.unpaidCount !== 1 ? 's' : ''
            } in-house`}
            split={inHouseSplit}
          />
        </div>
      </div>
    </section>
  )
}
