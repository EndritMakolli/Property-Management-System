import { Download, Plus, Save, Upload } from 'lucide-react'
import type { ChangeEvent, FormEvent } from 'react'
import { useEffect, useState } from 'react'
import {
  createUserAccount,
  fetchUsers,
  updateUserAccount,
  type UserAccountPayload,
} from '../api/pmsApi'
import { exportBackup, importBackup } from '../api/backup'
import { useAuth } from '../auth/AuthContext'
import type { ManagedUser } from '../types/domain'

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
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null)
  const [backupNote, setBackupNote] = useState('')
  const [backupError, setBackupError] = useState('')
  const [imported, setImported] = useState(false)

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
  }, [])

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
        {status === 'loading' && <p className="listings-message">Loading users...</p>}
        {status === 'error' && <p className="form-error">{message}</p>}
        {status === 'ready' && (
          <div className="admin-users-table">
            <div className="admin-users-head">
              <span>Username</span>
              <span>Role</span>
              <span>Status</span>
              <span>New password</span>
              <span>Actions</span>
            </div>
            {users.map((row) => {
              const draft = drafts[row.id] || emptyUserForm
              const isSelf = row.id === currentUser.id

              return (
                <div className="admin-users-row" key={row.id}>
                  <input
                    disabled={isSelf}
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
                    disabled={isSelf}
                    placeholder="Leave blank to keep"
                    type="password"
                    value={draft.password || ''}
                    onChange={(event) => updateDraft(row.id, { password: event.target.value })}
                  />
                  <div className="admin-row-actions">
                    {isSelf ? (
                      <span>Current account</span>
                    ) : (
                      <button type="button" onClick={() => saveAccount(row)}>
                        <Save size={15} />
                        Save
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </article>

      <article className="panel admin-backup-card">
        <h3>Backup &amp; restore</h3>
        <p className="admin-backup-desc">
          Export a single JSON file of all data — properties, reservations, finance, codes,
          maintenance, receipts, settings and accounts. Importing on another device{' '}
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
