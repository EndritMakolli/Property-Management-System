import { CheckCircle, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  approveBookingRequest,
  fetchBookingRequests,
  rejectBookingRequest,
} from '../api/pmsApi'
import type { BookingRequestRecord } from '../types/domain'
import '../styles/booking-requests.css'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
}

export function BookingRequestsPage() {
  const [pending, setPending] = useState<BookingRequestRecord[]>([])
  const [confirmed, setConfirmed] = useState<BookingRequestRecord[]>([])
  const [totalConfirmed, setTotalConfirmed] = useState(0)
  const [confirmedOffset, setConfirmedOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectMessage, setRejectMessage] = useState('')
  const [actionError, setActionError] = useState('')

  const LIMIT = 10

  async function load(offset = 0) {
    setLoading(true)
    setError('')
    try {
      const data = await fetchBookingRequests(offset, LIMIT)
      setPending(data.pendingRequests)
      if (offset === 0) {
        setConfirmed(data.confirmedBookings)
      } else {
        setConfirmed((prev) => [...prev, ...data.confirmedBookings])
      }
      setTotalConfirmed(data.totalConfirmed)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load booking requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(0) }, [])

  async function handleApprove(id: string) {
    setApprovingId(id)
    setActionError('')
    try {
      await approveBookingRequest(id)
      await load(0)
      setConfirmedOffset(0)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Could not approve request.')
    } finally {
      setApprovingId(null)
    }
  }

  async function handleReject(id: string) {
    setActionError('')
    try {
      await rejectBookingRequest(id, rejectMessage)
      setRejectingId(null)
      setRejectMessage('')
      await load(0)
      setConfirmedOffset(0)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Could not reject request.')
    }
  }

  async function loadMore() {
    const next = confirmedOffset + LIMIT
    setConfirmedOffset(next)
    await load(next)
  }

  return (
    <div className="booking-requests-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2>Booking Requests</h2>
        {pending.length > 0 && <span className="br-badge">{pending.length}</span>}
      </div>

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
      {actionError && <p style={{ color: 'var(--error)' }}>{actionError}</p>}

      <div className="br-section">
        <div className="br-section-header">
          <h3>Pending Requests</h3>
          {pending.length > 0 && <span className="br-badge">{pending.length}</span>}
        </div>
        {loading && pending.length === 0 ? (
          <div className="br-empty">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="br-empty">No pending requests.</div>
        ) : (
          pending.map((req) => (
            <div key={req.id} className="br-card">
              <div>
                <div className="br-card-info">
                  <strong>{req.guestName}</strong>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    {req.property.name}
                  </span>
                </div>
                <div className="br-card-meta">
                  <span>{req.checkIn} → {req.checkOut} ({req.nights} nights)</span>
                  <span>{req.guestsCount} guest{req.guestsCount !== 1 ? 's' : ''}</span>
                  <span>€{parseFloat(req.totalPriceEur).toFixed(2)}</span>
                  <span>{req.guestEmail}</span>
                  <span>{req.guestPhone}</span>
                  {req.expiresAt && (
                    <span>Expires {new Date(req.expiresAt).toLocaleString()}</span>
                  )}
                  {req.promoCode && <span>Promo: {req.promoCode}</span>}
                </div>
              </div>
              <div className="br-card-actions">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleApprove(req.id)}
                  disabled={approvingId === req.id}
                  title="Approve"
                >
                  <CheckCircle size={14} />
                  {approvingId === req.id ? 'Approving…' : 'Approve'}
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => { setRejectingId(req.id); setRejectMessage(''); setActionError('') }}
                  title="Reject"
                >
                  <XCircle size={14} />
                  Reject
                </button>
              </div>
              {rejectingId === req.id && (
                <div className="br-reject-form">
                  <textarea
                    placeholder="Rejection message (optional)"
                    value={rejectMessage}
                    onChange={(e) => setRejectMessage(e.target.value)}
                  />
                  <div className="br-reject-actions">
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleReject(req.id)}
                    >
                      Confirm Rejection
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => setRejectingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="br-section">
        <div className="br-section-header">
          <h3>Recent Direct Bookings</h3>
        </div>
        {confirmed.length === 0 && !loading ? (
          <div className="br-empty">No confirmed direct bookings yet.</div>
        ) : (
          <>
            <table className="br-confirmed-table">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Property</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Nights</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Booked</th>
                </tr>
              </thead>
              <tbody>
                {confirmed.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <div>{req.guestName}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{req.guestEmail}</div>
                    </td>
                    <td>{req.property.name}</td>
                    <td>{req.checkIn}</td>
                    <td>{req.checkOut}</td>
                    <td>{req.nights}</td>
                    <td>€{parseFloat(req.totalPriceEur).toFixed(2)}</td>
                    <td>
                      <span className={`br-status-badge br-status-${req.status}`}>
                        {STATUS_LABEL[req.status] || req.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {confirmed.length < totalConfirmed && (
              <div className="br-load-more">
                <button className="btn btn-sm btn-outline" onClick={loadMore} disabled={loading}>
                  {loading ? 'Loading…' : `Load more (${totalConfirmed - confirmed.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
