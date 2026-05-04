import { useState } from 'react'
import type { ReservationPayload } from '../../api/pmsApi'
import type { PropertyListing, ReservationRecord } from '../../types/domain'
import { toDateInputValue } from '../../utils/date'

type SelectedRange = {
  checkIn: string
  property: PropertyListing
}

export type CalendarReservationModalState = {
  initialValues?: Pick<ReservationPayload, 'checkIn' | 'checkOut' | 'nightlyPrice' | 'propertyId'>
  mode: 'create' | 'edit'
  reservation?: ReservationRecord | null
}

export function useCalendarReservationEditor() {
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(null)
  const [modalState, setModalState] = useState<CalendarReservationModalState | null>(null)

  function handleCalendarDayClick(property: PropertyListing, dayKey: string) {
    if (selectedRange?.property.id === property.id) {
      const firstDate = selectedRange.checkIn <= dayKey ? selectedRange.checkIn : dayKey
      const secondDate = selectedRange.checkIn <= dayKey ? dayKey : selectedRange.checkIn

      setModalState({
        mode: 'create',
        initialValues: {
          propertyId: property.id,
          checkIn: firstDate,
          checkOut: nextDateKey(secondDate),
          nightlyPrice: '0.00',
        },
      })
      setSelectedRange(null)
      return
    }

    setSelectedRange({ property, checkIn: dayKey })
  }

  function handleReservationClick(reservation: ReservationRecord) {
    setModalState({ mode: 'edit', reservation })
    setSelectedRange(null)
  }

  return {
    closeModal: () => setModalState(null),
    handleCalendarDayClick,
    handleReservationClick,
    modalState,
    selectedDateKey: selectedRange?.checkIn,
    selectedPropertyId: selectedRange?.property.id,
  }
}

function nextDateKey(value: string) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return toDateInputValue(date)
}
