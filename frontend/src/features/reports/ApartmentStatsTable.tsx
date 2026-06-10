import { ArrowUpDown } from 'lucide-react'
import type {
  PropertyReportSort,
  PropertyReportSortKey,
  PropertyReportStat,
} from './reportCalculations'

type ApartmentStatsTableProps = {
  onSort: (key: PropertyReportSortKey) => void
  propertySort: PropertyReportSort
  showAllApartments: boolean
  sortedStats: PropertyReportStat[]
  visibleStats: PropertyReportStat[]
  unitSingular: string
  onToggleShowAll: () => void
}

export function ApartmentStatsTable({
  onSort,
  propertySort,
  showAllApartments,
  sortedStats,
  visibleStats,
  unitSingular,
  onToggleShowAll,
}: ApartmentStatsTableProps) {
  function sortLabel(key: PropertyReportSortKey) {
    if (propertySort.key !== key) return 'Sort'
    return propertySort.direction === 'asc' ? 'Ascending' : 'Descending'
  }

  return (
    <section className="panel property-panel">
      <div className="reports-table-header">
        <button onClick={() => onSort('name')}>{unitSingular} <ArrowUpDown size={14} aria-label={sortLabel('name')} /></button>
        <button onClick={() => onSort('reservations')}>Reservations <ArrowUpDown size={14} aria-label={sortLabel('reservations')} /></button>
        <button onClick={() => onSort('bookedNights')}>Nights Booked <ArrowUpDown size={14} aria-label={sortLabel('bookedNights')} /></button>
        <button onClick={() => onSort('freeNights')}>Free Nights <ArrowUpDown size={14} aria-label={sortLabel('freeNights')} /></button>
        <button onClick={() => onSort('occupancy')}>Occupancy <ArrowUpDown size={14} aria-label={sortLabel('occupancy')} /></button>
        <button onClick={() => onSort('averageNightlyPrice')}>Avg Nightly <ArrowUpDown size={14} aria-label={sortLabel('averageNightlyPrice')} /></button>
        <button onClick={() => onSort('turnover')}>Turnover <ArrowUpDown size={14} aria-label={sortLabel('turnover')} /></button>
      </div>
      <div className="reports-table">
        {visibleStats.map((property) => (
          <article className="reports-row" key={property.id}>
            <strong>{property.name}</strong>
            <span>{property.reservations}</span>
            <span>{property.bookedNights}</span>
            <span>{property.freeNights}</span>
            <span>{property.occupancy}%</span>
            <span>EUR {property.averageNightlyPrice.toFixed(2)}</span>
            <strong>EUR {property.turnover.toLocaleString()}</strong>
          </article>
        ))}
      </div>
      {sortedStats.length > 6 && (
        <button className="show-more-button" type="button" onClick={onToggleShowAll}>
          {showAllApartments ? 'Show less' : `Show more (${sortedStats.length - visibleStats.length})`}
        </button>
      )}
    </section>
  )
}
