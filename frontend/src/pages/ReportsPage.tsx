import { BarChart3, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchProperties, fetchReservations } from '../api/pmsApi'
import { Metric } from '../components/shared/Metric'
import { usePlatform } from '../context/PlatformContext'
import { ApartmentStatsTable } from '../features/reports/ApartmentStatsTable'
import { ApartmentYearlyBreakdown } from '../features/reports/ApartmentYearlyBreakdown'
import { ComparePanel } from '../features/reports/ComparePanel'
import {
  CompareRevenueChart,
  DailyOccupancyChart,
  MonthlyRevenueChart,
} from '../features/reports/ReportCharts'
import {
  buildPropertyReportStats,
  buildPropertyYearStats,
  monthNames,
  revenueInsideMonth,
  sortPropertyStats,
  stayBuckets,
  toIsoDate,
  type PropertyReportSort,
  type PropertyReportSortKey,
} from '../features/reports/reportCalculations'
import { monthOptions, yearOptions } from '../features/reservations/monthOptions'
import { useLocalStorageState } from '../hooks/useLocalStorageState'
import type { PropertyListing, ReservationRecord } from '../types/domain'

const excludedPropertyStorageKey = 'pms.reports.excludedProperties'

type ViewMode = 'monthly' | 'yearly' | 'all_time'

