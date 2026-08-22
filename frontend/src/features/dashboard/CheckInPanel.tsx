// Today's arrivals, in the order the front desk works through them.
//
// Built to mirror the cleaning panel beside it — same row shape, same hidden
// checkbox with a Lucide icon as the visible control — because they are read
// the same way and at the same moment.
//
// The tick and the arrival time live in the browser for today only. Nothing is
// sent to the server: this is a scratchpad for the shift, not a record.

import { CheckSquare, LogIn, RotateCcw, Square } from 'lucide-react'
import { useMemo } from 'react'
import { PanelHeader } from '../../components/shared/PanelHeader'
import { useReservationTypes } from '../../context/ReservationTypesContext'
import type { ReservationRecord } from '../../types/domain'
import { buildCheckIns } from './checkInPriority'
import { useDayCheckIns } from './useDayCheckIns'

type CheckInPanelProps = {
  reservations: ReservationRecord[]
  reportDate: string
}

export function CheckInPanel({ reservations, reportDate }: CheckInPanelProps) {
  const { types, labelFor } = useReservationTypes()
  const { notes, update } = useDayCheckIns(reportDate)

  const typeOrder = useMemo(() => types.map((type) => type.code), [types])
  const rows = useMemo(
    () => buildCheckIns(reservations, reportDate, typeOrder),
    [reservations, reportDate, typeOrder],
  )

  const arrived = rows.filter((row) => notes[row.reservation.id]?.arrived).length

  return (
    <section className="panel checkin-panel">
      <PanelHeader
        icon={LogIn}
        title={
          rows.length === 0
            ? 'Check-ins'
            : `Check-ins — ${arrived} of ${rows.length} arrived`
        }
      />

      {rows.length === 0 ? (
        <p className="list-empty">Nobody is arriving today.</p>
      ) : (
        <ul className="checkin-list">
          {rows.map((row) => {
            const note = notes[row.reservation.id]
            const checked = note?.arrived ?? false

            return (
              <li className={`checkin-row${checked ? ' done' : ''}`} key={row.reservation.id}>
                <input
                  aria-label={`Arrival time for ${row.displayName}`}
                  className="checkin-time"
                  placeholder="--:--"
                  value={note?.time ?? ''}
                  onChange={(event) =>
                    update(row.reservation.id, { time: event.target.value })
                  }
                />

                <label
                  className="cleaning-check"
                  title={checked ? 'Mark as not arrived' : 'Mark as arrived'}
                >
                  <input
                    checked={checked}
                    type="checkbox"
                    onChange={() => update(row.reservation.id, { arrived: !checked })}
                  />
                  {checked ? <CheckSquare size={19} /> : <Square size={19} />}
                </label>

                <div className="cleaning-info">
                  <strong>
                    {row.displayName}
                    {row.isReturning && (
                      <span className="checkin-returning" title="This guest has stayed before">
                        <RotateCcw size={11} /> returning guest
                      </span>
                    )}
                  </strong>
                  <span>
                    {row.reservation.apartment}
                    {row.reservation.totalNights
                      ? ` · ${row.reservation.totalNights} night${row.reservation.totalNights === 1 ? '' : 's'}`
                      : ''}
                    {row.reservation.guestPhone ? ` · ${row.reservation.guestPhone}` : ''}
                  </span>
                </div>

                <span
                  className={`checkin-badge platform-${row.reservation.reservationType}`}
                >
                  {labelFor(row.reservation.reservationType)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
