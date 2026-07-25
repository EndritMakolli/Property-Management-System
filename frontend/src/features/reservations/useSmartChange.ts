import { useMemo, useState } from 'react'
import { updateReservation } from '../../api/pmsApi'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { calculateNights } from '../../utils/date'
import { overlaps } from './reservationSearch'

export type FreeUpOption = {
  targetProperty: PropertyListing
  blockingReservation: ReservationRecord
  alternativeProperty: PropertyListing
}

type SmartChangeArgs = {
  reservation: ReservationRecord | null
  properties: PropertyListing[]
  reservations: ReservationRecord[]
  onChanged?: () => void | Promise<void>
}

function fullPayload(r: ReservationRecord, propertyId: string) {
  return {
    guestName: r.guestName,
    guestPhone: r.guestPhone,
    paymentDue: r.paymentDue,
    paid: r.paid,
    notes: r.notes,
    reservationType: r.reservationType,
    propertyId,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    nightlyPrice: r.nightlyPrice,
  }
}

// The "Smart Change" apartment mover, shared by the reservations List view and
// the edit-reservation modal: which apartments are free for the stay, and —
// when none are — which guest could be moved elsewhere to free one up.
export function useSmartChange({ reservation, properties, reservations, onChanged }: SmartChangeArgs) {
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  const checkIn = reservation?.checkIn ?? ''
  const checkOut = reservation?.checkOut ?? ''
  const nights = reservation ? calculateNights(checkIn, checkOut) : 0

  const otherReservations = useMemo(
    () => reservations.filter((r) => r.id !== reservation?.id && !r.isArchived),
    [reservations, reservation],
  )

  const availableProperties = useMemo(() => {
    if (!reservation || nights < 1) return []
    return properties.filter((p) => {
      if (p.id === reservation.propertyId) return false
      return !otherReservations.some((r) => r.propertyId === p.id && overlaps(r, checkIn, checkOut))
    })
  }, [reservation, nights, properties, otherReservations, checkIn, checkOut])

  const freeUpOptions = useMemo<FreeUpOption[]>(() => {
    if (!reservation || nights < 1 || availableProperties.length > 0) return []
    const suggestions: FreeUpOption[] = []
    for (const prop of properties) {
      if (prop.id === reservation.propertyId) continue
      const blocking = otherReservations.find(
        (r) => r.propertyId === prop.id && overlaps(r, checkIn, checkOut),
      )
      if (!blocking) continue
      const alt = properties.find(
        (a) =>
          a.id !== prop.id &&
          a.id !== reservation.propertyId &&
          !otherReservations.some(
            (r) => r.propertyId === a.id && r.id !== blocking.id && overlaps(r, blocking.checkIn, blocking.checkOut),
          ),
      )
      if (alt) suggestions.push({ targetProperty: prop, blockingReservation: blocking, alternativeProperty: alt })
    }
    return suggestions
  }, [reservation, nights, availableProperties.length, properties, otherReservations, checkIn, checkOut])

  async function doChange(newPropertyId: string): Promise<boolean> {
    if (!reservation) return false
    setSaving(newPropertyId)
    setSaveError('')
    try {
      await updateReservation(reservation.id, fullPayload(reservation, newPropertyId))
      setSaved(true)
      await onChanged?.()
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not update reservation.')
      return false
    } finally {
      setSaving(null)
    }
  }

  async function doSwap(opt: FreeUpOption): Promise<boolean> {
    if (!reservation) return false
    setSaving(opt.targetProperty.id + '-swap')
    setSaveError('')
    try {
      await updateReservation(
        opt.blockingReservation.id,
        fullPayload(opt.blockingReservation, opt.alternativeProperty.id),
      )
      await updateReservation(reservation.id, fullPayload(reservation, opt.targetProperty.id))
      setSaved(true)
      await onChanged?.()
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not complete swap.')
      return false
    } finally {
      setSaving(null)
    }
  }

  function reset() {
    setSaved(false)
    setSaveError('')
    setSaving(null)
  }

  return { availableProperties, freeUpOptions, nights, doChange, doSwap, saving, saveError, saved, reset }
}
