import type { PropertyReportStat } from './reportCalculations'

type ComparePanelProps = {
  primary: PropertyReportStat
  secondary: PropertyReportStat
  periodLabel: string
}

type MetricRow = {
  label: string
  primaryValue: string
  secondaryValue: string
  winner: 'primary' | 'secondary' | 'tie'
}

function winnerOf(a: number, b: number): 'primary' | 'secondary' | 'tie' {
  if (a > b) return 'primary'
  if (b > a) return 'secondary'
  return 'tie'
}

export function ComparePanel({ primary, secondary, periodLabel }: ComparePanelProps) {
  const metrics: MetricRow[] = [
    {
      label: 'Turnover',
      primaryValue: `EUR ${primary.turnover.toLocaleString()}`,
      secondaryValue: `EUR ${secondary.turnover.toLocaleString()}`,
      winner: winnerOf(primary.turnover, secondary.turnover),
    },
    {
      label: 'Reservations',
      primaryValue: String(primary.reservations),
      secondaryValue: String(secondary.reservations),
      winner: winnerOf(primary.reservations, secondary.reservations),
    },
    {
      label: 'Booked Nights',
      primaryValue: String(primary.bookedNights),
      secondaryValue: String(secondary.bookedNights),
      winner: winnerOf(primary.bookedNights, secondary.bookedNights),
    },
    {
      label: 'Occupancy',
      primaryValue: `${primary.occupancy}%`,
      secondaryValue: `${secondary.occupancy}%`,
      winner: winnerOf(primary.occupancy, secondary.occupancy),
    },
    {
      label: 'Avg / Night',
      primaryValue: `EUR ${primary.averageNightlyPrice.toFixed(2)}`,
      secondaryValue: `EUR ${secondary.averageNightlyPrice.toFixed(2)}`,
      winner: winnerOf(primary.averageNightlyPrice, secondary.averageNightlyPrice),
    },
  ]

  return (
    <section className="panel compare-panel">
      <h3 className="stats-section-title">Comparison — {periodLabel}</h3>
      <div className="compare-names-row">
        <span className="compare-name primary-name">{primary.name}</span>
        <span className="compare-vs">vs</span>
        <span className="compare-name secondary-name">{secondary.name}</span>
      </div>
      <div className="compare-metrics-grid">
        {metrics.map((m) => (
          <div className="compare-metric-row" key={m.label}>
            <span className={`compare-value${m.winner === 'primary' ? ' winner' : ''}`}>
              {m.primaryValue}
            </span>
            <span className="compare-metric-label">{m.label}</span>
            <span className={`compare-value${m.winner === 'secondary' ? ' winner' : ''}`}>
              {m.secondaryValue}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
