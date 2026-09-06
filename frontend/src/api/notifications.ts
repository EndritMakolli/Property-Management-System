import { apiGet, apiSend } from './client'

export type NotificationSeverity = 'overdue' | 'soon' | 'info'

export type NotificationRecord = {
  /** Carries a fingerprint of the state behind it, so a fresh lapse reads as new. */
  key: string
  kind: string
  severity: NotificationSeverity
  title: string
  message: string
  /** Where to go to deal with it. */
  link: string
  read: boolean
}

export async function fetchNotifications() {
  return apiGet<{ notifications: NotificationRecord[]; unread: number }>('/api/notifications/')
}

export async function markNotificationsRead(payload: { keys?: string[]; all?: boolean }) {
  return apiSend<{ marked: number }>('/api/notifications/read/', 'POST', payload)
}
