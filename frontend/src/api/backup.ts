import { apiFetch, formatApiError } from './client'

// Download a data-only JSON backup of everything and save it to disk.
export async function exportBackup() {
  const response = await apiFetch('/api/backup/export/')
  if (!response.ok) {
    const body = await response.text()
    let message = response.statusText
    try {
      message = formatApiError((JSON.parse(body) as { error?: unknown }).error) || message
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new Error(message)
  }

  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="?([^"]+)"?/)
  const filename = match?.[1] || `pms-backup-${new Date().toISOString().slice(0, 10)}.json`

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export type ImportResult = { ok: boolean; objectCount: number; note?: string }

// Replace ALL data on this device with the contents of a backup file.
export async function importBackup(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiFetch('/api/backup/import/', { method: 'POST', body: formData })
  const body = await response.text()
  const data = body ? JSON.parse(body) : {}
  if (!response.ok) {
    throw new Error(formatApiError((data as { error?: unknown }).error) || response.statusText)
  }
  return data as ImportResult
}
