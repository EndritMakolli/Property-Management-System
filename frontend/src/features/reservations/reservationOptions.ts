import { useMemo } from 'react'
import { useReservationTypes } from '../../context/ReservationTypesContext'

export type ReservationTypeOption = { label: string; value: string }

/**
 * The reservation types to offer in a dropdown, in the operator's own order.
 *
 * This used to be a frozen array. Types are editable now, so a hardcoded list
 * would silently omit anything an admin added and show the old name for
 * anything they renamed.
 */
export function useReservationTypeOptions(options?: { excludeMaintenance?: boolean }) {
  const { types } = useReservationTypes()
  const excludeMaintenance = options?.excludeMaintenance ?? false

  return useMemo(
    () =>
      types
        .filter((row) => row.active)
        .filter((row) => !(excludeMaintenance && row.code === 'maintenance'))
        .map((row) => ({ label: row.label, value: row.code })),
    [types, excludeMaintenance],
  )
}