export function ReportsPage() {
  const today = new Date()
  const { platform } = usePlatform()

  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [allReservations, setAllReservations] = useState<ReservationRecord[]>([])
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [occupancyMonth, setOccupancyMonth] = useState(today.getMonth() + 1)
  const [occupancyYear, setOccupancyYear] = useState(today.getFullYear())
  const [selectedPropertyId, setSelectedPropertyId] = useState('all')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [stayDurationMode, setStayDurationMode] = useState<'all_time' | 'monthly'>('all_time')
  const [stayDurationMonth, setStayDurationMonth] = useState(today.getMonth() + 1)
  const [stayDurationYear, setStayDurationYear] = useState(today.getFullYear())
  const [propertySort, setPropertySort] = useState<PropertyReportSort>({
    key: 'turnover',
    direction: 'desc',
  })
  const [showAllApartments, setShowAllApartments] = useState(false)
  const [excludedPropertyIds, setExcludedPropertyIds] = useLocalStorageState<string[]>(
    excludedPropertyStorageKey,
    [],
  )
  const [viewMode, setViewMode] = useState<ViewMode>('monthly')
  const [compareMode, setCompareMode] = useState(false)
  const [comparePropertyId, setComparePropertyId] = useState('')

  useEffect(() => {
    let ignore = false

    async function loadReports() {
      try {
        setStatus('loading')
        const [propertyRows, reservationRows, allRows] = await Promise.all([
          fetchProperties(),
          fetchReservations({ month: selectedMonth, year: selectedYear }),
          fetchReservations(),
        ])

        if (!ignore) {
          setProperties(propertyRows)
          setReservations(reservationRows)
          setAllReservations(allRows)
          setStatus('ready')
        }
      } catch {
        if (!ignore) {
          setStatus('error')
        }
      }
    }

    loadReports()

    return () => {
      ignore = true
    }
  }, [selectedMonth, selectedYear])

  useEffect(() => {
    if (selectedPropertyId !== 'all' && excludedPropertyIds.includes(selectedPropertyId)) {
      setSelectedPropertyId('all')
    }
  }, [excludedPropertyIds, selectedPropertyId])

  // When switching to compare mode, if 'all' is selected pick the first property
  useEffect(() => {
    if (compareMode && selectedPropertyId === 'all' && includedProperties.length > 0) {
      setSelectedPropertyId(includedProperties[0].id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode])

  const excludedPropertySet = useMemo(
    () => new Set(excludedPropertyIds),
    [excludedPropertyIds],
  )

  const includedProperties = useMemo(
    () => properties.filter((p) => !excludedPropertySet.has(p.id)),
    [excludedPropertySet, properties],
  )

  const includedReservations = useMemo(
    () => reservations.filter((r) => !excludedPropertySet.has(r.propertyId)),
    [excludedPropertySet, reservations],
  )

  const includedAllReservations = useMemo(
    () => allReservations.filter((r) => !excludedPropertySet.has(r.propertyId)),
    [allReservations, excludedPropertySet],
  )

  const visibleProperties = useMemo(
    () =>
      selectedPropertyId === 'all'
        ? includedProperties
        : includedProperties.filter((p) => p.id === selectedPropertyId),
    [includedProperties, selectedPropertyId],
  )

  const stats = useMemo(() => {
    if (viewMode === 'yearly') {
      return buildPropertyYearStats(visibleProperties, includedAllReservations, selectedYear)
    }
    if (viewMode === 'all_time') {
      return buildPropertyReportStats(visibleProperties, includedAllReservations, selectedYear, 0)
    }
    return buildPropertyReportStats(visibleProperties, includedReservations, selectedYear, selectedMonth)
  }, [viewMode, visibleProperties, includedAllReservations, includedReservations, selectedYear, selectedMonth])

  const sortedStats = useMemo(
    () => sortPropertyStats(stats, propertySort),
    [propertySort, stats],
  )
  const visibleStats = showAllApartments ? sortedStats : sortedStats.slice(0, 6)

  const totalTurnover = stats.reduce((sum, p) => sum + p.turnover, 0)
  const bookedNights = stats.reduce((sum, p) => sum + p.bookedNights, 0)
  const freeNights = stats.reduce((sum, p) => sum + p.freeNights, 0)
  const totalReservations = stats.reduce((sum, p) => sum + p.reservations, 0)
  const averageOccupancy =
    stats.length > 0
      ? Math.round(stats.reduce((sum, p) => sum + p.occupancy, 0) / stats.length)
      : 0
  const averageNightlyPrice = bookedNights > 0 ? totalTurnover / bookedNights : 0

  // Specific property for yearly breakdown
  const selectedProperty = useMemo(
    () =>
      selectedPropertyId !== 'all'
        ? includedProperties.find((p) => p.id === selectedPropertyId) ?? null
        : null,
    [includedProperties, selectedPropertyId],
  )

  // Compare: secondary property stats
  const compareProperty = useMemo(
    () =>
      compareMode && comparePropertyId
        ? includedProperties.find((p) => p.id === comparePropertyId) ?? null
        : null,
    [compareMode, comparePropertyId, includedProperties],
  )

  const primaryCompareStat = useMemo(() => {
    if (!compareMode || !selectedProperty) return null
    return stats[0] ?? null
  }, [compareMode, selectedProperty, stats])

  const secondaryCompareStat = useMemo(() => {
    if (!compareProperty) return null
    if (viewMode === 'yearly') {
      const [stat] = buildPropertyYearStats([compareProperty], includedAllReservations, selectedYear)
      return stat ?? null
    }
    const reservations = viewMode === 'all_time' ? includedAllReservations : includedReservations
    const month = viewMode === 'all_time' ? 0 : selectedMonth
    const [stat] = buildPropertyReportStats([compareProperty], reservations, selectedYear, month)
    return stat ?? null
  }, [compareProperty, viewMode, includedAllReservations, includedReservations, selectedYear, selectedMonth])

  // Monthly revenue for single-property or all — filtered by selectedPropertyId
  const monthlyRevenue = useMemo(() => {
    const source =
      selectedPropertyId === 'all'
        ? includedAllReservations
        : includedAllReservations.filter((r) => r.propertyId === selectedPropertyId)
    return monthNames.map((label, idx) => {
      const month = idx + 1
      const revenue = source.reduce((sum, r) => sum + revenueInsideMonth(r, selectedYear, month), 0)
      return { label, revenue }
    })
  }, [includedAllReservations, selectedPropertyId, selectedYear])

  // Compare revenue chart data
  const compareChartData = useMemo(() => {
    if (!compareMode || !selectedProperty || !compareProperty) return null
    return monthNames.map((label, idx) => {
      const month = idx + 1
      const primary = includedAllReservations
        .filter((r) => r.propertyId === selectedPropertyId)
        .reduce((sum, r) => sum + revenueInsideMonth(r, selectedYear, month), 0)
      const secondary = includedAllReservations
        .filter((r) => r.propertyId === comparePropertyId)
        .reduce((sum, r) => sum + revenueInsideMonth(r, selectedYear, month), 0)
      return { label, primary, secondary }
    })
  }, [
    compareMode,
    selectedProperty,
    compareProperty,
    includedAllReservations,
    selectedPropertyId,
    comparePropertyId,
    selectedYear,
  ])

  const stayDurationReservations = useMemo(() => {
    if (stayDurationMode === 'all_time') return includedAllReservations

    const monthStart = `${stayDurationYear}-${String(stayDurationMonth).padStart(2, '0')}-01`
    const monthEnd = `${stayDurationYear}-${String(stayDurationMonth).padStart(2, '0')}-${String(
      new Date(stayDurationYear, stayDurationMonth, 0).getDate(),
    ).padStart(2, '0')}`

    return includedAllReservations.filter(
      (r) => r.checkIn <= monthEnd && r.checkOut > monthStart,
    )
  }, [includedAllReservations, stayDurationMode, stayDurationMonth, stayDurationYear])

  const stayDurationStats = useMemo(() => {
    const total = stayDurationReservations.length || 1
    return stayBuckets.map((bucket) => {
      const matches = stayDurationReservations.filter(
        (r) => r.totalNights >= bucket.min && r.totalNights <= bucket.max,
      )
      const revenue = matches.reduce(
        (sum, r) =>
          sum +
          (stayDurationMode === 'monthly'
            ? revenueInsideMonth(r, stayDurationYear, stayDurationMonth)
            : Number(r.totalPaid)),
        0,
      )
      return {
        label: bucket.label,
        count: matches.length,
        pct: Math.round((matches.length / total) * 100),
        revenue,
      }
    })
  }, [stayDurationReservations, stayDurationMode, stayDurationYear, stayDurationMonth])

  const occupancyTrends = useMemo(() => {
    if (!includedProperties.length) return []
    const totalProps = includedProperties.length
    const daysInMonth = new Date(occupancyYear, occupancyMonth, 0).getDate()
    const result: { date: string; label: string; pct: number }[] = []

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(occupancyYear, occupancyMonth - 1, day)
      const key = toIsoDate(d)
      const occupied = includedAllReservations.filter(
        (r) => r.checkIn <= key && r.checkOut > key,
      ).length
      result.push({
        date: key,
        label: `${day}`,
        pct: Math.round((occupied / totalProps) * 100),
      })
    }
    return result
  }, [includedAllReservations, includedProperties, occupancyMonth, occupancyYear])

  const lowestPerformers = useMemo(() => {
    const bedroomGroups = [...new Set(includedProperties.map((p) => p.bedrooms))].sort()
    return bedroomGroups
      .map((beds) => {
        const group = (() => {
          const props = includedProperties.filter((p) => p.bedrooms === beds)
          if (viewMode === 'yearly') return buildPropertyYearStats(props, includedAllReservations, selectedYear)
          const reservations = viewMode === 'all_time' ? includedAllReservations : includedReservations
          const month = viewMode === 'all_time' ? 0 : selectedMonth
          return buildPropertyReportStats(props, reservations, selectedYear, month)
        })()
        const lowest = [...group].sort((a, b) => a.turnover - b.turnover)[0]
        return { beds, lowest }
      })
      .filter((g) => g.lowest)
  }, [viewMode, includedAllReservations, includedReservations, includedProperties, selectedYear, selectedMonth])

  function updatePropertySort(key: PropertyReportSortKey) {
    setPropertySort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function toggleExcludedProperty(propertyId: string) {
    setExcludedPropertyIds((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId],
    )
  }

  function handleViewMode(mode: ViewMode) {
    setViewMode(mode)
  }

  const periodLabel =
    viewMode === 'all_time'
      ? 'All time'
      : viewMode === 'yearly'
      ? String(selectedYear)
      : `${monthNames[selectedMonth - 1]} ${selectedYear}`

  const showCompare =
    compareMode &&
    selectedPropertyId !== 'all' &&
    !!comparePropertyId &&
    comparePropertyId !== selectedPropertyId &&
    !!primaryCompareStat &&
    !!secondaryCompareStat

  const showYearlyBreakdown =
    viewMode === 'yearly' && !compareMode

  // Properties available for the compare picker (exclude current primary)
  const compareOptions = includedProperties.filter((p) => p.id !== selectedPropertyId)

  return (
    <section className="reports-page">
      <div className="reports-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>{platform.unitSingular} performance</h2>
        </div>
        <div className="reports-header-actions">
          <BarChart3 size={26} />
          <button className="icon-row-button" onClick={() => window.print()} title="Print / Export PDF">
            <Printer size={18} />
            Export PDF
          </button>
        </div>
      </div>

      <div className="reports-filters">
        <label>
          View
          <div className="toggle-group">
            <button
              type="button"
              className={viewMode === 'monthly' ? 'active' : ''}
              onClick={() => handleViewMode('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={viewMode === 'yearly' ? 'active' : ''}
              onClick={() => handleViewMode('yearly')}
            >
              Yearly
            </button>
            <button
              type="button"
              className={viewMode === 'all_time' ? 'active' : ''}
              onClick={() => handleViewMode('all_time')}
            >
              All time
            </button>
          </div>
        </label>

        {viewMode !== 'all_time' && (
          <label>
            Year
            <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
              {yearOptions().map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
        )}

        {viewMode === 'monthly' && (
          <label>
            Month
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          {platform.unitSingular}
          <select
            value={selectedPropertyId}
            onChange={(e) => setSelectedPropertyId(e.target.value)}
          >
            {!compareMode && <option value="all">All {platform.unitPlural}</option>}
            {includedProperties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label>
          Compare
          <div className="toggle-group">
            <button
              type="button"
              className={!compareMode ? 'active' : ''}
              onClick={() => setCompareMode(false)}
            >
              Off
            </button>
            <button
              type="button"
              className={compareMode ? 'active' : ''}
              onClick={() => setCompareMode(true)}
            >
              On
            </button>
          </div>
        </label>

        {compareMode && (
          <label>
            vs.
            <select
              value={comparePropertyId}
              onChange={(e) => setComparePropertyId(e.target.value)}
            >
              <option value="">Select {platform.unitSingular}</option>
              {compareOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {status === 'loading' && <p className="listings-message">Loading reports...</p>}
      {status === 'error' && <p className="form-error">Could not load reports data.</p>}

      {status === 'ready' && (
        <>
          <section className="panel exclusions-panel">
            <div className="stats-section-header">
              <h3 className="stats-section-title">Exclude from statistics</h3>
              {excludedPropertyIds.length > 0 && (
                <button
                  className="action-link"
                  type="button"
                  onClick={() => setExcludedPropertyIds([])}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="excluded-apartment-grid">
              {properties.map((p) => (
                <label className="excluded-apartment-option" key={p.id}>
                  <input
                    type="checkbox"
                    checked={excludedPropertySet.has(p.id)}
                    onChange={() => toggleExcludedProperty(p.id)}
                  />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="metric-row" aria-label="Report metrics">
            <Metric label="Turnover" value={`EUR ${totalTurnover.toLocaleString()}`} />
            <Metric label="Reservations" value={totalReservations.toString()} />
            <Metric label="Booked nights" value={bookedNights.toString()} />
            <Metric label="Free nights" value={freeNights.toString()} />
            <Metric label="Occupancy" value={`${averageOccupancy}%`} />
            <Metric label="Avg nightly" value={`EUR ${averageNightlyPrice.toFixed(2)}`} />
          </section>

          <ApartmentStatsTable
            onSort={updatePropertySort}
            propertySort={propertySort}
            showAllApartments={showAllApartments}
            sortedStats={sortedStats}
            visibleStats={visibleStats}
            unitSingular={platform.unitSingular}
            onToggleShowAll={() => setShowAllApartments((v) => !v)}
          />

          {showCompare && primaryCompareStat && secondaryCompareStat ? (
            <>
              <ComparePanel
                primary={primaryCompareStat}
                secondary={secondaryCompareStat}
                periodLabel={periodLabel}
              />
              {compareChartData && (
                <CompareRevenueChart
                  data={compareChartData}
                  year={selectedYear}
                  primaryName={primaryCompareStat.name}
                  secondaryName={secondaryCompareStat.name}
                />
              )}
            </>
          ) : (
            <MonthlyRevenueChart data={monthlyRevenue} selectedYear={selectedYear} today={today} />
          )}

          {showYearlyBreakdown && selectedProperty && (
            <ApartmentYearlyBreakdown
              property={selectedProperty}
              allReservations={includedAllReservations}
              year={selectedYear}
              unitSingular={platform.unitSingular}
            />
          )}

          <DailyOccupancyChart
            data={occupancyTrends}
            month={occupancyMonth}
            year={occupancyYear}
            onMonthChange={setOccupancyMonth}
            onYearChange={setOccupancyYear}
          />

          <section className="panel stats-section">
            <div className="stats-section-header stay-duration-header">
              <h3 className="stats-section-title">Stay Duration</h3>
              <div className="stay-duration-filters">
                <label>
                  Period
                  <select
                    value={stayDurationMode}
                    onChange={(e) =>
                      setStayDurationMode(e.target.value as 'all_time' | 'monthly')
                    }
                  >
                    <option value="all_time">All-time</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                {stayDurationMode === 'monthly' && (
                  <>
                    <label>
                      Month
                      <select
                        value={stayDurationMonth}
                        onChange={(e) => setStayDurationMonth(Number(e.target.value))}
                      >
                        {monthOptions.map((month) => (
                          <option key={month.value} value={month.value}>{month.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Year
                      <select
                        value={stayDurationYear}
                        onChange={(e) => setStayDurationYear(Number(e.target.value))}
                      >
                        {yearOptions().map((year) => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
            </div>
            <div className="stats-grid">
              {stayDurationStats.map((row) => (
                <div className="stats-card" key={row.label}>
                  <p className="stats-card-label">{row.label}</p>
                  <strong className="stats-card-value">{row.count}</strong>
                  <span className="stats-card-sub">{row.pct}% of stays</span>
                  <span className="stats-card-sub">EUR {row.revenue.toLocaleString()}</span>
                  <div className="stats-bar-bg">
                    <div className="stats-bar-fill" style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {lowestPerformers.length > 0 && (
            <section className="panel stats-section">
              <h3 className="stats-section-title">
                Lowest Performing {platform.unitPlural} — {periodLabel}
              </h3>
              <div className="stats-grid">
                {lowestPerformers.map(({ beds, lowest }) => (
                  <div className="stats-card perf-card" key={beds}>
                    <p className="stats-card-label">{beds}-bedroom</p>
                    <strong className="stats-card-name">{lowest.name}</strong>
                    <div className="perf-metrics">
                      <span>Turnover: <strong>EUR {lowest.turnover.toLocaleString()}</strong></span>
                      <span>Avg/night: <strong>EUR {lowest.averageNightlyPrice.toFixed(2)}</strong></span>
                      <span>Reservations: <strong>{lowest.reservations}</strong></span>
                      <span>Booked nights: <strong>{lowest.bookedNights}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  )
}
