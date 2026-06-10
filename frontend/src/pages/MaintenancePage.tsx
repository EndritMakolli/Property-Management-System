import { Calendar, ChevronDown, ChevronRight, Plus, Trash2, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createMaintenanceIssue,
  deleteMaintenanceIssue,
  deleteMaintenancePhoto,
  fetchMaintenanceIssues,
  fetchProperties,
  fetchReservations,
  type MaintenanceIssuePayload,
} from '../api/pmsApi'
import { CalendarOverviewTimeline } from '../features/calendar/CalendarOverviewTimeline'
import { useCalendarReservationEditor } from '../features/calendar/useCalendarReservationEditor'
import type { MaintenanceIssueRecord, PropertyListing, ReservationRecord } from '../types/domain'
import { formatDisplayDate, parseDateValue, toDateInputValue } from '../utils/date'

type IssuesByProperty = {
  property: PropertyListing
  issues: MaintenanceIssueRecord[]
}

export function MaintenancePage() {
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [issues, setIssues] = useState<MaintenanceIssueRecord[]>([])
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [reportingFor, setReportingFor] = useState<PropertyListing | null>(null)
  const [sortBy, setSortBy] = useState<'name-asc' | 'name-desc' | 'issues-desc'>('name-asc')

  // ── Fix-window finder ──────────────────────────────────────────────────────
  const [fixPropertyId, setFixPropertyId] = useState('')
  const [fixIssueId, setFixIssueId] = useState('')
  const [showFixFinder, setShowFixFinder] = useState(false)
  const [finderStartDate, setFinderStartDate] = useState(() => parseDateValue(toDateInputValue(new Date())))

  const {
    closeModal: closeFinderModal,
    handleCalendarDayClick,
    handleReservationClick,
    selectedDateKey,
    selectedPropertyId: selectedRangePropertyId,
  } = useCalendarReservationEditor()

  async function load() {
    try {
      setStatus('loading')
      const [propRows, issueRows, resRows] = await Promise.all([
        fetchProperties(),
        fetchMaintenanceIssues(),
        fetchReservations(),
      ])
      setProperties(propRows)
      setIssues(issueRows)
      setReservations(resRows)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  function toggleExpand(propertyId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(propertyId)) next.delete(propertyId)
      else next.add(propertyId)
      return next
    })
  }

  async function handleDeleteIssue(issueId: string) {
    if (!window.confirm('Delete this issue?')) return
    await deleteMaintenanceIssue(issueId)
    setIssues((prev) => prev.filter((i) => i.id !== issueId))
  }

  async function handleDeletePhoto(issueId: string, photoId: string) {
    await deleteMaintenancePhoto(photoId)
    setIssues((prev) =>
      prev.map((i) =>
        i.id === issueId ? { ...i, photos: i.photos.filter((p) => p.id !== photoId) } : i,
      ),
    )
  }

  function handleIssueCreated(issue: MaintenanceIssueRecord) {
    setIssues((prev) => [issue, ...prev])
    setExpandedIds((prev) => new Set([...prev, issue.propertyId]))
    setReportingFor(null)
  }

  // Derive finder data
  const fixProperty = useMemo(
    () => properties.find((p) => p.id === fixPropertyId) || null,
    [properties, fixPropertyId],
  )
  const fixIssue = useMemo(
    () => issues.find((i) => i.id === fixIssueId) || null,
    [issues, fixIssueId],
  )
  const issuesForFixProperty = useMemo(
    () => issues.filter((i) => i.propertyId === fixPropertyId),
    [issues, fixPropertyId],
  )
  // Free windows for the selected property: consecutive free date spans
  const freeWindows = useMemo<{ start: string; end: string; nights: number }[]>(() => {
    if (!fixPropertyId) return []
    const today = toDateInputValue(new Date())
    // Look 120 days ahead
    const windows: { start: string; end: string; nights: number }[] = []
    let windowStart: string | null = null
    const farDate = new Date()
    farDate.setDate(farDate.getDate() + 120)

    let cursor = parseDateValue(today)
    while (toDateInputValue(cursor) <= toDateInputValue(farDate)) {
      const dateKey = toDateInputValue(cursor)
      const nextDay = new Date(cursor)
      nextDay.setDate(cursor.getDate() + 1)
      const nextKey = toDateInputValue(nextDay)

      const occupied = reservations.some(
        (r) =>
          r.propertyId === fixPropertyId &&
          r.reservationType !== 'maintenance' &&
          r.checkIn < nextKey &&
          r.checkOut > dateKey,
      )

      if (!occupied) {
        if (!windowStart) windowStart = dateKey
      } else {
        if (windowStart && windowStart < dateKey) {
          const nights = Math.round(
            (parseDateValue(dateKey).getTime() - parseDateValue(windowStart).getTime()) / 86400000,
          )
          windows.push({ start: windowStart, end: dateKey, nights })
        }
        windowStart = null
      }

      cursor = nextDay
    }
    // Close last window
    if (windowStart) {
      const endKey = toDateInputValue(farDate)
      const nights = Math.round(
        (farDate.getTime() - parseDateValue(windowStart).getTime()) / 86400000,
      )
      windows.push({ start: windowStart, end: endKey, nights })
    }

    return windows
  }, [fixPropertyId, reservations])

  const byProperty: IssuesByProperty[] = properties
    .map((property) => ({
      property,
      issues: issues.filter((i) => i.propertyId === property.id),
    }))
    .sort((a, b) => {
      if (sortBy === 'issues-desc') return b.issues.length - a.issues.length
      const cmp = a.property.name.localeCompare(b.property.name, undefined, { numeric: true })
      return sortBy === 'name-asc' ? cmp : -cmp
    })

  const totalIssues = issues.length

  return (
    <div className="maintenance-page">
      <div className="maintenance-header">
        <div>
          <p className="eyebrow">Maintenance</p>
          <h2>To Fix</h2>
          {status === 'ready' && (
            <p className="maintenance-summary">
              {totalIssues} open issue{totalIssues !== 1 ? 's' : ''} across {properties.length} apartment{properties.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="maintenance-sort-row">
          <label className="maintenance-sort-label">
            Sort
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
              <option value="name-asc">Name A → Z</option>
              <option value="name-desc">Name Z → A</option>
              <option value="issues-desc">Most issues first</option>
            </select>
          </label>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading...</p>}
      {status === 'error' && <p className="form-error">Could not load maintenance issues.</p>}

      {/* ── Fix-window finder ── */}
      {status === 'ready' && (
        <div className="maintenance-finder-panel">
          <button
            className="maintenance-finder-toggle"
            type="button"
            onClick={() => setShowFixFinder((v) => !v)}
          >
            <Calendar size={16} />
            Find free dates to fix an issue
            {showFixFinder ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>

          {showFixFinder && (
            <div className="maintenance-finder-body">
              <div className="maintenance-finder-form">
                <label>
                  Apartment
                  <select
                    value={fixPropertyId}
                    onChange={(e) => { setFixPropertyId(e.target.value); setFixIssueId('') }}
                  >
                    <option value="">— choose apartment —</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Issue (optional)
                  <select
                    value={fixIssueId}
                    onChange={(e) => setFixIssueId(e.target.value)}
                    disabled={!fixPropertyId}
                  >
                    <option value="">— any issue —</option>
                    {issuesForFixProperty.map((i) => (
                      <option key={i.id} value={i.id}>{i.description}</option>
                    ))}
                  </select>
                </label>
              </div>

              {fixIssue && (
                <div className="maintenance-finder-issue">
                  <Wrench size={13} />
                  <span><strong>Issue:</strong> {fixIssue.description}</span>
                  <small>Reported {fixIssue.reportedAt} by {fixIssue.reporterName || 'unknown'}</small>
                </div>
              )}

              {fixPropertyId && freeWindows.length > 0 && (
                <>
                  <p className="maintenance-finder-desc">
                    Free windows for <strong>{fixProperty?.name}</strong> (next 120 days):
                  </p>
                  <div className="maintenance-finder-windows">
                    {freeWindows.map((w) => (
                      <div
                        key={w.start}
                        className="maintenance-finder-window"
                        role="button"
                        tabIndex={0}
                        onClick={() => setFinderStartDate(parseDateValue(w.start))}
                        onKeyDown={(e) => e.key === 'Enter' && setFinderStartDate(parseDateValue(w.start))}
                      >
                        <strong>{formatDisplayDate(w.start)}</strong>
                        <span>→ {formatDisplayDate(w.end)}</span>
                        <small>{w.nights} free night{w.nights !== 1 ? 's' : ''}</small>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {fixPropertyId && freeWindows.length === 0 && (
                <p className="maintenance-finder-desc">
                  No free windows found in the next 120 days for <strong>{fixProperty?.name}</strong>.
                </p>
              )}

              {fixPropertyId && (
                <CalendarOverviewTimeline
                  emptyMessage="Select an apartment to see availability."
                  onDayClick={handleCalendarDayClick}
                  onMoveRange={(days) => {
                    if (days === 0) {
                      setFinderStartDate(parseDateValue(toDateInputValue(new Date())))
                      return
                    }
                    setFinderStartDate((cur) => {
                      const next = new Date(cur)
                      next.setDate(cur.getDate() + days)
                      return next
                    })
                  }}
                  onReservationClick={handleReservationClick}
                  properties={fixProperty ? [fixProperty] : []}
                  reservations={reservations}
                  selectedDateKey={selectedDateKey}
                  selectedPropertyId={selectedRangePropertyId}
                  startDate={finderStartDate}
                  status={status}
                  subtitle={fixIssue ? fixIssue.description : (fixProperty?.name ?? '')}
                  title="Fix window calendar"
                  visibleDays={14}
                />
              )}
            </div>
          )}
        </div>
      )}

      {status === 'ready' && (
        <div className="maintenance-list">
          {byProperty.map(({ property, issues: propertyIssues }) => {
            const isExpanded = expandedIds.has(property.id)
            return (
              <div
                key={property.id}
                className={`maintenance-property ${propertyIssues.length > 0 ? 'has-issues' : ''}`}
              >
                <button
                  className="maintenance-property-header"
                  type="button"
                  onClick={() => toggleExpand(property.id)}
                >
                  <Wrench size={16} />
                  <span className="maintenance-property-name">{property.name}</span>
                  {propertyIssues.length > 0 && (
                    <span className="maintenance-issue-count">{propertyIssues.length}</span>
                  )}
                  <span className="maintenance-expand-icon">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </button>

                {isExpanded && (
                  <div className="maintenance-issues">
                    {propertyIssues.length === 0 ? (
                      <p className="maintenance-no-issues">No issues reported.</p>
                    ) : (
                      propertyIssues.map((issue) => (
                        <div key={issue.id} className="maintenance-issue-card">
                          <div className="maintenance-issue-header">
                            <div className="maintenance-issue-meta">
                              <strong>{issue.description}</strong>
                              <span>
                                Reported by {issue.reporterName || 'unknown'} on {issue.reportedAt}
                              </span>
                            </div>
                            <button
                              className="maintenance-delete-btn"
                              title="Delete issue"
                              type="button"
                              onClick={() => handleDeleteIssue(issue.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {issue.photos.length > 0 && (
                            <div className="maintenance-photos">
                              {issue.photos.map((photo) => (
                                <div key={photo.id} className="maintenance-photo-wrap">
                                  <img alt="Issue" src={photo.url} />
                                  <button
                                    className="maintenance-photo-delete"
                                    title="Remove photo"
                                    type="button"
                                    onClick={() => handleDeletePhoto(issue.id, photo.id)}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                    <button
                      className="maintenance-report-btn"
                      type="button"
                      onClick={() => setReportingFor(property)}
                    >
                      <Plus size={15} />
                      Report issue
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {reportingFor && (
        <ReportIssueModal
          property={reportingFor}
          onClose={() => setReportingFor(null)}
          onSaved={handleIssueCreated}
        />
      )}
    </div>
  )
}

function ReportIssueModal({
  property,
  onClose,
  onSaved,
}: {
  property: PropertyListing
  onClose: () => void
  onSaved: (issue: MaintenanceIssueRecord) => void
}) {
  const [description, setDescription] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!description.trim()) return

    setSaving(true)
    setError('')
    try {
      const files = fileInputRef.current?.files
      const photos: File[] = []
      if (files) {
        for (let i = 0; i < files.length; i++) photos.push(files[i])
      }
      const payload: MaintenanceIssuePayload = {
        propertyId: property.id,
        description,
        reporterName,
        photos,
      }
      const issue = await createMaintenanceIssue(payload)
      onSaved(issue)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save issue.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ minWidth: 380, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Report issue — {property.name}</h3>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: '0.84rem', fontWeight: 700 }}>
            Description
            <textarea
              autoFocus
              required
              placeholder="Describe the issue..."
              rows={4}
              style={{ border: '1px solid #cbd5d0', borderRadius: 8, padding: 10, resize: 'vertical' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: '0.84rem', fontWeight: 700 }}>
            Your name (optional)
            <input
              placeholder="Cleaner / staff name"
              style={{ minHeight: 40, border: '1px solid #cbd5d0', borderRadius: 8, padding: '0 10px' }}
              type="text"
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: '0.84rem', fontWeight: 700 }}>
            Photos (optional)
            <input accept="image/*" multiple ref={fileInputRef} type="file" />
          </label>
          <div className="modal-footer" style={{ marginTop: 4 }}>
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Saving...' : 'Report issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
