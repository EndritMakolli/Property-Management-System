import { Download, EyeOff, Plus, Save, Upload } from 'lucide-react'
import type { ChangeEvent, FormEvent } from 'react'
import { useEffect, useState } from 'react'
import {
  createUserAccount,
  fetchPmsBookingSettings,
  fetchProperties,
  fetchUsers,
  updatePmsBookingSettings,
  updatePropertyVisibility,
  updateUserAccount,
  type UserAccountPayload,
} from '../api/pmsApi'
import {
  exportArchive,
  exportBackup,
  exportMedia,
  importArchive,
  importBackup,
  importMedia,
} from '../api/backup'
import { CompanyProfileCard } from '../features/company/CompanyProfileCard'
import { ReservationTypesCard } from '../features/settings/ReservationTypesCard'
import { useAuth } from '../auth/AuthContext'
import type { ManagedUser, PropertyListing } from '../types/domain'

const roleOptions: UserAccountPayload['role'][] = ['admin', 'management', 'cleaning']

const emptyUserForm: UserAccountPayload = {
  username: '',
  password: '',
  role: 'cleaning',
  isActive: true,
}

export function AdminPanelPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [form, setForm] = useState<UserAccountPayload>(emptyUserForm)
  const [drafts, setDrafts] = useState<Record<number, UserAccountPayload>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [backupBusy, setBackupBusy] = useState<
    'export' | 'import' | 'media-export' | 'media-import' | 'archive-export' | 'archive-import' | null
  >(null)
  const [backupNote, setBackupNote] = useState('')
  const [backupError, setBackupError] = useState('')
  const [imported, setImported] = useState(false)
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [visibilityBusyId, setVisibilityBusyId] = useState<string | null>(null)
  const [visibilityError, setVisibilityError] = useState('')
  const [mapRadius, setMapRadius] = useState('')
  const [mapRadiusBusy, setMapRadiusBusy] = useState(false)
  const [mapRadiusNote, setMapRadiusNote] = useState('')
  const [mapRadiusError, setMapRadiusError] = useState('')

  async function loadUsers() {
    try {
      setStatus('loading')
      setMessage('')
      const rows = await fetchUsers()
      setUsers(rows)
      setDrafts(
        Object.fromEntries(
          rows.map((row) => [
            row.id,
            {
              username: row.username,
              password: '',
              role: row.role,
              isActive: row.isActive,
              twoFactorEmail: row.twoFactorEmail ?? '',
              twoFactorEnabled: row.twoFactorEnabled ?? false,
            },
          ]),
        ),
      )
      setStatus('ready')
    } catch (caughtError) {
      setStatus('error')
      setMessage(caughtError instanceof Error ? caughtError.message : 'Could not load users.')
    }
  }

  useEffect(() => {
    loadUsers()
    fetchProperties()
      .then(setProperties)
      .catch(() => setVisibilityError('Could not load apartments.'))
    fetchPmsBookingSettings()
      .then((settings) => setMapRadius(String(settings.mapRadiusM ?? 300)))
      .catch(() => {})
  }, [])

  async function saveMapRadius(event: FormEvent) {
    event.preventDefault()
    const radius = Number(mapRadius)
    if (!Number.isFinite(radius) || radius < 0 || radius > 5000) {
      setMapRadiusError('Enter a radius between 0 and 5000 meters.')
      return
    }
    setMapRadiusBusy(true)
    setMapRadiusError('')
    setMapRadiusNote('')
    try {
      const saved = await updatePmsBookingSettings({ mapRadiusM: Math.round(radius) })
      setMapRadius(String(saved.mapRadiusM))
      setMapRadiusNote('Saved. The guest site now uses this radius.')
    } catch (caught) {
      setMapRadiusError(caught instanceof Error ? caught.message : 'Could not save the radius.')
    } finally {
      setMapRadiusBusy(false)
    }
  }

  async function toggleVisibility(property: PropertyListing) {
    setVisibilityBusyId(property.id)
    setVisibilityError('')
    try {
      const saved = await updatePropertyVisibility(property.id, !property.hiddenFromManagement)
      setProperties((prev) => prev.map((p) => (p.id === saved.id ? saved : p)))
    } catch (caught) {
      setVisibilityError(caught instanceof Error ? caught.message : 'Could not update visibility.')
    } finally {
      setVisibilityBusyId(null)
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await createUserAccount(form)
      setForm(emptyUserForm)
      setMessage('Account created.')
      await loadUsers()
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : 'Could not create account.')
    }
  }

  async function saveAccount(row: ManagedUser) {
    const draft = drafts[row.id]
    if (!draft) {
      return
    }

    try {
      await updateUserAccount(row.id, draft)
      setMessage('Account updated.')
      await loadUsers()
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : 'Could not update account.')
    }
  }

  async function handleExport() {
    setBackupError('')
    setBackupNote('')
    setBackupBusy('export')
    try {
      await exportBackup()
      setBackupNote('Backup downloaded.')
    } catch (caughtError) {
      setBackupError(caughtError instanceof Error ? caughtError.message : 'Export failed.')
    } finally {
      setBackupBusy(null)
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-selecting the same file later
    if (!file) {
      return
    }
    if (
      !window.confirm(
        'This will REPLACE all data on this device with the backup file. This cannot be undone. Continue?',
      )
    ) {
      return
    }

    setBackupError('')
    setBackupNote('')
    setBackupBusy('import')
    try {
      const result = await importBackup(file)
      setBackupNote(
        `Imported ${result.objectCount.toLocaleString()} records.${result.note ? ` ${result.note}` : ''}`,
      )
      setImported(true)
    } catch (caughtError) {
      setBackupError(caughtError instanceof Error ? caughtError.message : 'Import failed.')
    } finally {
      setBackupBusy(null)
    }
  }

  async function handleMediaExport() {
    setBackupError('')
    setBackupNote('')
    setBackupBusy('media-export')
    try {
      await exportMedia()
      setBackupNote('Media zip downloaded (photos & documents).')
    } catch (caughtError) {
      setBackupError(caughtError instanceof Error ? caughtError.message : 'Media export failed.')
    } finally {
      setBackupBusy(null)
    }
  }

  async function handleMediaImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setBackupError('')
    setBackupNote('')
    setBackupBusy('media-import')
    try {
      const result = await importMedia(file)
      setBackupNote(
        `Restored ${result.restoredFiles.toLocaleString()} files.` +
          `${result.skippedFiles ? ` ${result.skippedFiles} entries were skipped.` : ''}` +
          `${result.note ? ` ${result.note}` : ''}`,
      )
    } catch (caughtError) {
      setBackupError(caughtError instanceof Error ? caughtError.message : 'Media import failed.')
    } finally {
      setBackupBusy(null)
    }
  }

  async function handleArchiveExport() {
    setBackupError('')
    setBackupNote('')
    setBackupBusy('archive-export')
    try {
      await exportArchive()
      setBackupNote('Full archive downloaded (records + files).')
    } catch (caughtError) {
      setBackupError(caughtError instanceof Error ? caughtError.message : 'Archive export failed.')
    } finally {
      setBackupBusy(null)
    }
  }

  async function handleArchiveImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (
      !window.confirm(
        'This will REPLACE all data on this device with the archive AND restore its files. This cannot be undone. Continue?',
      )
    ) {
      return
    }

    setBackupError('')
    setBackupNote('')
    setBackupBusy('archive-import')
    try {
      const result = await importArchive(file)
      setBackupNote(
        `Imported ${result.objectCount.toLocaleString()} records and restored ` +
          `${result.restoredFiles.toLocaleString()} files.${result.note ? ` ${result.note}` : ''}`,
      )
      setImported(true)
    } catch (caughtError) {
      setBackupError(caughtError instanceof Error ? caughtError.message : 'Archive import failed.')
    } finally {
      setBackupBusy(null)
    }
  }

  function updateDraft(id: number, patch: Partial<UserAccountPayload>) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...patch,
      },
    }))
  }

  return (
    <section className="admin-panel-page">
      <div className="admin-panel-header">
        <div>
          <p className="eyebrow">Admin Panel</p>
          <h2>User accounts and permissions</h2>
        </div>
        <span>{users.length} users</span>
      </div>

      {message && <p className={status === 'error' ? 'form-error' : 'admin-panel-message'}>{message}</p>}

      <article className="panel admin-create-card">
        <h3>Create account</h3>
        <form className="admin-user-form" onSubmit={createAccount}>
          <input
            required
            placeholder="Username"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
          />
          <input
            required
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
          <select
            value={form.role}
            onChange={(event) =>
              setForm({ ...form, role: event.target.value as UserAccountPayload['role'] })
            }
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
          <label className="admin-toggle">
            <input
              checked={form.isActive}
              type="checkbox"
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            Active
          </label>
          <button className="primary-button" type="submit">
            <Plus size={16} />
            Create
          </button>
        </form>
      </article>

      <article className="panel admin-users-card">
        <h3>Manage users</h3>
        <p className="admin-backup-desc">
          You can rename any user and set a new password. Your own role and active status
          stay locked so you can&apos;t accidentally lock yourself out.
        </p>
        {status === 'loading' && <p className="listings-message">Loading users...</p>}
        {status === 'error' && <p className="form-error">{message}</p>}
        {status === 'ready' && (
          <div className="admin-users-table">
            <div className="admin-users-head">
              <span>Username</span>
              <span>Role</span>
              <span>Status</span>
              <span>New password</span>
              <span>2-step email</span>
              <span>Actions</span>
            </div>
            {users.map((row) => {
              const draft = drafts[row.id] || emptyUserForm
              const isSelf = row.id === currentUser.id

              return (
                <div className="admin-users-row" key={row.id}>
                  <input
                    value={draft.username}
                    onChange={(event) => updateDraft(row.id, { username: event.target.value })}
                  />
                  <select
                    disabled={isSelf}
                    value={draft.role}
                    onChange={(event) =>
                      updateDraft(row.id, { role: event.target.value as UserAccountPayload['role'] })
                    }
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <label className="admin-toggle">
                    <input
                      checked={draft.isActive}
                      disabled={isSelf}
                      type="checkbox"
                      onChange={(event) => updateDraft(row.id, { isActive: event.target.checked })}
                    />
                    {draft.isActive ? 'Active' : 'Inactive'}
                  </label>
                  <input
                    placeholder="Leave blank to keep"
                    type="password"
                    value={draft.password || ''}
                    onChange={(event) => updateDraft(row.id, { password: event.target.value })}
                  />
                  <div className="admin-2fa-cell">
                    <input
                      placeholder="code email"
                      type="email"
                      value={draft.twoFactorEmail ?? ''}
                      onChange={(event) => updateDraft(row.id, { twoFactorEmail: event.target.value })}
                    />
                    <label className="admin-toggle" title="Require an emailed code at sign-in">
                      <input
                        checked={draft.twoFactorEnabled ?? false}
                        type="checkbox"
                        onChange={(event) =>
                          updateDraft(row.id, { twoFactorEnabled: event.target.checked })
                        }
                      />
                      2FA
                    </label>
                  </div>
                  <div className="admin-row-actions">
                    <button type="button" onClick={() => saveAccount(row)}>
                      <Save size={15} />
                      Save
                    </button>
                    {isSelf && <span className="admin-self-tag">You</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </article>

      <article className="panel admin-visibility-card">
        <h3>
          <EyeOff size={16} /> Hide apartments from managers
        </h3>
        <p className="admin-backup-desc">
          Hidden apartments disappear <strong>completely</strong> for management accounts —
          properties, reservations, calendar, codes, cleaning and sync. Admins always see
          everything; cleaning staff are not affected.
        </p>
        {visibilityError && <p className="form-error">{visibilityError}</p>}
        <div className="excluded-apartment-grid">
          {properties.map((property) => (
            <label className="excluded-apartment-option" key={property.id}>
              <input
                type="checkbox"
                checked={!!property.hiddenFromManagement}
                disabled={visibilityBusyId === property.id}
                onChange={() => toggleVisibility(property)}
              />
              <span>
                {property.name}
                {property.hiddenFromManagement && <em className="admin-hidden-tag"> hidden</em>}
              </span>
            </label>
          ))}
        </div>
      </article>

      <ReservationTypesCard />

      <CompanyProfileCard />

      <article className="panel">
        <h3>Guest map privacy</h3>
        <p className="admin-backup-desc">
          Guests never see exact apartment locations — the public site shows a light-blue
          circle and the apartment sits somewhere inside it. Set the circle radius here
          (0 shows exact locations). Staff pages always keep the exact pin.
        </p>
        {mapRadiusError && <p className="form-error">{mapRadiusError}</p>}
        {mapRadiusNote && <p className="admin-panel-message">{mapRadiusNote}</p>}
        <form className="admin-backup-actions" onSubmit={saveMapRadius}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Radius (meters)
            <input
              type="number"
              min={0}
              max={5000}
              step={50}
              value={mapRadius}
              onChange={(event) => setMapRadius(event.target.value)}
              style={{ width: 110 }}
            />
          </label>
          <button className="primary-button" type="submit" disabled={mapRadiusBusy || mapRadius === ''}>
            <Save size={16} />
            {mapRadiusBusy ? 'Saving…' : 'Save radius'}
          </button>
        </form>
      </article>

      <article className="panel admin-backup-card">
        <h3>Backup &amp; restore</h3>
        <p className="admin-backup-desc">
          Export a single JSON file of all data — properties, reservations (including
          monthly payment plans), finance, codes, maintenance, receipts, synchronization
          links &amp; history, settings and accounts. Importing on another device{' '}
          <strong>replaces everything there</strong> with the file. Uploaded photos and
          attachment files are not included.
        </p>

        {backupError && <p className="form-error">{backupError}</p>}
        {backupNote && <p className="admin-panel-message">{backupNote}</p>}

        <div className="admin-backup-actions">
          <button
            className="primary-button"
            type="button"
            disabled={backupBusy !== null}
            onClick={handleExport}
          >
            <Download size={16} />
            {backupBusy === 'export' ? 'Exporting…' : 'Export backup'}
          </button>

          <label className={`admin-backup-import${backupBusy !== null ? ' disabled' : ''}`}>
            <Upload size={16} />
            {backupBusy === 'import' ? 'Importing…' : 'Import backup'}
            <input
              accept="application/json,.json"
              disabled={backupBusy !== null}
              hidden
              type="file"
              onChange={handleImportFile}
            />
          </label>

          {imported && (
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              Reload now
            </button>
          )}
        </div>

        <h4 className="admin-backup-subtitle">Photos &amp; documents</h4>
        <p className="admin-backup-desc">
          Export or restore the uploaded files themselves — apartment photos, client ID
          documents, expense invoices, reservation attachments and the company logo.
          Importing merges files into storage by path, so every file stays connected to
          its record; nothing is deleted.
        </p>
        <div className="admin-backup-actions">
          <button
            className="primary-button"
            type="button"
            disabled={backupBusy !== null}
            onClick={handleMediaExport}
          >
            <Download size={16} />
            {backupBusy === 'media-export' ? 'Exporting…' : 'Export photos & documents'}
          </button>
          <label className={`admin-backup-import${backupBusy !== null ? ' disabled' : ''}`}>
            <Upload size={16} />
            {backupBusy === 'media-import' ? 'Importing…' : 'Import photos & documents'}
            <input
              accept="application/zip,.zip"
              disabled={backupBusy !== null}
              hidden
              type="file"
              onChange={handleMediaImportFile}
            />
          </label>
        </div>

        <h4 className="admin-backup-subtitle">Full archive (records + files)</h4>
        <p className="admin-backup-desc">
          One zip containing the complete data backup <em>and</em> every uploaded file —
          the easiest way to move the whole platform to another device. Importing it
          replaces all data (like the JSON import) and restores the files.
        </p>
        <div className="admin-backup-actions">
          <button
            className="primary-button"
            type="button"
            disabled={backupBusy !== null}
            onClick={handleArchiveExport}
          >
            <Download size={16} />
            {backupBusy === 'archive-export' ? 'Exporting…' : 'Export full archive'}
          </button>
          <label className={`admin-backup-import${backupBusy !== null ? ' disabled' : ''}`}>
            <Upload size={16} />
            {backupBusy === 'archive-import' ? 'Importing…' : 'Import full archive'}
            <input
              accept="application/zip,.zip"
              disabled={backupBusy !== null}
              hidden
              type="file"
              onChange={handleArchiveImportFile}
            />
          </label>
        </div>
      </article>
    </section>
  )
}

function roleLabel(role: UserAccountPayload['role']) {
  const labels = {
    admin: 'Admin',
    management: 'Management staff',
    cleaning: 'Cleaning staff',
  }

  return labels[role]
}
