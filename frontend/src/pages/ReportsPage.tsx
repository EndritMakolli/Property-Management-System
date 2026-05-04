import { ArrowUpDown, BarChart3 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchProperties, fetchReservations } from '../api/pmsApi'
import { Metric } from '../components/shared/Metric'
import { monthOptions, yearOptions } from '../features/reservations/monthOptions'
import type { PropertyListing, ReservationRecord } from '../types/domain'
import { calculateNights, nextDateValue } from '../utils/date'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PropertyReportStat = {
  averageNightlyPrice: number
  bookedNights: number
  freeNights: number
  id: string
  name: string
  basePriceEur: number
  bedrooms: number
  occupancy: number
  reservations: number
  turnover: number
}

type StayBucket = {
  label: string
  min: number
  max: number
}

type PropertyReportSortKey =
  | 'name'
  | 'reservations'
  | 'bookedNights'
  | 'freeNights'
  | 'occupancy'
  | 'averageNightlyPrice'
  | 'turnover'

type PropertyReportSort = {
  direction: 'asc' | 'desc'
  key: PropertyReportSortKey
}

const stayBuckets: StayBucket[] = [
  { label: '0–1 day', min: 0, max: 1 },
  { label: '2–7 days', min: 2, max: 7 },
  { label: '8–21 days', min: 8, max: 21 },
  { label: '22–28 days', min: 22, max: 28 },
  { label: '29+ days', min: 29, max: Infinity },
]

// Phone prefix → country mapping (editable via settings panel)
const defaultPhonePrefixes: Record<string, string> = {
  '+41': 'Switzerland',
  '+383': 'Kosovo',
  '+355': 'Albania',
  '+44': 'United Kingdom',
  '+45': 'Denmark',
  '+49': 'Germany',
  '+33': 'France',
  '+39': 'Italy',
  '+34': 'Spain',
  '+31': 'Netherlands',
  '+43': 'Austria',
  '+386': 'Slovenia',
  '+385': 'Croatia',
  '+381': 'Serbia',
  '+389': 'North Macedonia',
  '+1': 'USA / Canada',
}

const phonePrefixStorageKey = 'pms.reports.phonePrefixes'
const excludedPropertyStorageKey = 'pms.reports.excludedProperties'

function loadPhonePrefixes(): Record<string, string> {
  try {
    const stored = window.localStorage.getItem(phonePrefixStorageKey)
    if (stored) return { ...defaultPhonePrefixes, ...JSON.parse(stored) }
  } catch {
    // ignore
  }
  return { ...defaultPhonePrefixes }
}

function savePhonePrefixes(map: Record<string, string>) {
  window.localStorage.setItem(phonePrefixStorageKey, JSON.stringify(map))
}

