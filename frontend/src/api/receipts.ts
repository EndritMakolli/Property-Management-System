import type {
  DailyDayRecord,
  LinkedReservation,
  ReceiptItemRecord,
  ReceiptTotals,
} from '../types/domain'
import { activePlatform, apiDelete, apiGet, apiSend } from './client'

export async function fetchMonthlyReceipts(year: number, month: number) {
  const params = new URLSearchParams({
    platform: activePlatform(),
    year: String(year),
    month: String(month),
  })
  return apiGet<{ days: DailyDayRecord[]; totals: ReceiptTotals }>(`/api/receipts/?${params}`)
}

export async function upsertDailyEntry(payload: {
  date: string
  depositAmount: string
  receiptLeft: boolean
  note: string
}) {
  const data = await apiSend<{ entry: DailyDayRecord }>('/api/receipts/day/', 'POST', {
    ...payload,
    platform: activePlatform(),
  })
  return data.entry
}

export async function fetchDayDetail(date: string) {
  const params = new URLSearchParams({ platform: activePlatform(), date })
  return apiGet<{ entry: DailyDayRecord; items: ReceiptItemRecord[] }>(`/api/receipts/day/detail/?${params}`)
}

export async function createReceiptItem(payload: {
  date: string
  value: string
  note: string
  reservationIds: string[]
}) {
  const data = await apiSend<{ item: ReceiptItemRecord }>('/api/receipts/items/', 'POST', {
    ...payload,
    platform: activePlatform(),
  })
  return data.item
}

export async function updateReceiptItem(
  id: string,
  payload: { value: string; note: string; reservationIds: string[] },
) {
  const data = await apiSend<{ item: ReceiptItemRecord }>(`/api/receipts/items/${id}/`, 'PATCH', payload)
  return data.item
}

export async function deleteReceiptItem(id: string) {
  await apiDelete(`/api/receipts/items/${id}/`, 'Could not delete receipt item.')
}

export async function fetchAvailableReservations(year: number, month: number, currentItemId?: string) {
  const params = new URLSearchParams({
    platform: activePlatform(),
    year: String(year),
    month: String(month),
  })
  if (currentItemId) params.set('currentItemId', currentItemId)
  const data = await apiGet<{ reservations: LinkedReservation[] }>(`/api/receipts/reservations/?${params}`)
  return data.reservations
}
