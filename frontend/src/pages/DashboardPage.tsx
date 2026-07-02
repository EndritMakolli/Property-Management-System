import { Activity, CalendarDays, CheckSquare, Home, Plus, Square, TrendingUp, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  fetchCleanStatuses,
  fetchMaintenanceIssues,
  fetchProperties,
  fetchReservations,
  markApartmentCleaned,
} from '../api/pmsApi'
import { fetchDashboardForecast, type DashboardForecast } from '../api/forecast'
import { NewReservationModal } from '../features/reservations/NewReservationModal'
import { useAuth } from '../auth/AuthContext'
import { Metric } from '../components/shared/Metric'
import { PanelHeader } from '../components/shared/PanelHeader'
import { DateInput } from '../components/shared/DateInput'
import { ReservationList } from '../features/dashboard/ReservationList'
import { CleaningPanel } from '../features/dashboard/CleaningPanel'
import { buildPropertyReportStats } from '../features/reports/reportCalculations'
import type {
  CleanStatusRecord,
  DashboardStay,
  MaintenanceIssueRecord,
  PropertyListing,
  ReservationRecord,
} from '../types/domain'
import { calculateNights, formatDisplayDate, toDateInputValue } from '../utils/date'

const platformLabels: Record<string, string> = {
  airbnb: 'Airbnb',
  booking: 'Booking',
  private: 'Private',
  maintenance: 'Maintenance',
}

function shortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [reportDate, setReportDate] = useState(toDateInputValue(new Date()))
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [allReservations, setAllReservations] = useState<ReservationRecord[]>([])
  const [cleanStatuses, setCleanStatuses] = useState<CleanStatusRecord[]>([])
  const [maintenanceIssues, setMaintenanceIssues] = useState<MaintenanceIssueRecord[]>([])
  const [forecast, setForecast] = useState<DashboardForecast | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [addReservationOpen, setAddReservationOpen] = useState(false)

  const reportMonth = Number(reportDate.slice(5, 7))
  const reportYear = Number(reportDate.slice(0, 4))
  const today = toDateInputValue(new Date())

  useEffect(() => {
    let ignore = false

    async function loadDashboard() {
      try {
        setStatus('loading')
        const [propertyRows, reservationRows, allRows, statuses, issueRows] = await Promise.all([
          fetchProperties(),
          fetchReservations({ month: reportMonth, year: reportYear }),
          fetchReservations(),
          fetchCleanStatuses(),
          fetchMaintenanceIssues(),
        ])

        if (!ignore) {
          setProperties(propertyRows)
          setReservations(reservationRows)
          setAllReservations(allRows)
          setCleanStatuses(statuses)
          setMaintenanceIssues(issueRows)
          setStatus('ready')
        }
      } catch {
        if (!ignore) {
          setStatus('error')
        }
      }
    }

    loadDashboard()

    return () => {
      ignore = true
    }
  }, [reportMonth, reportYear])

  // Forecast (workload + end-of-month turnover) is admin/management only and
  // loaded separately so a 403 for cleaners never breaks the main dashboard.
  useEffect(() => {
    if (user.role === 'cleaning') return
    let ignore = false
    fetchDashboardForecast()
      .then((data) => { if (!ignore) setForecast(data) })
      .catch(() => { if (!ignore) setForecast(null) })
    return () => { ignore = true }
  }, [user.role])

  async function handleMarkCleaned(propertyId: string, isCleaned: boolean) {
    const updated = await markApartmentCleaned(propertyId, isCleaned)
    setCleanStatuses((prev) => {
      const exists = prev.find((s) => s.propertyId === propertyId)
      if (exists) return prev.map((s) => (s.propertyId === propertyId ? updated : s))
      return [...prev, updated]
    })
  }

  // Daily movement must come from the unfiltered set: the month-scoped fetch
  // excludes reservations whose check-out IS the 1st (its filter needs
  // check_out > month start), which silently hid all check-outs on the 1st.
  const guestReservations = useMemo(
    () => allReservations.filter((r) => r.reservationType !== 'maintenance'),
    [allReservations],
  )

  const checkIns = useMemo(
    () =>
      guestReservations
        .filter((r) => r.checkIn === reportDate)
        .map((r) => toDashboardStay(r, `${r.totalNights} nights`)),
    [reportDate, guestReservations],
  )

  const checkOuts = useMemo(
    () =>
      guestReservations
        .filter((r) => r.checkOut === reportDate)
        .map((r) => toDashboardStay(r, `${r.totalNights} nights`)),
    [reportDate, guestReservations],
  )

  const currentlyStaying = useMemo(
    () =>
      guestReservations
        .filter((r) => r.checkIn <= reportDate && r.checkOut > reportDate)
        .map((r) =>
          toDashboardStay(
            r,
            `${formatDisplayDate(r.checkIn)} to ${formatDisplayDate(r.checkOut)}`,
          ),
        ),
    [reportDate, guestReservations],
  )

  const freeToday = useMemo(() => {
    return properties
      .filter(
        (property) =>
          !allReservations.some(
            (r) =>
              r.propertyId === property.id &&
              r.checkIn <= reportDate &&
              r.checkOut > reportDate &&
              r.reservationType !== 'maintenance',
          ),
      )
      .map((property) => {
        const nextRes = allReservations
          .filter(
            (r) =>
              r.propertyId === property.id &&
              r.checkIn > reportDate &&
              r.reservationType !== 'maintenance',
          )
          .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]
        const cleanStatus = cleanStatuses.find((s) => s.propertyId === property.id) || null
        const openIssues = maintenanceIssues.filter((i) => i.propertyId === property.id)
        return {
          property,
          nextCheckIn: nextRes?.checkIn || null,
          freeNights: nextRes ? calculateNights(reportDate, nextRes.checkIn) : null,
          cleanStatus,
          openIssues,
        }
      })
  }, [properties, allReservations, cleanStatuses, maintenanceIssues, reportDate])

  const propertyStats = useMemo(
    () => buildPropertyReportStats(properties, reservations, reportYear, reportMonth),
    [properties, reportMonth, reportYear, reservations],
  )

  const totalTurnover = propertyStats.reduce((sum, p) => sum + p.turnover, 0)
  const bookedNights = propertyStats.reduce((sum, p) => sum + p.bookedNights, 0)
  const freeNights = propertyStats.reduce((sum, p) => sum + p.freeNights, 0)
  const averageOccupancy =
    propertyStats.length > 0
      ? Math.round(
          propertyStats.reduce((sum, p) => sum + p.occupancy, 0) / propertyStats.length,
        )
      : 0

  const upcomingReservations = useMemo(
    () =>
      allReservations
        .filter((r) => r.checkIn >= today && r.reservationType !== 'maintenance')
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
        .slice(0, 30),
    [allReservations, today],
  )

  const workloadData = useMemo(
    () =>
      (forecast?.workload.days ?? []).map((d) => ({
        ...d,
        day: `${d.weekday} ${shortDate(d.date)}`,
      })),
    [forecast],
  )
  const monthForecast = forecast?.monthForecast ?? null

  if (user.role === 'cleaning') {
    return (
      <CleanerDashboard
        checkIns={checkIns}
        checkOuts={checkOuts}
        currentlyStaying={currentlyStaying}
        freeToday={freeToday}
        properties={properties}
        reservations={allReservations}
        cleanStatuses={cleanStatuses}
        onMarkCleaned={handleMarkCleaned}
        reportDate={reportDate}
        onDateChange={(value) => setReportDate(value)}
        status={status}
      />
    )
  }

  return (
    <div className="dashboard-grid">
      <section className="report-toolbar">
        <div>
          <p className="section-kicker">Report date</p>
          <h2>Check-ins, check-outs, and current stays</h2>
        </div>
        <div className="report-toolbar-actions">
          <DateInput
            aria-label="Report date"
            value={reportDate}
            onChange={setReportDate}
          />
          <button className="primary-button" onClick={() => setAddReservationOpen(true)}>
            <Plus size={17} />
            New reservation
          </button>
        </div>
      </section>

      <NewReservationModal
        open={addReservationOpen}
        onClose={() => setAddReservationOpen(false)}
        onSaved={() => setAddReservationOpen(false)}
      />

      {user.role === 'admin' && (
        <section className="metric-row" aria-label="Portfolio metrics">
          <Metric label="Turnover" value={`EUR ${totalTurnover.toLocaleString()}`} />
          <Metric label="Booked nights" value={bookedNights.toString()} />
          <Metric label="Free nights" value={freeNights.toString()} />
          <Metric label="Occupancy" value={`${averageOccupancy}%`} />
        </section>
      )}

      {status === 'loading' && <p className="listings-message">Loading dashboard...</p>}
      {status === 'error' && <p className="form-error">Could not load dashboard data.</p>}

      {status === 'ready' && (
        <>
          <section className="panel schedule-panel">
            <PanelHeader icon={Home} title="Daily movement" action="Open calendar" />
            <div className="schedule-columns three-columns">
              <ReservationList title="Check-ins" items={checkIns} />
              <ReservationList title="Check-outs" items={checkOuts} />
              <ReservationList title="Currently staying" items={currentlyStaying} initialVisibleCount={6} />
            </div>
          </section>

          <CleaningPanel
            properties={properties}
            reservations={allReservations}
            cleanStatuses={cleanStatuses}
            reportDate={reportDate}
            onToggleCleaned={handleMarkCleaned}
          />

          {workloadData.length > 0 && (
            <section className="panel forecast-workload-panel">
              <PanelHeader icon={Activity} title="Workload · next 14 days" />
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={workloadData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={50} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="checkIns" name="Check-ins" fill="#1f6f5b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="checkOuts" name="Check-outs" fill="#9bb8ad" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="chart-legend">
                <span><i style={{ background: '#1f6f5b' }} /> Check-ins</span>
                <span><i style={{ background: '#9bb8ad' }} /> Check-outs</span>
              </div>
            </section>
          )}

          {user.role === 'admin' && monthForecast && (
            <section className="panel month-forecast-panel">
              <PanelHeader icon={TrendingUp} title={`End-of-month forecast · ${monthForecast.monthLabel}`} />
              <div className="metric-row month-forecast-metrics">
                <Metric label="Projected turnover" value={`EUR ${monthForecast.projectedTurnoverEur.toLocaleString()}`} />
                <Metric label="On the books" value={`EUR ${monthForecast.onBooksTurnoverEur.toLocaleString()}`} />
                <Metric label="Expected pickup" value={`EUR ${monthForecast.expectedPickupEur.toLocaleString()}`} />
              </div>
              <p className="month-forecast-note">
                {monthForecast.freeNightsRemaining} free nights left this month · usual{' '}
                {monthForecast.usualOccupancyPct}% occupancy · ~EUR{' '}
                {Math.round(monthForecast.avgNightlyEur).toLocaleString()}/night
              </p>
            </section>
          )}

          <section className="panel free-apartments-panel">
            <PanelHeader icon={Home} title={`Free on ${formatDisplayDate(reportDate)} (${freeToday.length})`} />
            {freeToday.length === 0 ? (
              <p className="list-empty">All apartments are occupied on this date.</p>
            ) : (
              <div className="free-apartments-grid">
                {freeToday.map(({ property, nextCheckIn, freeNights: fn, cleanStatus, openIssues }) => (
                  <div key={property.id} className={`free-apartment-card${openIssues.length > 0 ? ' has-fix-opportunity' : ''}`}>
                    <strong>{property.name}</strong>
                    <span>{property.bedrooms} bed{property.bedrooms !== 1 ? 's' : ''}</span>
                    {nextCheckIn ? (
                      <small>Next check-in: {formatDisplayDate(nextCheckIn)} ({fn} free night{fn !== 1 ? 's' : ''})</small>
                    ) : (
                      <small>No upcoming booking</small>
                    )}
                    {cleanStatus?.isCleaned ? (
                      <span className="clean-badge cleaned">Cleaned</span>
                    ) : (
                      <span className="clean-badge dirty">Needs cleaning</span>
                    )}
                    {openIssues.length > 0 && (
                      <div className="fix-opportunity-banner">
                        <Wrench size={13} />
                        <span>
                          Fix opportunity — {openIssues.length} open issue{openIssues.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          className="fix-opportunity-link"
                          type="button"
                          onClick={() => navigate('/maintenance')}
                        >
                          View
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {upcomingReservations.length > 0 && (
            <section className="panel upcoming-panel">
              <PanelHeader icon={CalendarDays} title="Upcoming reservations" />
              <div className="upcoming-table-wrap">
                <table className="upcoming-table">
                  <thead>
                    <tr>
                      <th>Guest</th>
                      <th>Apartment</th>
                      <th>Check-in</th>
                      <th>Check-out</th>
                      <th>Nts</th>
                      <th>Payment</th>
                      <th>Source</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingReservations.map((r) => (
                      <tr key={r.id} className={r.checkIn === today ? 'upcoming-today' : ''}>
                        <td>
                          <strong>{r.guestName || r.guestPhone || '—'}</strong>
                          {r.guestName && r.guestPhone && <small>{r.guestPhone}</small>}
                        </td>
                        <td>{r.apartment}</td>
                        <td>{formatDisplayDate(r.checkIn)}</td>
                        <td>{formatDisplayDate(r.checkOut)}</td>
                        <td className="col-narrow">{r.totalNights}</td>
                        <td>
                          <span className={`payment-badge ${r.paid ? 'paid' : 'unpaid'}`}>
                            {r.paid ? 'Paid' : 'Unpaid'}
                          </span>
                        </td>
                        <td>
                          <span className="select-pill muted">
                            {platformLabels[r.reservationType] || r.reservationType}
                          </span>
                        </td>
                        <td>
                          <div className="upcoming-actions">
                            <button
                              className="action-link"
                              onClick={() => navigate('/reservations')}
                              title="View in reservations"
                            >
                              View
                            </button>
                            <button
                              className="action-link"
                              onClick={() => navigate('/invoice', { state: { reservation: r } })}
                              title="Open invoice"
                            >
                              Invoice
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

type CleanerDashboardProps = {
  checkIns: DashboardStay[]
  checkOuts: DashboardStay[]
  currentlyStaying: DashboardStay[]
  freeToday: {
    property: PropertyListing
    nextCheckIn: string | null
    freeNights: number | null
    cleanStatus: CleanStatusRecord | null
    openIssues: MaintenanceIssueRecord[]
  }[]
  properties: PropertyListing[]
  reservations: ReservationRecord[]
  cleanStatuses: CleanStatusRecord[]
  onMarkCleaned: (propertyId: string, isCleaned: boolean) => Promise<void>
  onDateChange: (value: string) => void
  reportDate: string
  status: 'loading' | 'ready' | 'error'
}

function CleanerDashboard({
  checkIns,
  checkOuts,
  currentlyStaying,
  freeToday,
  properties,
  reservations,
  cleanStatuses,
  onMarkCleaned,
  onDateChange,
  reportDate,
  status,
}: CleanerDashboardProps) {
  const [markingId, setMarkingId] = useState<string | null>(null)

  async function toggleCleaned(propertyId: string, currentlyCleaned: boolean) {
    setMarkingId(propertyId)
    try {
      await onMarkCleaned(propertyId, !currentlyCleaned)
    } finally {
      setMarkingId(null)
    }
  }

  return (
    <div className="dashboard-grid">
      <section className="report-toolbar">
        <div>
          <p className="section-kicker">Cleaning schedule</p>
          <h2>Today's tasks</h2>
        </div>
        <DateInput aria-label="Date" value={reportDate} onChange={onDateChange} />
      </section>

      <section className="metric-row" aria-label="Summary">
        <Metric label="Check-ins" value={checkIns.length.toString()} />
        <Metric label="Check-outs" value={checkOuts.length.toString()} />
        <Metric label="Hosting" value={currentlyStaying.length.toString()} />
        <Metric label="Free apts" value={freeToday.length.toString()} />
      </section>

      {status === 'loading' && <p className="listings-message">Loading...</p>}
      {status === 'error' && <p className="form-error">Could not load data.</p>}

      {status === 'ready' && (
        <>
          <section className="panel schedule-panel">
            <PanelHeader icon={Home} title="Daily movement" />
            <div className="schedule-columns three-columns">
              <ReservationList title="Check-ins" items={checkIns.map(withoutAmount)} />
              <ReservationList title="Check-outs" items={checkOuts.map(withoutAmount)} />
              <ReservationList title="Currently hosting" items={currentlyStaying.map(withoutAmount)} initialVisibleCount={6} />
            </div>
          </section>

          <CleaningPanel
            properties={properties}
            reservations={reservations}
            cleanStatuses={cleanStatuses}
            reportDate={reportDate}
            onToggleCleaned={onMarkCleaned}
          />

          <section className="panel free-apartments-panel">
            <PanelHeader icon={Home} title={`Free apartments (${freeToday.length})`} />
            {freeToday.length === 0 ? (
              <p className="list-empty">All apartments are occupied today.</p>
            ) : (
              <div className="cleaner-apt-list">
                {freeToday.map(({ property, nextCheckIn, freeNights: fn, cleanStatus, openIssues }) => {
                  const isCleaned = cleanStatus?.isCleaned ?? false
                  const isMarking = markingId === property.id
                  return (
                    <div key={property.id} className="cleaner-apt-row">
                      <div className="cleaner-apt-info">
                        <strong>{property.name}</strong>
                        <span>{property.bedrooms} bed{property.bedrooms !== 1 ? 's' : ''}{property.floor ? ` · ${property.floor}` : ''}</span>
                        {nextCheckIn ? (
                          <small>Next check-in: {formatDisplayDate(nextCheckIn)} ({fn} night{fn !== 1 ? 's' : ''} free)</small>
                        ) : (
                          <small>No upcoming booking</small>
                        )}
                        {openIssues.length > 0 && (
                          <small className="cleaner-fix-hint">
                            <Wrench size={11} />
                            {openIssues.length} maintenance issue{openIssues.length !== 1 ? 's' : ''} to fix
                          </small>
                        )}
                      </div>
                      <button
                        className={`cleaner-mark-btn ${isCleaned ? 'cleaned' : ''}`}
                        disabled={isMarking}
                        onClick={() => toggleCleaned(property.id, isCleaned)}
                        type="button"
                      >
                        {isCleaned ? (
                          <><CheckSquare size={15} /> Cleaned</>
                        ) : (
                          <><Square size={15} /> Mark cleaned</>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

// Payment amounts are management-only; cleaners never see guest money.
function withoutAmount(stay: DashboardStay): DashboardStay {
  return { ...stay, amount: undefined }
}

function toDashboardStay(reservation: ReservationRecord, detail: string): DashboardStay {
  return {
    detail,
    guestName: reservation.guestName || reservation.guestPhone || 'Guest',
    id: reservation.id,
    platform: platformLabels[reservation.reservationType] || reservation.reservationType,
    propertyName: reservation.apartment,
    amount: Number(reservation.totalPaid) || 0,
  }
}
