import { CalendarRange } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReservationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { monthOptions, yearOptions } from '../reservations/monthOptions'
import { bucketFor, bucketLabel, buildNightBuckets, staysInMonth } from './nightsBuckets'
import { nightsInsideMonth, revenueInsideMonth } from './reportCalculations'

const DETAIL_LIMIT = 100

type NightsByMonthReportProps = {
  reservations: ReservationRecord[]
}

export function NightsByMonthReport({ reservations }: NightsByMonthReportProps) {
  const today = new Date()
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [year, setYear] = useState(today.getFullYear())
  const [selected, setSelected] = useState<number | null>(null)

  // Every stay that occupied a night of the selected month, arrivals from the
  // month before included - their nights are this month's too.
  const inMonth = useMemo(
    () => staysInMonth(reservations, year, month),
    [reservations, month, year],
  )

  const buckets = useMemo(
    () => buildNightBuckets(reservations, year, month),
    [reservations, month, year],
  )

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(
    new Date(year, month, 0).getDate(),
  ).padStart(2, '0')}`

  // Reservations for the bucket the user clicked (empty until one is picked).
  const detail = useMemo(() => {
    if (selected === null) return []
    return inMonth
      .filter((r) => bucketFor(r.totalNights) === selected)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
  }, [inMonth, selected])

  return (
    <section className="panel stats-section nights-report">
      <div className="stats-section-header stay-duration-header">
        <h3 className="stats-section-title nights-report-title">
          <CalendarRange size={17} /> Reservations by nights
        </h3>
        <div className="stay-duration-filters">
          <label>
            Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="nights-report-hint">
        Reservations that check in this month, grouped by length of stay. Click a card to list those
        reservations.
      </p>

      <div className="stats-grid">
        {buckets.map((bucket) => (
          <button
            key={bucket.value}
            type="button"
            className={`stats-card nights-bucket${selected === bucket.value ? ' active' : ''}`}
            onClick={() => setSelected((cur) => (cur === bucket.value ? null : bucket.value))}
          >
            <p className="stats-card-label">{bucket.label}</p>
            <strong className="stats-card-value">{bucket.count}</strong>
            <span className="stats-card-sub">{bucket.pct}% of stays</span>
            <span className="stats-card-sub">
              <span className="money">EUR {Math.round(bucket.revenue).toLocaleString()}</span> ·{' '}
              {bucket.nights} nights
            </span>
            <div className="stats-bar-bg">
              <div className="stats-bar-fill" style={{ width: `${bucket.pct}%` }} />
            </div>
          </button>
        ))}
      </div>

      {selected !== null && (
        <div className="nights-report-detail">
          <p className="nights-report-detail-head">
            {bucketLabel(selected)} — {detail.length} reservation{detail.length !== 1 ? 's' : ''}
          </p>
          {detail.length > 0 ? (
            <div className="table-scroll-x">
            <table className="nights-report-table">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Apartment</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Nights</th>
                  <th>Nights this month</th>
                  <th>Earned this month</th>
                </tr>
              </thead>
              <tbody>
                {detail.slice(0, DETAIL_LIMIT).map((r) => (
                  <tr key={r.id}>
                    <td>{r.guestName || r.guestPhone || 'Guest'}</td>
                    <td>{r.apartment}</td>
                    <td>{formatDisplayDate(r.checkIn)}</td>
                    <td>{formatDisplayDate(r.checkOut)}</td>
                    <td>{r.totalNights}</td>
                    <td>{nightsInsideMonth(r, monthStart, monthEnd)}</td>
                    <td>
                      EUR{' '}
                      {revenueInsideMonth(r, year, month).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="listings-message">No {bucketLabel(selected)} reservations in this month.</p>
          )}
          {detail.length > DETAIL_LIMIT && (
            <p className="nights-report-detail-more">
              Showing the first {DETAIL_LIMIT} of {detail.length}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
