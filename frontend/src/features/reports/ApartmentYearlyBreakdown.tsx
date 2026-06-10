import { useMemo } from 'react'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { buildPropertyReportStats, monthNames } from './reportCalculations'

type Props = {
  property: PropertyListing
  allReservations: ReservationRecord[]
  year: number
  unitSingular: string
}

export function ApartmentYearlyBreakdown({ property, allReservations, year, unitSingular }: Props) {
  const rows = useMemo(
    () =>
      monthNames.map((label, idx) => {
        const month = idx + 1
        const [stat] = buildPropertyReportStats([property], allReservations, year, month)
        return { label, month, ...stat }
      }),
    [property, allReservations, year],
  )

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          reservations: acc.reservations + r.reservations,
          bookedNights: acc.bookedNights + r.bookedNights,
          turnover: acc.turnover + r.turnover,
        }),
        { reservations: 0, bookedNights: 0, turnover: 0 },
      ),
    [rows],
  )

  return (
    <section className="panel stats-section">
      <h3 className="stats-section-title">
        {unitSingular} Yearly Breakdown — {property.name} ({year})
      </h3>
      <div className="yearly-breakdown-scroll">
        <table className="yearly-breakdown-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Reservations</th>
              <th>Booked Nights</th>
              <th>Free Nights</th>
              <th>Occupancy</th>
              <th>Avg / Night</th>
              <th>Turnover</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.bookedNights === 0 ? 'row-empty' : ''}>
                <td className="month-col">{row.label}</td>
                <td>{row.reservations}</td>
                <td>{row.bookedNights}</td>
                <td>{row.freeNights}</td>
                <td>{row.occupancy}%</td>
                <td>EUR {row.averageNightlyPrice.toFixed(2)}</td>
                <td>
                  <strong>EUR {row.turnover.toLocaleString()}</strong>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="year-total-row">
              <td>Year total</td>
              <td>{totals.reservations}</td>
              <td>{totals.bookedNights}</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>
                <strong>EUR {totals.turnover.toLocaleString()}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
