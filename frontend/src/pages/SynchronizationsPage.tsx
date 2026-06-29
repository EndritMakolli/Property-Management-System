import { ChevronDown, ChevronRight, RefreshCw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  fetchProperties,
  fetchSyncLogs,
  syncPropertyCalendar,
  updatePropertySync,
} from '../api/pmsApi'
import type { PropertyListing, SyncLogRecord } from '../types/domain'

type EditableSyncProperty = PropertyListing & {
  isDirty?: boolean
  lastSyncMessage?: string
  syncing?: string | null
}

const statusLabels = {
  connected: 'Connected',
  partial: 'Partial',
  not_configured: 'Not configured',
}

export function SynchronizationsPage() {
  const [properties, setProperties] = useState<EditableSyncProperty[]>([])
  const [syncLogs, setSyncLogs] = useState<SyncLogRecord[]>([])
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  async function loadProperties() {
    try {
      setStatus('loading')
      setError('')
      const [rows, logs] = await Promise.all([fetchProperties(), fetchSyncLogs()])
      setProperties(rows.map((property) => ({ ...property, isDirty: false })))
      setSyncLogs(logs)
      setStatus('ready')
    } catch (caughtError) {
      setStatus('error')
      setError(caughtError instanceof Error ? caughtError.message : 'Could not load synchronizations.')
    }
  }

  useEffect(() => {
    loadProperties()
  }, [])

  const totals = useMemo(
    () => ({
      connected: properties.filter((p) => p.syncStatus === 'connected').length,
      partial: properties.filter((p) => p.syncStatus === 'partial').length,
      missing: properties.filter((p) => p.syncStatus === 'not_configured').length,
    }),
    [properties],
  )

  function updateRow(id: string, updates: Partial<EditableSyncProperty>) {
    setProperties((current) =>
      current.map((p) => (p.id === id ? { ...p, ...updates, isDirty: true } : p)),
    )
  }

  async function saveRow(property: EditableSyncProperty) {
    try {
      setError('')
      const saved = await updatePropertySync(property.id, {
        airbnbIcalUrl: property.airbnbIcalUrl,
        bookingIcalUrl: property.bookingIcalUrl,
        autoSyncEnabled: property.autoSyncEnabled,
        syncIntervalHours: property.syncIntervalHours,
      })
      setProperties((current) =>
        current.map((item) => (item.id === property.id ? { ...saved, isDirty: false } : item)),
      )
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not save synchronization settings.')
    }
  }

  async function syncChannel(property: EditableSyncProperty, channel: 'airbnb' | 'booking') {
    try {
      setError('')
      setProperties((current) =>
        current.map((item) => (item.id === property.id ? { ...item, syncing: channel } : item)),
      )
      const result = await syncPropertyCalendar(property.id, channel)
      const s = result.sync
      const message = `${channel}: ${s.imported} imported, ${s.updated} updated, ${s.skipped} skipped, ${s.conflicts} conflict${s.conflicts !== 1 ? 's' : ''}, ${s.cancelled} cancelled`
      setProperties((current) =>
        current.map((item) =>
          item.id === property.id ? { ...item, syncing: null, lastSyncMessage: message } : item,
        ),
      )
      if (result.sync.errors.length > 0) {
        setError(result.sync.errors.join(' '))
      }
      const logs = await fetchSyncLogs()
      setSyncLogs(logs)
    } catch (caughtError) {
      setProperties((current) =>
        current.map((item) => (item.id === property.id ? { ...item, syncing: null } : item)),
      )
      setError(caughtError instanceof Error ? caughtError.message : `Could not sync ${channel}.`)
    }
  }

  function toggleLogs(propertyId: string) {
    setExpandedLogs((prev) => {
      const next = new Set(prev)
      if (next.has(propertyId)) next.delete(propertyId)
      else next.add(propertyId)
      return next
    })
  }

  return (
    <section className="sync-page">
      <div className="sync-header">
        <div>
          <p className="eyebrow">Channels</p>
          <h2>Synchronizations</h2>
        </div>
        <button className="primary-button" onClick={loadProperties}>
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>

      <section className="sync-status-row">
        <article>
          <span>Connected</span>
          <strong>{totals.connected}</strong>
        </article>
        <article>
          <span>Partial</span>
          <strong>{totals.partial}</strong>
        </article>
        <article>
          <span>Missing links</span>
          <strong>{totals.missing}</strong>
        </article>
      </section>

      {status === 'loading' && <p className="listings-message">Loading synchronization settings...</p>}
      {status === 'error' && <p className="form-error">{error}</p>}
      {error && status === 'ready' && <p className="form-error">{error}</p>}

      {status === 'ready' && (
        <div className="sync-list">
          {properties.map((property) => {
            const logsForProperty = syncLogs.filter((l) => l.propertyId === property.id)
            const isLogsExpanded = expandedLogs.has(property.id)

            return (
              <article className="sync-card" key={property.id}>
                <div className="sync-card-main">
                  {property.photoUrl ? <img alt="" src={property.photoUrl} /> : <span />}
                  <div>
                    <h3>{property.name}</h3>
                    <p>{property.apartmentType}</p>
                    <span className={`sync-badge ${property.syncStatus}`}>
                      {statusLabels[property.syncStatus]}
                    </span>
                  </div>
                </div>

                <div className="sync-fields">
                  <label>
                    Airbnb iCal link
                    <input
                      placeholder="https://www.airbnb.com/calendar/ical/..."
                      type="url"
                      value={property.airbnbIcalUrl}
                      onChange={(event) => updateRow(property.id, { airbnbIcalUrl: event.target.value })}
                    />
                  </label>
                  <label>
                    Booking.com iCal link
                    <input
                      placeholder="https://admin.booking.com/hotel/hoteladmin/ical.html?..."
                      type="url"
                      value={property.bookingIcalUrl}
                      onChange={(event) => updateRow(property.id, { bookingIcalUrl: event.target.value })}
                    />
                  </label>
                </div>

                <div className="sync-auto-row">
                  <label className="sync-toggle-label">
                    <input
                      checked={property.autoSyncEnabled}
                      type="checkbox"
                      onChange={(e) => updateRow(property.id, { autoSyncEnabled: e.target.checked })}
                    />
                    Auto-sync
                  </label>
                  {property.autoSyncEnabled && (
                    <label className="sync-interval-label">
                      Every
                      <input
                        min="1"
                        max="168"
                        type="number"
                        value={property.syncIntervalHours}
                        onChange={(e) =>
                          updateRow(property.id, { syncIntervalHours: Number(e.target.value) })
                        }
                      />
                      hours
                    </label>
                  )}
                </div>

                <div className="sync-card-actions">
                  <label className="sync-export-link">
                    PMS export link
                    <input readOnly value={property.exportIcalUrl} onFocus={(e) => e.target.select()} />
                  </label>
                  <button disabled={!property.isDirty} onClick={() => saveRow(property)}>
                    <Save size={16} />
                    Save settings
                  </button>
                  <button
                    disabled={!property.airbnbIcalUrl || property.syncing !== null && property.syncing !== undefined}
                    onClick={() => syncChannel(property, 'airbnb')}
                  >
                    <RefreshCw size={16} />
                    {property.syncing === 'airbnb' ? 'Syncing...' : 'Sync Airbnb now'}
                  </button>
                  <button
                    disabled={!property.bookingIcalUrl || property.syncing !== null && property.syncing !== undefined}
                    onClick={() => syncChannel(property, 'booking')}
                  >
                    <RefreshCw size={16} />
                    {property.syncing === 'booking' ? 'Syncing...' : 'Sync Booking.com'}
                  </button>
                  {property.lastSyncMessage && (
                    <span className="sync-result">{property.lastSyncMessage}</span>
                  )}
                </div>

                {logsForProperty.length > 0 && (
                  <div className="sync-logs-section">
                    <button
                      className="sync-logs-toggle"
                      type="button"
                      onClick={() => toggleLogs(property.id)}
                    >
                      {isLogsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Sync history ({logsForProperty.length})
                    </button>
                    {isLogsExpanded && (
                      <table className="sync-log-table">
                        <thead>
                          <tr>
                            <th>Channel</th>
                            <th>Status</th>
                            <th>Imported</th>
                            <th>Updated</th>
                            <th>Skipped</th>
                            <th>Conflicts</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logsForProperty.slice(0, 20).map((log) => (
                            <tr key={log.id} className={log.status === 'error' ? 'sync-log-error' : ''}>
                              <td style={{ textTransform: 'capitalize' }}>{log.channel}</td>
                              <td>
                                <span className={`sync-log-status ${log.status}`}>{log.status}</span>
                              </td>
                              <td>{log.importedCount}</td>
                              <td>{log.updatedCount}</td>
                              <td>{log.skippedCount}</td>
                              <td>{log.conflictCount > 0 ? <strong style={{ color: '#9b3f20' }}>{log.conflictCount}</strong> : 0}</td>
                              <td className="sync-log-time">{new Date(log.syncedAt).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
