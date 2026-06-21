import { monthOptions } from '../reservations/monthOptions'

export function money(value: string) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })
}

export function dec(value: string | undefined) {
  return parseFloat(value || '0') || 0
}

export function monthName(month: number) {
  return monthOptions.find((item) => item.value === month)?.label || ''
}
