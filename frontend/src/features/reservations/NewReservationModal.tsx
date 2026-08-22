import { StayDateRangeField } from '../../components/shared/StayDateRangeField'
import { ArrowRight, FileText, Repeat, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchGuests } from '../../api/guests'
import {
  createReservation,
  deleteReservation,
  fetchMaintenanceIssues,
  fetchProperties,
  fetchReservations,
  updateReservation,
  type ReservationPayload,
} from '../../api/pmsApi'
import { DateInput } from '../../components/shared/DateInput'
import type { GuestRecord, MaintenanceIssueRecord, PropertyListing, ReservationPlatform, ReservationRecord } from '../../types/domain'
import { calculateNights, toDateInputValue } from '../../utils/date'
import { stayPeriods } from '../payments/paymentPeriods'
import { useReservationTypeOptions } from './reservationOptions'
import { useSmartChange } from './useSmartChange'

type NewReservationModalProps = {
  initialValues?: Partial<ReservationPayload>
  mode?: 'create' | 'edit'
  onClose: () => void
  onSaved?: () => void
  open: boolean
  reservation?: ReservationRecord | null
}

export function NewReservationModal({
  initialValues,
  mode = 'create',
  onClose,
  onSaved,
  open,
  reservation,
}: NewReservationModalProps) {
  const reservationTypeOptions = useReservationTypeOptions()
  const navigate = useNavigate()
  const today = toDateInputValue(new Date())
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)

  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [maintenanceIssues, setMaintenanceIssues] = useState<MaintenanceIssueRecord[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle')
  const [error, setError] = useState('')
  const [totalDraft, setTotalDraft] = useState<string | null>(null)
  const defaultForm: ReservationPayload = {
    guestName: '',
    guestPhone: '',
    guestEmail: '',
    guestId: '',
    paymentDue: '',
    paid: false,
    notes: '',
    reservationType: 'private',
    propertyId: '',
    checkIn: today,
    checkOut: toDateInputValue(tomorrowDate),
    nightlyPrice: '0.00',
    monthlyPrice: '',
  }

  const [form, setForm] = useState<ReservationPayload>(defaultForm)

  // ── Returning-guest picker ──
  const [guestSearchOpen, setGuestSearchOpen] = useState(false)
  const [guestQuery, setGuestQuery] = useState('')
  const [guestResults, setGuestResults] = useState<GuestRecord[]>([])
  const [guestSearchLoading, setGuestSearchLoading] = useState(false)
  const [linkedGuestName, setLinkedGuestName] = useState('')

  // ── In-modal "change apartment" (edit mode) ──
  const [changeOpen, setChangeOpen] = useState(false)
  const [changeReservations, setChangeReservations] = useState<ReservationRecord[]>([])
  const [changeLoading, setChangeLoading] = useState(false)
  const [movedTo, setMovedTo] = useState('')

  const {
    availableProperties,
    freeUpOptions,
    nights: changeNights,
    doChange,
    doSwap,
    saving: changeSaving,
    saveError: changeError,
    reset: resetChange,
  } = useSmartChange({
    reservation: changeOpen && mode === 'edit' ? reservation ?? null : null,
    properties,
    reservations: changeReservations,
    onChanged: () => {
      window.dispatchEvent(new CustomEvent('pms:reservation-created'))
    },
  })

  useEffect(() => {
    if (!open) {
      return
    }

    let ignore = false

    async function loadProperties() {
      try {
        setStatus('loading')
        setError('')
        const [rows, issueRows] = await Promise.all([fetchProperties(), fetchMaintenanceIssues()])
        if (ignore) {
          return
        }

        setProperties(rows)
        setMaintenanceIssues(issueRows)
        setForm((current) => {
          const selectedProperty = rows.find((property) => property.id === current.propertyId) || rows[0]
          return {
            ...current,
            propertyId: selectedProperty?.id || '',
          }
        })
        setStatus('idle')
      } catch {
        if (!ignore) {
          setStatus('error')
          setError('Could not load properties. Start the Django server and try again.')
        }
      }
    }

    loadProperties()

    return () => {
      ignore = true
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setChangeOpen(false)
      setMovedTo('')
      return
    }

    if (mode === 'edit' && reservation) {
      setForm({
        guestName: reservation.guestName,
        guestPhone: reservation.guestPhone,
        guestEmail: reservation.guestEmail ?? '',
        guestId: reservation.guestId ?? '',
        paymentDue: reservation.paymentDue,
        paid: reservation.paid,
        notes: reservation.notes,
        reservationType: reservation.reservationType,
        propertyId: reservation.propertyId,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        nightlyPrice: reservation.nightlyPrice,
        monthlyPrice: reservation.monthlyPrice ?? '',
      })
      setTotalDraft(null)
      return
    }

    setForm({ ...defaultForm, ...initialValues })
    setTotalDraft(null)
    // `defaultForm` is a fresh object each render; the form should only
    // re-seed when the modal (re)opens or switches reservation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues, mode, open, reservation])

  // Debounced client-directory search for the returning-guest picker.
  useEffect(() => {
    if (!guestSearchOpen) {
      return
    }
    let ignore = false
    setGuestSearchLoading(true)
    const timer = window.setTimeout(() => {
      fetchGuests(guestQuery)
        .then((rows) => {
          if (!ignore) setGuestResults(rows.slice(0, 25))
        })
        .catch(() => {
          if (!ignore) setGuestResults([])
        })
        .finally(() => {
          if (!ignore) setGuestSearchLoading(false)
        })
    }, 250)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [guestSearchOpen, guestQuery])

  // Load the full reservation list only when the change panel is opened.
  useEffect(() => {
    if (!changeOpen) {
      return
    }
    let ignore = false
    setChangeLoading(true)
    fetchReservations()
      .then((rows) => {
        if (!ignore) setChangeReservations(rows)
      })
      .catch(() => {
        if (!ignore) setChangeReservations([])
      })
      .finally(() => {
        if (!ignore) setChangeLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [changeOpen])

  const isMaintenance = form.reservationType === 'maintenance'
  const isMonthly = form.reservationType === 'monthly'
  const selectedProperty = properties.find((property) => property.id === form.propertyId)
  const nights = calculateNights(form.checkIn, form.checkOut)
  const periods = useMemo(
    () => (isMonthly ? stayPeriods({ checkIn: form.checkIn, checkOut: form.checkOut }) : []),
    [isMonthly, form.checkIn, form.checkOut],
  )
  const issuesForProperty = useMemo(
    () => maintenanceIssues.filter((i) => i.propertyId === form.propertyId),
    [maintenanceIssues, form.propertyId],
  )
  const total = useMemo(() => {
    if (isMonthly) {
      const monthly = Number(form.monthlyPrice)
      return Number.isFinite(monthly) && periods.length > 0 ? (monthly * periods.length).toFixed(2) : '0.00'
    }
    const nightlyPrice = Number(form.nightlyPrice)
    return Number.isFinite(nightlyPrice) && nights > 0 ? (nightlyPrice * nights).toFixed(2) : '0.00'
  }, [isMonthly, form.monthlyPrice, form.nightlyPrice, nights, periods.length])

  if (!open) {
    return null
  }

  function updateForm(updates: Partial<ReservationPayload>) {
    if ('nightlyPrice' in updates || 'checkIn' in updates || 'checkOut' in updates || 'propertyId' in updates) {
      setTotalDraft(null)
    }
    setForm((current) => {
      const next = { ...current, ...updates }
      if (updates.reservationType === 'airbnb' && current.reservationType !== 'airbnb') {
        next.nightlyPrice = '0.00'
      }
      // Manually editing the guest details breaks the link to a picked client —
      // the backend will re-match by phone/name instead.
      if (
        !('guestId' in updates) &&
        ('guestName' in updates || 'guestPhone' in updates || 'guestEmail' in updates)
      ) {
        next.guestId = ''
      }
      return next
    })
    if (!('guestId' in updates) && ('guestName' in updates || 'guestPhone' in updates || 'guestEmail' in updates)) {
      setLinkedGuestName('')
    }
  }

  function pickGuest(guest: GuestRecord) {
    updateForm({
      guestName: guest.fullName,
      guestPhone: guest.phone,
      guestEmail: guest.email,
      guestId: guest.id,
    })
    setLinkedGuestName(guest.fullName)
    setGuestSearchOpen(false)
    setGuestQuery('')
  }

  function updateTotalPrice(totalValue: string) {
    const totalPrice = Number(totalValue)
    setTotalDraft(totalValue)
    setForm((current) => {
      return {
        ...current,
        nightlyPrice:
          Number.isFinite(totalPrice) && nights > 0 ? (totalPrice / nights).toFixed(2) : '0.00',
      }
    })
  }

  async function saveReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('saving')
    setError('')

    const payload: ReservationPayload = {
      ...form,
      // Leaving/entering the monthly type keeps the backend price in step.
      monthlyPrice: isMonthly ? form.monthlyPrice : '',
    }

    try {
      if (mode === 'edit' && reservation) {
        await updateReservation(reservation.id, payload)
      } else {
        await createReservation(payload)
      }
      window.dispatchEvent(new CustomEvent('pms:reservation-created'))
      onSaved?.()
      onClose()
    } catch (caughtError) {
      setStatus('idle')
      setError(caughtError instanceof Error ? caughtError.message : 'Could not create reservation.')
    }
  }

  async function removeReservation() {
    if (mode !== 'edit' || !reservation) {
      return
    }

    if (!window.confirm('Delete this reservation?')) {
      return
    }

    setStatus('saving')
    setError('')

    try {
      await deleteReservation(reservation.id)
      window.dispatchEvent(new CustomEvent('pms:reservation-created'))
      onSaved?.()
      onClose()
    } catch (caughtError) {
      setStatus('idle')
      setError(caughtError instanceof Error ? caughtError.message : 'Could not delete reservation.')
    }
  }

  async function pickChangeProperty(propertyId: string) {
    const ok = await doChange(propertyId)
    if (ok) {
      const moved = properties.find((p) => p.id === propertyId)
      setMovedTo(moved?.name || 'the new apartment')
      updateForm({ propertyId })
      setChangeOpen(false)
    }
  }

  async function pickSwap(option: (typeof freeUpOptions)[number]) {
    const ok = await doSwap(option)
    if (ok) {
      setMovedTo(option.targetProperty.name)
      updateForm({ propertyId: option.targetProperty.id })
      setChangeOpen(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal form-modal form-modal--wide" aria-modal="true" role="dialog">
        <div className="form-modal-head">
          <div>
            <h3>{mode === 'edit' ? 'Edit reservation' : 'New reservation'}</h3>
            <p>{mode === 'edit' ? 'Update or delete this booking.' : 'Add a booking directly from any page.'}</p>
          </div>
          <button className="form-modal-close" aria-label="Close" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="form-modal-body" id="reservation-form" onSubmit={saveReservation}>
          {error && <p className="form-error">{error}</p>}
          {movedTo && (
            <p className="form-success-note">
              Moved to <strong>{movedTo}</strong>. Other edits still need “Save changes”.
            </p>
          )}

          {!isMaintenance && (
            <div className="form-section">
              <p className="form-section-title">Guest</p>
              <div className="form-grid">
                <label className="form-field">
                  Guest name
                  <input
                    type="text"
                    value={form.guestName}
                    onChange={(event) => updateForm({ guestName: event.target.value })}
                  />
                </label>
                <label className="form-field">
                  Phone
                  <input
                    type="tel"
                    value={form.guestPhone}
                    onChange={(event) => updateForm({ guestPhone: event.target.value })}
                  />
                </label>
                <label className="form-field wide">
                  Email
                  <input
                    type="email"
                    placeholder="guest@example.com"
                    value={form.guestEmail ?? ''}
                    onChange={(event) => updateForm({ guestEmail: event.target.value })}
                  />
                </label>
              </div>

              <div className="pill-toggle-group" style={{ marginTop: 10 }}>
                <button
                  className={`pill-button${guestSearchOpen ? ' accent' : ''}`}
                  type="button"
                  onClick={() => setGuestSearchOpen((current) => !current)}
                >
                  <RotateCcw size={14} /> Returning guest
                </button>
                {linkedGuestName && !guestSearchOpen && (
                  <span className="returning-badge">Linked to {linkedGuestName}</span>
                )}
              </div>

              {guestSearchOpen && (
                <div className="form-inline-panel">
                  <input
                    autoFocus
                    placeholder="Search clients by name, phone or email…"
                    type="search"
                    value={guestQuery}
                    onChange={(event) => setGuestQuery(event.target.value)}
                    style={{ width: '100%', marginBottom: 10 }}
                  />
                  {guestSearchLoading ? (
                    <p className="listings-message">Searching…</p>
                  ) : guestResults.length === 0 ? (
                    <p className="listings-message">No matching clients.</p>
                  ) : (
                    <ul className="form-inline-list">
                      {guestResults.map((guest) => (
                        <li key={guest.id}>
                          <span>
                            <strong>{guest.fullName}</strong>
                            {guest.phone ? ` · ${guest.phone}` : ''}
                            {` · ${guest.totalStays} stay${guest.totalStays !== 1 ? 's' : ''}`}
                          </span>
                          <button className="pill-button primary" type="button" onClick={() => pickGuest(guest)}>
                            Select
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="form-section">
            <p className="form-section-title">Stay</p>
            <div className="form-grid">
              <label className="form-field">
                Property
                <select
                  required
                  value={form.propertyId}
                  onChange={(event) => {
                    updateForm({
                      propertyId: event.target.value,
                    })
                  }}
                >
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Type
                <select
                  value={form.reservationType}
                  onChange={(event) =>
                    updateForm({ reservationType: event.target.value as ReservationPlatform })
                  }
                >
                  {reservationTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-field form-field-wide">
                {/* No `blocked` here: the modal does not hold the other
                    reservations, and fetching them only to grey out nights
                    would add a request for something the server already
                    refuses with a clear message. */}
                <StayDateRangeField
                  checkIn={form.checkIn}
                  checkOut={form.checkOut}
                  onChange={(checkIn, checkOut) => updateForm({ checkIn, checkOut })}
                />
              </div>
            </div>
          </div>

          {!isMaintenance && (
            <div className="form-section">
              <p className="form-section-title">{isMonthly ? 'Monthly pricing' : 'Pricing'}</p>
              <div className="form-grid">
                {isMonthly ? (
                  <label className="form-field">
                    Monthly price (EUR)
                    <input
                      min="0"
                      step="0.01"
                      type="number"
                      value={form.monthlyPrice ?? ''}
                      onChange={(event) => updateForm({ monthlyPrice: event.target.value })}
                    />
                    <span className="form-field-hint">
                      Flat rent per month from the check-in day — €600 stays €600 in a 28-day month.
                    </span>
                  </label>
                ) : (
                  <>
                    <label className="form-field">
                      Nightly price
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={form.nightlyPrice}
                        onChange={(event) => updateForm({ nightlyPrice: event.target.value })}
                      />
                    </label>
                    <label className="form-field">
                      Total price
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={totalDraft ?? total}
                        onChange={(event) => updateTotalPrice(event.target.value)}
                      />
                    </label>
                  </>
                )}
                <label className="form-field">
                  Payment due
                  <DateInput ariaLabel="Payment due" value={form.paymentDue} onChange={(value) => updateForm({ paymentDue: value })} />
                </label>
                <label className="form-checkbox-row">
                  <input
                    checked={form.paid}
                    type="checkbox"
                    onChange={(event) => updateForm({ paid: event.target.checked })}
                  />
                  Paid in full
                </label>
              </div>
            </div>
          )}

          <div className="form-section">
            <p className="form-section-title">Notes</p>
            <label className="form-field">
              <textarea
                value={form.notes}
                onChange={(event) => updateForm({ notes: event.target.value })}
              />
            </label>

            {/* ── Issue picker: shown when maintenance type + property has open issues ── */}
            {isMaintenance && issuesForProperty.length > 0 && (
              <div className="maintenance-issue-picker wide-field">
                <p className="maintenance-issue-picker-label">
                  Open issues for {selectedProperty?.name} — click to prefill notes
                </p>
                <div className="maintenance-issue-picker-list">
                  {issuesForProperty.map((issue) => (
                    <button
                      key={issue.id}
                      className="maintenance-issue-picker-item"
                      type="button"
                      onClick={() =>
                        updateForm({
                          notes: form.notes
                            ? `${form.notes}\n\nIssue: ${issue.description}`
                            : `Issue: ${issue.description}`,
                        })
                      }
                    >
                      <strong>{issue.description}</strong>
                      <small>Reported {issue.reportedAt}{issue.reporterName ? ` by ${issue.reporterName}` : ''}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {mode === 'edit' && reservation && !isMaintenance && (
            <div className="form-section">
              <p className="form-section-title">Quick actions</p>
              <div className="pill-toggle-group">
                <button
                  className={`pill-button${changeOpen ? ' accent' : ''}`}
                  type="button"
                  onClick={() => {
                    setChangeOpen((current) => !current)
                    resetChange()
                  }}
                >
                  <Repeat size={15} /> {changeOpen ? 'Close change panel' : 'Change apartment'}
                </button>
                <button
                  className="pill-button"
                  type="button"
                  onClick={() => navigate('/invoice', { state: { reservation } })}
                >
                  <FileText size={15} /> Invoice
                </button>
              </div>

              {changeOpen && (
                <div className="form-inline-panel">
                  {changeError && <p className="form-error">{changeError}</p>}
                  {changeLoading ? (
                    <p className="listings-message">Checking availability…</p>
                  ) : (
                    <>
                      <h4>
                        {availableProperties.length > 0
                          ? `${availableProperties.length} free apartment${availableProperties.length !== 1 ? 's' : ''} for ${changeNights} night${changeNights !== 1 ? 's' : ''}`
                          : freeUpOptions.length > 0
                            ? 'No free apartments — but a swap could free one up'
                            : 'No free apartments or swaps for these dates.'}
                      </h4>

                      {availableProperties.length > 0 && (
                        <ul className="form-inline-list">
                          {availableProperties.map((prop) => (
                            <li key={prop.id}>
                              <span>
                                <strong>{prop.name}</strong> · {prop.apartmentType} ·{' '}
                                {Number(prop.basePriceEur || 0).toFixed(0)} EUR/night
                              </span>
                              <button
                                className="pill-button primary"
                                disabled={changeSaving === prop.id}
                                type="button"
                                onClick={() => pickChangeProperty(prop.id)}
                              >
                                {changeSaving === prop.id ? 'Moving…' : 'Change here'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      {availableProperties.length === 0 && freeUpOptions.length > 0 && (
                        <ul className="form-inline-list">
                          {freeUpOptions.map((opt) => (
                            <li key={`${opt.targetProperty.id}-${opt.blockingReservation.id}`}>
                              <span>
                                Move{' '}
                                <strong>
                                  {opt.blockingReservation.guestName || opt.blockingReservation.guestPhone || 'Guest'}
                                </strong>{' '}
                                {opt.targetProperty.name} <ArrowRight size={12} /> {opt.alternativeProperty.name}, then
                                take <strong>{opt.targetProperty.name}</strong>
                              </span>
                              <button
                                className="pill-button primary"
                                disabled={changeSaving === opt.targetProperty.id + '-swap'}
                                type="button"
                                onClick={() => pickSwap(opt)}
                              >
                                {changeSaving === opt.targetProperty.id + '-swap' ? 'Swapping…' : 'Do this swap'}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </form>

        <div className="form-modal-footer">
          <span className="form-modal-summary">
            {selectedProperty?.apartmentType || 'Choose property'} ·{' '}
            {isMonthly ? (
              <strong>
                {periods.length} month{periods.length !== 1 ? 's' : ''}
                {` × ${Number(form.monthlyPrice || 0).toFixed(0)} = ${total} EUR`}
              </strong>
            ) : (
              <strong>
                {nights} {nights === 1 ? 'night' : 'nights'}
                {!isMaintenance ? ` - ${total} EUR` : ''}
              </strong>
            )}
          </span>
          {mode === 'edit' && (
            <button className="pill-button danger" disabled={status === 'saving'} type="button" onClick={removeReservation}>
              Delete
            </button>
          )}
          <button className="pill-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="pill-button accent"
            disabled={status === 'saving' || status === 'loading'}
            form="reservation-form"
            type="submit"
          >
            {mode === 'edit' ? 'Save changes' : 'Save reservation'}
          </button>
        </div>
      </section>
    </div>
  )
}
