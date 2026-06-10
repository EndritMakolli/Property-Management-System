import type { ReservationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { reservationLabel } from './calendarUtils'

type ReservationPopoverProps = {
  reservation: ReservationRecord
}

export function ReservationPopover({ reservation }: ReservationPopoverProps) {
  const isMaintenance = reservation.reservationType === 'maintenance'
  return (
    <div className="reservation-popover">
      <strong>{reservationLabel(reservation)}</strong>
      <span>{reservation.apartment}</span>
      <span>
        {formatDisplayDate(reservation.checkIn)} to {formatDisplayDate(reservation.checkOut)}
      </span>
      <span>{reservation.totalNights} nights</span>
      {!isMaintenance && reservation.reservationType !== 'airbnb' && (
        <span>{Number(reservation.totalPaid).toFixed(2)} EUR</span>
      )}
    </div>
  )
}
