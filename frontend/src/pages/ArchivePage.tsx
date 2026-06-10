import { Archive, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  fetchArchivedReservations,
  permanentDeleteReservation,
  restoreReservation,
} from '../api/pmsApi'
import type { ReservationRecord } from '../types/domain'
import { formatDisplayDate } from '../utils/date'

export function ArchivePage() {
  const [records, setRecords] = useState<ReservationRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  async function load() {
    try {
      setStatus('loading')
      setError('')
      const rows = await fetchArchivedReservations()
      setRecords(rows)
      setStatus('ready')
    } catch {
      setStatus('error')
      setError('Could not load archive.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleRestore(id: string) {
    try {
      await restoreReservation(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
    } catch {
      setError('Could not restore reservation.')
    }
  }

  async function handlePermanentDelete(id: string) {
    if (!window.confirm('Permanently delete this reservation? This cannot be undone.')) return
    try {
      await permanentDeleteReservation(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
    } catch {
      setError('Could not permanently delete reservation.')
    }
  }

  function daysUntilPurge(archivedAt: string): number {
    if (!archivedAt) return 30
    const archived = new Date(archivedAt)
    const purgeDate = new Date(archived.getTime() + 30 * 24 * 60 * 60 * 1000)
    const now = new Date()
    return Math.max(0, Math.ceil((purgeDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
  }

  return (
    <section className="panel page-panel archive-page">
      <div className="archive-header">
        <div className="archive-header-text">
          <p className="eyebrow">Deleted</p>
          <h2>
            <Archive size={20} />
            Archive
          </h2>
        </div>
        <p className="archive-info-text">
          Deleted reservations are kept here for 30 days, then permanently removed.
        </p>
      </div>

      {status === 'loading' && <p className="listings-message">Loading archive...</p>}
      {status === 'error' && <p className="form-error">{error}</p>}
      {error && status === 'ready' && <p className="form-error">{error}</p>}

      {status === 'ready' && records.length === 0 && (
        <p className="listings-message">No archived reservations.</p>
      )}

      {status === 'ready' && records.length > 0 && (
        <div className="table-scroll">
          <table className="archived-full-table">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Apartment</th>
                <th>Platform</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Total</th>
                <th>Archived on</th>
                <th>Auto-deletes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const days = daysUntilPurge(r.archivedAt)
                return (
                  <tr key={r.id} className={days <= 3 ? 'row-expiring' : ''}>
                    <td>
                      <strong>{r.guestName || r.guestPhone || '—'}</strong>
                      {r.guestName && r.guestPhone && <small className="col-muted">{r.guestPhone}</small>}
                    </td>
                    <td>{r.apartment}</td>
                    <td>
                      <span className={`platform-badge platform-${r.reservationType}`}>
                        {r.reservationType}
                      </span>
                    </td>
                    <td>{formatDisplayDate(r.checkIn)}</td>
                    <td>{formatDisplayDate(r.checkOut)}</td>
                    <td>{r.totalPaid} EUR</td>
                    <td className="col-muted">
                      {r.archivedAt ? formatDisplayDate(r.archivedAt.slice(0, 10)) : '—'}
                    </td>
                    <td>
                      <span className={days <= 3 ? 'archive-expiring-badge' : 'archive-days-badge'}>
                        {days}d
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="restore-button"
                          title="Restore this reservation"
                          type="button"
                          onClick={() => handleRestore(r.id)}
                        >
                          <RotateCcw size={13} />
                          Restore
                        </button>
                        <button
                          className="danger-text-btn"
                          title="Permanently delete"
                          type="button"
                          onClick={() => handlePermanentDelete(r.id)}
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
