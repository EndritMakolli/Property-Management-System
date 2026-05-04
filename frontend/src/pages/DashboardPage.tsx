import { CalendarDays, Home } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProperties, fetchReservations } from '../api/pmsApi'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { useAuth } from '../auth/AuthContext'
import { Metric } from '../components/shared/Metric'
import { PanelHeader } from '../components/shared/PanelHeader'
import { DateInput } from '../components/shared/DateInput'
import { ReservationList } from '../features/dashboard/ReservationList'
import { reportDateChanged } from '../features/dashboard/dashboardSlice'
import type { DashboardStay, PropertyListing, ReservationRecord } from '../types/domain'
import { calculateNights, formatDisplayDate, nextDateValue, toDateInputValue } from '../utils/date'

type PropertyStat = {
  averageNightlyPrice: number
  bookedNights: number
  freeNights: number
  id: string
  name: string
  occupancy: number
  turnover: number
}

const platformLabels: Record<string, string> = {
  airbnb: 'Airbnb',
  booking: 'Booking',
  private: 'Private',
}

export function DashboardPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { user } = useAuth()
  const reportDate = useAppSelector((state) => state.dashboard.reportDate)
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [upcomingReservations, setUpcomingReservations] = useState<ReservationRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const reportMonth = Number(reportDate.slice(5, 7))
  const reportYear = Number(reportDate.slice(0, 4))
  const today = toDateInputValue(new Date())

  useEffect(() => {
    let ignore = false

    async function loadDashboard() {
      try {
        setStatus('loading')
        const [propertyRows, reservationRows, allRows] = await Promise.all([
          fetchProperties(),
          fetchReservations({ month: reportMonth, year: reportYear }),
          fetchReservations(),
        ])

        if (!ignore) {
          setProperties(propertyRows)
          setReservations(reservationRows)
          const upcoming = allRows
            .filter((r) => r.checkIn >= today)
            .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
            .slice(0, 30)
          setUpcomingReservations(upcoming)
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

  const checkIns = useMemo(
    () =>
      reservations
        .filter((reservation) => reservation.checkIn === reportDate)
        .map((reservation) => toDashboardStay(reservation, `${reservation.totalNights} nights`)),
    [reportDate, reservations],
  )

  const checkOuts = useMemo(
    () =>
      reservations
        .filter((reservation) => reservation.checkOut === reportDate)
        .map((reservation) => toDashboardStay(reservation, `${reservation.totalNights} nights`)),
    [reportDate, reservations],
  )

  const currentlyStaying = useMemo(
    () =>
      reservations
        .filter((reservation) => reservation.checkIn <= reportDate && reservation.checkOut > reportDate)
        .map((reservation) =>
          toDashboardStay(reservation, `${formatDisplayDate(reservation.checkIn)} to ${formatDisplayDate(reservation.checkOut)}`),
        ),
    [reportDate, reservations],
  )

  const propertyStats = useMemo(
    () => buildPropertyStats(properties, reservations, reportYear, reportMonth),
    [properties, reportMonth, reportYear, reservations],
  )

  const totalTurnover = propertyStats.reduce((sum, property) => sum + property.turnover, 0)
  const bookedNights = propertyStats.reduce((sum, property) => sum + property.bookedNights, 0)
  const freeNights = propertyStats.reduce((sum, property) => sum + property.freeNights, 0)
  const averageOccupancy =
    propertyStats.length > 0
      ? Math.round(propertyStats.reduce((sum, property) => sum + property.occupancy, 0) / propertyStats.length)
      : 0
  const canSeeStats = user.role === 'admin'

  return (
    <div className="dashboard-grid">
      <section className="report-toolbar">
        <div>
          <p className="section-kicker">Report date</p>
          <h2>Check-ins, check-outs, and current stays</h2>
        </div>
        <DateInput
          aria-label="Report date"
          value={reportDate}
          onChange={(value) => dispatch(reportDateChanged(value))}
        />
      </section>

      {canSeeStats && (
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
                          {r.guestName && r.guestPhone && (
                            <small>{r.guestPhone}</small>
                          )}
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

function toDashboardStay(reservation: ReservationRecord, detail: string): DashboardStay {
  return {
    detail,
    guestName: reservation.guestName || reservation.guestPhone || 'Guest',
    id: reservation.id,
    platform: platformLabels[reservation.reservationType] || reservation.reservationType,
    propertyName: reservation.apartment,
  }
}

function buildPropertyStats(
  properties: PropertyListing[],
  reservations: ReservationRecord[],
  year: number,
  month: number,
): PropertyStat[] {
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`

  return properties.map((property) => {
    const propertyReservations = reservations.filter((reservation) => reservation.propertyId === property.id)
    const turnover = propertyReservations.reduce((sum, reservation) => sum + Number(reservation.totalPaid), 0)
    const bookedNights = propertyReservations.reduce(
      (sum, reservation) => sum + nightsInsideMonth(reservation, monthStart, monthEnd),
      0,
    )
    const freeNights = Math.max(daysInMonth - bookedNights, 0)
    const occupancy = Math.round((bookedNights / daysInMonth) * 100)

    return {
      averageNightlyPrice: bookedNights > 0 ? turnover / bookedNights : 0,
      bookedNights,
      freeNights,
      id: property.id,
      name: property.name,
      occupancy,
      turnover,
    }
  })
}

function nightsInsideMonth(reservation: ReservationRecord, monthStart: string, monthEnd: string) {
  const start = reservation.checkIn > monthStart ? reservation.checkIn : monthStart
  const end = reservation.checkOut < monthEnd ? reservation.checkOut : nextDateValue(monthEnd)
  return calculateNights(start, end)
}
