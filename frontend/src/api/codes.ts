import type { DoorCodeRecord, LockboxCodeRecord } from '../types/domain'
import { apiDelete, apiGet, apiSend } from './client'

export type DoorCodePayload = {
  newCode: string
  notes: string
}

export type LockboxCodePayload = {
  name?: string
  apartmentNumber?: string
  newCode: string
  notes: string
}

export async function fetchDoorCodes() {
  const data = await apiGet<{ doorCodes: DoorCodeRecord[] }>('/api/codes/door/')
  return data.doorCodes
}

export async function updateDoorCode(id: string, payload: DoorCodePayload) {
  const data = await apiSend<{ doorCode: DoorCodeRecord }>(`/api/codes/door/${id}/`, 'PATCH', payload)
  return data.doorCode
}

export async function fetchLockboxCodes() {
  const data = await apiGet<{ lockboxCodes: LockboxCodeRecord[] }>('/api/codes/lockboxes/')
  return data.lockboxCodes
}

export async function createLockboxCode(payload: LockboxCodePayload) {
  const data = await apiSend<{ lockboxCode: LockboxCodeRecord }>('/api/codes/lockboxes/', 'POST', payload)
  return data.lockboxCode
}

export async function updateLockboxCode(id: string, payload: LockboxCodePayload) {
  const data = await apiSend<{ lockboxCode: LockboxCodeRecord }>(`/api/codes/lockboxes/${id}/`, 'PATCH', payload)
  return data.lockboxCode
}

export async function deleteLockboxCode(id: string) {
  await apiDelete(`/api/codes/lockboxes/${id}/`, 'Could not delete lockbox code.')
}
