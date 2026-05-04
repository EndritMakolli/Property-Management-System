import { X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  createReservation,
  deleteReservation,
  fetchProperties,
  updateReservation,
  type ReservationPayload,
} from '../../api/pmsApi'
import { DateInput } from '../../components/shared/DateInput'
import type { PropertyListing, ReservationPlatform, ReservationRecord } from '../../types/domain'
import { calculateNights, toDateInputValue } from '../../utils/date'
import { reservationTypeOptions } from './reservationOptions'

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
  const today = toDateInputValue(new Date())
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)

  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle')
  const [error, setError] = useState('')
  const [totalDraft, setTotalDraft] = useState<string | null>(null)
  const defaultForm: ReservationPayload = {
    guestName: '',
    guestPhone: '',
    paymentDue: '',
    paid: false,
    notes: '',
    reservationType: 'private',
    propertyId: '',
    checkIn: today,
    checkOut: toDateInputValue(tomorrowDate),
    nightlyPrice: '0.00',
  }

  const [form, setForm] = useState<ReservationPayload>(defaultForm)

  useEffect(() => {
    if (!open) {
      return
    }

    let ignore = false

    async function loadProperties() {
      try {
        setStatus('loading')
        setError('')
        const rows = await fetchProperties()
        if (ignore) {
          return
        }

        setProperties(rows)
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
      return
    }

    if (mode === 'edit' && reservation) {
      setForm({
        guestName: reservation.guestName,
        guestPhone: reservation.guestPhone,
        paymentDue: reservation.paymentDue,
        paid: reservation.paid,
        notes: reservation.notes,
        reservationType: reservation.reservationType,
        propertyId: reservation.propertyId,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        nightlyPrice: reservation.nightlyPrice,
      })
      setTotalDraft(null)
      return
    }

    setForm({ ...defaultForm, ...initialValues })
    setTotalDraft(null)
  }, [initialValues, mode, open, reservation])

  const selectedProperty = properties.find((property) => property.id === form.propertyId)
  const nights = calculateNights(form.checkIn, form.checkOut)
  const total = useMemo(() => {
    const nightlyPrice = Number(form.nightlyPrice)
    return Number.isFinite(nightlyPrice) && nights > 0 ? (nightlyPrice * nights).toFixed(2) : '0.00'
  }, [form.nightlyPrice, nights])

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
      return next
    })
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

    try {
      if (mode === 'edit' && reservation) {
        await updateReservation(reservation.id, form)
      } else {
        await createReservation(form)
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

  return (
    <div className="modal-backdrop">
      <section className="reservation-modal" aria-modal="true" role="dialog">
        <div className="modal-header">
          <div>
            <h2>{mode === 'edit' ? 'Edit reservation' : 'New reservation'}</h2>
            <p>{mode === 'edit' ? 'Update or delete this booking.' : 'Add a booking directly from any page.'}</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}

        <form className="reservation-modal-form" onSubmit={saveReservation}>
          <label>
            Guest name
            <input
              type="text"
              value={form.guestName}
              onChange={(event) => updateForm({ guestName: event.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              value={form.guestPhone}
              onChange={(event) => updateForm({ guestPhone: event.target.value })}
            />
          </label>
          <label>
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
          <label>
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
          <label>
            Check-in
            <DateInput required ariaLabel="Check-in" value={form.checkIn} onChange={(value) => updateForm({ checkIn: value })} />
          </label>
          <label>
            Check-out
            <DateInput required ariaLabel="Check-out" min={form.checkIn} value={form.checkOut} onChange={(value) => updateForm({ checkOut: value })} />
          </label>
          <label>
            Nightly price
            <input
              min="0"
              step="0.01"
              type="number"
              value={form.nightlyPrice}
              onChange={(event) => updateForm({ nightlyPrice: event.target.value })}
            />
          </label>
          <label>
            Total price
            <input
              min="0"
              step="0.01"
              type="number"
              value={totalDraft ?? total}
              onChange={(event) => updateTotalPrice(event.target.value)}
            />
          </label>
          <label>
            Payment due
            <DateInput ariaLabel="Payment due" value={form.paymentDue} onChange={(value) => updateForm({ paymentDue: value })} />
          </label>
          <label className="checkbox-field">
            <input
              checked={form.paid}
              type="checkbox"
              onChange={(event) => updateForm({ paid: event.target.checked })}
            />
            Paid
          </label>
          <label className="wide-field">
            Notes
            <textarea
              value={form.notes}
              onChange={(event) => updateForm({ notes: event.target.value })}
            />
          </label>

          <div className="reservation-modal-summary">
            <span>{selectedProperty?.apartmentType || 'Choose property'}</span>
            <strong>
              {nights} nights - {total} EUR
            </strong>
          </div>

          <div className="modal-actions">
            {mode === 'edit' && (
              <button className="danger-button" disabled={status === 'saving'} type="button" onClick={removeReservation}>
                Delete
              </button>
            )}
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" disabled={status === 'saving' || status === 'loading'} type="submit">
              {mode === 'edit' ? 'Save changes' : 'Save reservation'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
