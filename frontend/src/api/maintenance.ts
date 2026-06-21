import type { CleanStatusRecord, MaintenanceIssueRecord, SyncLogRecord } from '../types/domain'
import { apiDelete, apiForm, apiGet, apiSend } from './client'

export type MaintenanceIssuePayload = {
  propertyId: string
  description: string
  reporterName?: string
  photos?: File[]
}

export async function fetchMaintenanceIssues(propertyId?: string) {
  const params = new URLSearchParams()
  if (propertyId) params.set('property', propertyId)
  const data = await apiGet<{ issues: MaintenanceIssueRecord[] }>(`/api/maintenance/?${params.toString()}`)
  return data.issues
}

export async function createMaintenanceIssue(payload: MaintenanceIssuePayload) {
  const formData = new FormData()
  formData.append('propertyId', payload.propertyId)
  formData.append('description', payload.description)
  formData.append('reporterName', payload.reporterName || '')
  for (const photo of payload.photos || []) {
    formData.append('photos', photo)
  }
  const data = await apiForm<{ issue: MaintenanceIssueRecord }>('/api/maintenance/', 'POST', formData)
  return data.issue
}

export async function updateMaintenanceIssue(id: string, payload: { description: string }) {
  const data = await apiSend<{ issue: MaintenanceIssueRecord }>(`/api/maintenance/${id}/`, 'PATCH', payload)
  return data.issue
}

export async function deleteMaintenanceIssue(id: string) {
  await apiDelete(`/api/maintenance/${id}/`, 'Could not delete issue.')
}

export async function deleteMaintenancePhoto(photoId: string) {
  await apiDelete(`/api/maintenance/photos/${photoId}/`, 'Could not delete photo.')
}

// ── Clean status ──────────────────────────────────────────────────────────────

export async function fetchCleanStatuses() {
  const data = await apiGet<{ cleanStatuses: CleanStatusRecord[] }>('/api/clean-status/')
  return data.cleanStatuses
}

export async function markApartmentCleaned(propertyId: string, isCleaned: boolean) {
  const data = await apiSend<{ cleanStatus: CleanStatusRecord }>(
    `/api/clean-status/${propertyId}/mark/`,
    'POST',
    { isCleaned },
  )
  return data.cleanStatus
}

// ── Sync logs ─────────────────────────────────────────────────────────────────

export async function fetchSyncLogs(propertyId?: string) {
  const params = new URLSearchParams()
  if (propertyId) params.set('property', propertyId)
  const data = await apiGet<{ syncLogs: SyncLogRecord[] }>(`/api/sync-logs/?${params.toString()}`)
  return data.syncLogs
}
