import { apiFetch, formatApiError } from './client'

async function downloadFrom(url: string, fallbackName: string) {
  const response = await apiFetch(url)
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
  const filename = match?.[1] || fallbackName

  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

async function uploadTo(url: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiFetch(url, { method: 'POST', body: formData })
  const body = await response.text()
  const data = body ? JSON.parse(body) : {}
  if (!response.ok) {
    throw new Error(formatApiError((data as { error?: unknown }).error) || response.statusText)
  }
  return data
}

// Download a data-only JSON backup of everything and save it to disk.
export async function exportBackup() {
  await downloadFrom(
    '/api/backup/export/',
    `pms-backup-${new Date().toISOString().slice(0, 10)}.json`,
  )
}

export type ImportResult = { ok: boolean; objectCount: number; note?: string }

// Replace ALL data on this device with the contents of a backup file.
export async function importBackup(file: File): Promise<ImportResult> {
  return (await uploadTo('/api/backup/import/', file)) as ImportResult
}

// ── Media (uploaded photos & documents) ───────────────────────────────────────

export type MediaImportResult = {
  ok: boolean
  restoredFiles: number
  skippedFiles: number
  note?: string
}

// Download a zip of every uploaded file (apartment photos, client documents,
// expense invoices, …) with the same paths the database records point at.
export async function exportMedia() {
  await downloadFrom(
    '/api/backup/media/export/',
    `pms-media-${new Date().toISOString().slice(0, 10)}.zip`,
  )
}

// Merge a media zip back into storage (overwrites by path, deletes nothing).
export async function importMedia(file: File): Promise<MediaImportResult> {
  return (await uploadTo('/api/backup/media/import/', file)) as MediaImportResult
}

// ── Full archive (records + files in one zip) ─────────────────────────────────

export type ArchiveImportResult = ImportResult & MediaImportResult

export async function exportArchive() {
  await downloadFrom(
    '/api/backup/archive/export/',
    `pms-archive-${new Date().toISOString().slice(0, 10)}.zip`,
  )
}

// Full restore: replaces all records (like importBackup) AND restores files.
export async function importArchive(file: File): Promise<ArchiveImportResult> {
  return (await uploadTo('/api/backup/archive/import/', file)) as ArchiveImportResult
}
