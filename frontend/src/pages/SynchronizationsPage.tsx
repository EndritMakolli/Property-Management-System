import { RefreshCw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchProperties, syncPropertyCalendar, updatePropertySync } from '../api/pmsApi'
import type { PropertyListing } from '../types/domain'

type EditableSyncProperty = PropertyListing & {
  isDirty?: boolean
  lastSyncMessage?: string
  syncing?: boolean
}

const statusLabels = {
  connected: 'Connected',
  partial: 'Partial',
  not_configured: 'Not configured',
}

export function SynchronizationsPage() {
  const [properties, setProperties] = useState<EditableSyncProperty[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  async function loadProperties() {
    try {
      setStatus('loading')
      setError('')
      const rows = await fetchProperties()
      setProperties(rows.map((property) => ({ ...property, isDirty: false })))
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
      connected: properties.filter((property) => property.syncStatus === 'connected').length,
      partial: properties.filter((property) => property.syncStatus === 'partial').length,
      missing: properties.filter((property) => property.syncStatus === 'not_configured').length,
    }),
    [properties],
  )

  function updateRow(id: string, updates: Partial<EditableSyncProperty>) {
    setProperties((current) =>
      current.map((property) =>
        property.id === id ? { ...property, ...updates, isDirty: true } : property,
      ),
    )
  }

  async function saveRow(property: EditableSyncProperty) {
    try {
      setError('')
      const saved = await updatePropertySync(property.id, {
        airbnbIcalUrl: property.airbnbIcalUrl,
        bookingIcalUrl: property.bookingIcalUrl,
      })
      setProperties((current) =>
        current.map((item) => (item.id === property.id ? { ...saved, isDirty: false } : item)),
      )
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not save synchronization links.')
    }
  }

  async function syncAirbnb(property: EditableSyncProperty) {
    try {
      setError('')
      setProperties((current) =>
        current.map((item) => (item.id === property.id ? { ...item, syncing: true } : item)),
      )
      const result = await syncPropertyCalendar(property.id, 'airbnb')
      const message = `${result.sync.imported} imported, ${result.sync.updated} updated, ${result.sync.skipped} skipped`
      setProperties((current) =>
        current.map((item) =>
          item.id === property.id ? { ...item, syncing: false, lastSyncMessage: message } : item,
        ),
      )
      if (result.sync.errors.length > 0) {
        setError(result.sync.errors.join(' '))
      }
    } catch (caughtError) {
      setProperties((current) =>
        current.map((item) => (item.id === property.id ? { ...item, syncing: false } : item)),
      )
      setError(caughtError instanceof Error ? caughtError.message : 'Could not sync Airbnb calendar.')
    }
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
          Refresh status
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
          {properties.map((property) => (
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

              <div className="sync-card-actions">
                <p>
                  Automatic reservation import can use these private calendar links. Full channel API
                  sync can be added later.
                </p>
                <label className="sync-export-link">
                  PMS export link
                  <input readOnly value={property.exportIcalUrl} onFocus={(event) => event.target.select()} />
                </label>
                <button disabled={!property.isDirty} onClick={() => saveRow(property)}>
                  <Save size={16} />
                  Save links
                </button>
                <button
                  disabled={!property.airbnbIcalUrl || property.syncing}
                  onClick={() => syncAirbnb(property)}
                >
                  <RefreshCw size={16} />
                  {property.syncing ? 'Syncing...' : 'Sync Airbnb now'}
                </button>
                {property.lastSyncMessage && <span className="sync-result">{property.lastSyncMessage}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