function loadExcludedPropertyIds(): string[] {
  try {
    const stored = window.localStorage.getItem(excludedPropertyStorageKey)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function detectCountry(phone: string, prefixes: Record<string, string>): string {
  if (!phone) return 'Unknown'
  const cleaned = normalizePhoneDigits(phone)
  const sorted = Object.keys(prefixes).sort(
    (a, b) => normalizePhoneDigits(b).length - normalizePhoneDigits(a).length,
  )
  for (const prefix of sorted) {
    const normalizedPrefix = normalizePhoneDigits(prefix)
    if (normalizedPrefix && cleaned.startsWith(normalizedPrefix)) return prefixes[prefix]
  }
  return 'Other'
}

function normalizePhoneDigits(value: string): string {
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  return digits.startsWith('00') ? digits.slice(2) : digits
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReportsPage() {
  const today = new Date()
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [allReservations, setAllReservations] = useState<ReservationRecord[]>([])
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())
  const [selectedPropertyId, setSelectedPropertyId] = useState('all')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [phonePrefixes, setPhonePrefixes] = useState<Record<string, string>>(loadPhonePrefixes)
  const [editingPrefixes, setEditingPrefixes] = useState(false)
  const [prefixDraft, setPrefixDraft] = useState('')
  const [propertySort, setPropertySort] = useState<PropertyReportSort>({
    key: 'turnover',
    direction: 'desc',
  })
  const [showAllApartments, setShowAllApartments] = useState(false)
  const [excludedPropertyIds, setExcludedPropertyIds] = useState<string[]>(loadExcludedPropertyIds)

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
    window.localStorage.setItem(excludedPropertyStorageKey, JSON.stringify(excludedPropertyIds))
  }, [excludedPropertyIds])

  useEffect(() => {
    if (selectedPropertyId !== 'all' && excludedPropertyIds.includes(selectedPropertyId)) {
      setSelectedPropertyId('all')
    }
  }, [excludedPropertyIds, selectedPropertyId])

  const excludedPropertySet = useMemo(
    () => new Set(excludedPropertyIds),
    [excludedPropertyIds],
  )

  const includedProperties = useMemo(
    () => properties.filter((property) => !excludedPropertySet.has(property.id)),
    [excludedPropertySet, properties],
  )

  const includedReservations = useMemo(
    () => reservations.filter((reservation) => !excludedPropertySet.has(reservation.propertyId)),
    [excludedPropertySet, reservations],
  )

  const includedAllReservations = useMemo(
    () => allReservations.filter((reservation) => !excludedPropertySet.has(reservation.propertyId)),
    [allReservations, excludedPropertySet],
  )

  const visibleProperties = useMemo(
    () =>
      selectedPropertyId === 'all'
        ? includedProperties
        : includedProperties.filter((property) => property.id === selectedPropertyId),
    [includedProperties, selectedPropertyId],
  )

  const stats = useMemo(
    () => buildPropertyReportStats(visibleProperties, includedReservations, selectedYear, selectedMonth),
    [includedReservations, selectedMonth, selectedYear, visibleProperties],
  )

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

  // Stay duration categories (all-time)
  const stayDurationStats = useMemo(() => {
    const total = includedAllReservations.length || 1
    return stayBuckets.map((bucket) => {
      const matches = includedAllReservations.filter(
        (r) => r.totalNights >= bucket.min && r.totalNights <= bucket.max,
      )
      const revenue = matches.reduce((sum, r) => sum + Number(r.totalPaid), 0)
      return {
        label: bucket.label,
        count: matches.length,
        pct: Math.round((matches.length / total) * 100),
        revenue,
      }
    })
  }, [includedAllReservations])

  // Guest country stats (all-time)
  const countryStats = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {}
    for (const r of includedAllReservations) {
      const country = detectCountry(r.guestPhone, phonePrefixes)
      if (!map[country]) map[country] = { count: 0, revenue: 0 }
      map[country].count++
      map[country].revenue += Number(r.totalPaid)
    }
    const total = includedAllReservations.length || 1
    return Object.entries(map)
      .map(([country, { count, revenue }]) => ({
        country,
        count,
        pct: Math.round((count / total) * 100),
        revenue,
      }))
      .sort((a, b) => b.count - a.count)
  }, [includedAllReservations, phonePrefixes])

  // Monthly revenue chart (selected year)
  const monthlyRevenue = useMemo(() => {
    return MONTH_NAMES.map((label, idx) => {
      const month = idx + 1
      const monthStr = String(month).padStart(2, '0')
      const start = `${selectedYear}-${monthStr}-01`
      const end = `${selectedYear}-${monthStr}-31`
      const revenue = includedAllReservations
        .filter((r) => r.checkIn >= start && r.checkIn <= end)
        .reduce((sum, r) => sum + Number(r.totalPaid), 0)
      return { label, revenue }
    })
  }, [includedAllReservations, selectedYear])

  // Occupancy trends: daily occupancy % across all properties (last 90 days and next 90 from today)
  const occupancyTrends = useMemo(() => {
    if (!includedProperties.length || !includedAllReservations.length) return []
    const totalProps = includedProperties.length
    const result: { date: string; label: string; pct: number }[] = []
    const base = new Date()
    base.setDate(base.getDate() - 45)
    for (let i = 0; i < 90; i++) {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      const key = d.toISOString().slice(0, 10)
      const occupied = includedAllReservations.filter(
        (r) => r.checkIn <= key && r.checkOut > key,
      ).length
      result.push({
        date: key,
        label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`,
        pct: Math.round((occupied / totalProps) * 100),
      })
    }
    return result
  }, [includedAllReservations, includedProperties])

  // Fully booked dates (all properties occupied)
  const fullyBookedDates = useMemo(() => {
    return occupancyTrends.filter((d) => d.pct >= 100)
  }, [occupancyTrends])

  // Lowest performing apartments per bedroom category
  const lowestPerformers = useMemo(() => {
    const bedroomGroups = [...new Set(includedProperties.map((p) => p.bedrooms))].sort()
    return bedroomGroups.map((beds) => {
      const group = buildPropertyReportStats(
        includedProperties.filter((property) => property.bedrooms === beds),
        includedAllReservations,
        selectedYear,
        0,
      )
      const lowest = [...group].sort((a, b) => a.turnover - b.turnover)[0]
      return { beds, lowest }
    }).filter((g) => g.lowest)
  }, [includedAllReservations, includedProperties, selectedYear])

  // Prefix editor helpers
  function savePrefixDraft() {
    try {
      const parsed = JSON.parse(prefixDraft)
      setPhonePrefixes(parsed)
      savePhonePrefixes(parsed)
      setEditingPrefixes(false)
    } catch {
      // keep editing
    }
  }

  function updatePropertySort(key: PropertyReportSortKey) {
    setPropertySort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function sortLabel(key: PropertyReportSortKey) {
    if (propertySort.key !== key) return 'Sort'
    return propertySort.direction === 'asc' ? 'Ascending' : 'Descending'
  }

  function toggleExcludedProperty(propertyId: string) {
    setExcludedPropertyIds((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId],
    )
  }

  return (
    <section className="reports-page">
      <div className="reports-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>Apartment performance</h2>
        </div>
        <BarChart3 size={26} />
      </div>

      <div className="reports-filters">
        <label>
          Year
          <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
            {yearOptions().map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>
        <label>
          Month
          <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
            {monthOptions.map((month) => (
              <option key={month.value} value={month.value}>{month.label}</option>
            ))}
          </select>
        </label>
        <label>
          Apartment
          <select value={selectedPropertyId} onChange={(event) => setSelectedPropertyId(event.target.value)}>
            <option value="all">All apartments</option>
            {includedProperties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}</option>
            ))}
          </select>
        </label>
      </div>

      {status === 'loading' && <p className="listings-message">Loading reports...</p>}
      {status === 'error' && <p className="form-error">Could not load reports data.</p>}

      {status === 'ready' && (
        <>
          {/* ── Monthly performance table ── */}
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
              {properties.map((property) => (
                <label className="excluded-apartment-option" key={property.id}>
                  <input
                    type="checkbox"
                    checked={excludedPropertySet.has(property.id)}
                    onChange={() => toggleExcludedProperty(property.id)}
                  />
                  <span>{property.name}</span>
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

          <section className="panel property-panel">
            <div className="reports-table-header">
              <button onClick={() => updatePropertySort('name')}>Apartment <ArrowUpDown size={14} aria-label={sortLabel('name')} /></button>
              <button onClick={() => updatePropertySort('reservations')}>Reservations <ArrowUpDown size={14} aria-label={sortLabel('reservations')} /></button>
              <button onClick={() => updatePropertySort('bookedNights')}>Nights Booked <ArrowUpDown size={14} aria-label={sortLabel('bookedNights')} /></button>
              <button onClick={() => updatePropertySort('freeNights')}>Free Nights <ArrowUpDown size={14} aria-label={sortLabel('freeNights')} /></button>
              <button onClick={() => updatePropertySort('occupancy')}>Occupancy <ArrowUpDown size={14} aria-label={sortLabel('occupancy')} /></button>
              <button onClick={() => updatePropertySort('averageNightlyPrice')}>Avg Nightly <ArrowUpDown size={14} aria-label={sortLabel('averageNightlyPrice')} /></button>
              <button onClick={() => updatePropertySort('turnover')}>Turnover <ArrowUpDown size={14} aria-label={sortLabel('turnover')} /></button>
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
              <button
                className="show-more-button"
                type="button"
                onClick={() => setShowAllApartments((current) => !current)}
              >
                {showAllApartments ? 'Show less' : `Show more (${sortedStats.length - visibleStats.length})`}
              </button>
            )}
          </section>

          {/* ── Monthly revenue chart ── */}
          <section className="panel stats-chart-panel">
            <h3 className="stats-section-title">Monthly Revenue — {selectedYear}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyRevenue} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `€${v.toLocaleString()}`} width={70} />
                <Tooltip formatter={(value) => [`EUR ${Number(value ?? 0).toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {monthlyRevenue.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.label === MONTH_NAMES[today.getMonth()] ? '#1f6f5b' : '#56649a'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>

          {/* ── Occupancy trends ── */}
          <section className="panel stats-chart-panel">
            <h3 className="stats-section-title">Daily Occupancy — last 45 days + next 45 days</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={occupancyTrends} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={6} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} width={45} domain={[0, 100]} />
                <Tooltip formatter={(value) => [`${Number(value ?? 0)}%`, 'Occupancy']} />
                <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                  {occupancyTrends.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.pct >= 100 ? '#9b3f20' : entry.pct >= 60 ? '#1f6f5b' : '#adc8be'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {fullyBookedDates.length > 0 && (
              <div className="fully-booked-list">
                <strong>Fully booked dates ({fullyBookedDates.length}):</strong>{' '}
                {fullyBookedDates.map((d) => d.date).join(', ')}
              </div>
            )}
          </section>

          {/* ── Stay duration categories ── */}
          <section className="panel stats-section">
            <h3 className="stats-section-title">Stay Duration (all-time)</h3>
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

          {/* ── Guest country stats ── */}
          <section className="panel stats-section">
            <div className="stats-section-header">
              <h3 className="stats-section-title">Guest Countries (all-time)</h3>
              <button
                className="action-link"
                onClick={() => {
                  setPrefixDraft(JSON.stringify(phonePrefixes, null, 2))
                  setEditingPrefixes(!editingPrefixes)
                }}
              >
                {editingPrefixes ? 'Cancel' : 'Edit prefixes'}
              </button>
            </div>
            {editingPrefixes && (
              <div className="prefix-editor">
                <p className="paste-hint">Edit the JSON map of phone prefixes to country names, then save.</p>
                <textarea
                  className="prefix-textarea"
                  value={prefixDraft}
                  onChange={(e) => setPrefixDraft(e.target.value)}
                  rows={12}
                />
                <button className="primary-button" onClick={savePrefixDraft}>Save prefixes</button>
              </div>
            )}
            <div className="country-table">
              <div className="country-header">
                <span>Country</span>
                <span>Reservations</span>
                <span>% of guests</span>
                <span>Revenue</span>
              </div>
              {countryStats.map((row) => (
                <div className="country-row" key={row.country}>
                  <strong>{row.country}</strong>
                  <span>{row.count}</span>
                  <span>
                    {row.pct}%
                    <div className="stats-bar-bg inline-bar">
                      <div className="stats-bar-fill" style={{ width: `${row.pct}%` }} />
                    </div>
                  </span>
                  <span>EUR {row.revenue.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Lowest performing apartments ── */}
          {lowestPerformers.length > 0 && (
            <section className="panel stats-section">
              <h3 className="stats-section-title">Lowest Performing Apartments by Category</h3>
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

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function buildPropertyReportStats(
  properties: PropertyListing[],
  reservations: ReservationRecord[],
  year: number,
  month: number,
): PropertyReportStat[] {
  // month=0 means all-time (no month filtering)
  const useAllTime = month === 0
  const daysInMonth = useAllTime ? 365 : new Date(year, month, 0).getDate()
  const monthStart = useAllTime ? '1900-01-01' : `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = useAllTime ? '2999-12-31' : `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  return properties.map((property) => {
    const propertyReservations = reservations.filter((r) => r.propertyId === property.id)
    const turnover = propertyReservations.reduce((sum, r) => sum + Number(r.totalPaid), 0)
    const bookedNights = propertyReservations.reduce(
      (sum, r) => sum + (useAllTime ? r.totalNights : nightsInsideMonth(r, monthStart, monthEnd)),
      0,
    )
    const freeNights = useAllTime ? 0 : Math.max(daysInMonth - bookedNights, 0)
    const occupancy = useAllTime
      ? 0
      : Math.round((bookedNights / daysInMonth) * 100)

    return {
      averageNightlyPrice: bookedNights > 0 ? turnover / bookedNights : 0,
      basePriceEur: Number(property.basePriceEur || 0),
      bedrooms: property.bedrooms,
      bookedNights,
      freeNights,
      id: property.id,
      name: property.name,
      occupancy,
      reservations: propertyReservations.length,
      turnover,
    }
  })
}

function sortPropertyStats(stats: PropertyReportStat[], sort: PropertyReportSort): PropertyReportStat[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...stats].sort((left, right) => {
    const leftValue = left[sort.key]
    const rightValue = right[sort.key]

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * direction
    }

    return String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) * direction
  })
}

function nightsInsideMonth(reservation: ReservationRecord, monthStart: string, monthEnd: string) {
  const start = reservation.checkIn > monthStart ? reservation.checkIn : monthStart
  const end = reservation.checkOut < monthEnd ? reservation.checkOut : nextDay(monthEnd)
  return calculateNights(start, end)
}

function nextDay(dateValue: string) {
  return nextDateValue(dateValue)
}
