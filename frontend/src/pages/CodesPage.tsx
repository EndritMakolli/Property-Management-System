import { Check, Copy, KeyRound, Plus, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createLockboxCode,
  deleteLockboxCode,
  fetchDoorCodes,
  fetchLockboxCodes,
  updateDoorCode,
  updateLockboxCode,
  type DoorCodePayload,
  type LockboxCodePayload,
} from '../api/pmsApi'
import { DateInput } from '../components/shared/DateInput'
import { formatDisplayDate } from '../utils/date'
import type { DoorCodeRecord, LockboxCodeRecord } from '../types/domain'

type CodeTab = 'door' | 'lockbox'
type EditableDoorCode = DoorCodeRecord & { isDirty?: boolean }
type EditableLockboxCode = LockboxCodeRecord & { isDirty?: boolean; isNew?: boolean }

export function CodesPage() {
  const [activeTab, setActiveTab] = useState<CodeTab>('door')
  const [doorCodes, setDoorCodes] = useState<EditableDoorCode[]>([])
  const [lockboxCodes, setLockboxCodes] = useState<EditableLockboxCode[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  async function loadCodes() {
    try {
      setStatus('loading')
      setError('')
      const [doorRows, lockboxRows] = await Promise.all([fetchDoorCodes(), fetchLockboxCodes()])
      setDoorCodes(
        [...doorRows]
          .sort((a, b) =>
            a.apartmentNumber.localeCompare(b.apartmentNumber, undefined, {
              numeric: true,
              sensitivity: 'base',
            }),
          )
          .map((item) => ({ ...item, isDirty: false })),
      )
      setLockboxCodes(
        [...lockboxRows]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
          .map((item) => ({ ...item, isDirty: false })),
      )
      setStatus('ready')
    } catch {
      setStatus('error')
      setError('Could not load access codes.')
    }
  }

  useEffect(() => {
    loadCodes()
  }, [])

  function updateDoorRow(id: string, updates: Partial<EditableDoorCode>) {
    setDoorCodes((current) =>
      current.map((code) => (code.id === id ? { ...code, ...updates, isDirty: true } : code)),
    )
  }

  function updateLockboxRow(id: string, updates: Partial<EditableLockboxCode>) {
    setLockboxCodes((current) =>
      current.map((code) => (code.id === id ? { ...code, ...updates, isDirty: true } : code)),
    )
  }

  async function saveDoorCode(code: EditableDoorCode) {
    try {
      setError('')
      const payload: DoorCodePayload = { newCode: code.newCode, notes: code.notes }
      const saved = await updateDoorCode(code.id, payload)
      setDoorCodes((current) =>
        current.map((item) => (item.id === code.id ? { ...saved, isDirty: false } : item)),
      )
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not save door code.')
    }
  }

  async function saveLockboxCode(code: EditableLockboxCode) {
    try {
      setError('')
      const payload: LockboxCodePayload = {
        name: code.name,
        apartmentNumber: code.apartmentNumber,
        newCode: code.newCode,
        notes: code.notes,
      }
      const saved = code.isNew
        ? await createLockboxCode(payload)
        : await updateLockboxCode(code.id, payload)
      setLockboxCodes((current) =>
        current.map((item) =>
          item.id === code.id ? { ...saved, isDirty: false, isNew: false } : item,
        ),
      )
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not save lockbox code.')
    }
  }

  async function removeLockboxCode(code: EditableLockboxCode) {
    if (code.isNew) {
      setLockboxCodes((current) => current.filter((item) => item.id !== code.id))
      return
    }

    try {
      await deleteLockboxCode(code.id)
      setLockboxCodes((current) => current.filter((item) => item.id !== code.id))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not delete lockbox code.')
    }
  }

  function addLockboxCode() {
    setActiveTab('lockbox')
    setLockboxCodes((current) => [
      {
        id: `new-${Date.now()}`,
        name: '',
        apartmentNumber: '',
        oldCode: '',
        newCode: '',
        dateChanged: '',
        changedBy: '',
        notes: '',
        isDirty: true,
        isNew: true,
      },
      ...current,
    ])
  }

  return (
    <section className="codes-page">
      <div className="codes-header">
        <div>
          <p className="eyebrow">Access</p>
          <h2>Codes</h2>
        </div>
        <button className="primary-button" onClick={addLockboxCode}>
          <Plus size={17} />
          Add lockbox
        </button>
      </div>

      <div className="codes-tabs">
        <button
          className={activeTab === 'door' ? 'active' : ''}
          onClick={() => setActiveTab('door')}
        >
          <KeyRound size={16} />
          Door Codes
        </button>
        <button
          className={activeTab === 'lockbox' ? 'active' : ''}
          onClick={() => setActiveTab('lockbox')}
        >
          <KeyRound size={16} />
          Lockbox Codes
        </button>
      </div>

      {status === 'loading' && <p className="listings-message">Loading codes...</p>}
      {status === 'error' && <p className="form-error">{error}</p>}
      {error && status === 'ready' && <p className="form-error">{error}</p>}

      {status === 'ready' && activeTab === 'door' && (
        <DoorCodesTable rows={doorCodes} onSave={saveDoorCode} onUpdate={updateDoorRow} />
      )}

      {status === 'ready' && activeTab === 'lockbox' && (
        <LockboxCodesTable
          rows={lockboxCodes}
          onDelete={removeLockboxCode}
          onSave={saveLockboxCode}
          onUpdate={updateLockboxRow}
        />
      )}
    </section>
  )
}

function buildDoorCopyText(code: DoorCodeRecord): string {
  return [
    `Apartamenti: ${code.apartmentNumber || '—'}`,
    `Kati: ${code.floor || '—'}`,
    `Kodi i derës: ${code.newCode || '—'}`,
    `Wi-Fi: ${code.wifiName || '—'}`,
    `Fjalëkalimi: ${code.wifiPassword || '—'}`,
  ].join('\n')
}

function buildLockboxCopyText(code: LockboxCodeRecord): string {
  const lines: string[] = []
  lines.push(code.name || '—')
  lines.push(`Kodi: ${code.newCode || '—'}`)
  return lines.join('\n')
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // fallback: select text
    }
  }

  return (
    <button
      className={`copy-info-btn ${copied ? 'copied' : ''}`}
      title="Copy apartment info to clipboard"
      type="button"
      onClick={handleCopy}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied!' : 'Copy info'}
    </button>
  )
}

function DoorCodesTable({
  rows,
  onSave,
  onUpdate,
}: {
  rows: EditableDoorCode[]
  onSave: (code: EditableDoorCode) => void
  onUpdate: (id: string, updates: Partial<EditableDoorCode>) => void
}) {
  return (
    <div className="table-scroll">
      <table className="codes-table">
        <thead>
          <tr>
            <th>Apartment</th>
            <th>Old code</th>
            <th>Current code</th>
            <th>Date changed</th>
            <th>Wi-Fi</th>
            <th>Notes</th>
            <th>Reminder</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.isDirty ? 'row-dirty' : ''}>
              <td>
                <strong>{row.apartmentNumber}</strong>
                {row.floor && <small className="code-floor">{row.floor}</small>}
              </td>
              <td>
                <input readOnly type="text" value={row.oldCode} />
              </td>
              <td>
                <input
                  type="text"
                  value={row.newCode}
                  onChange={(e) => onUpdate(row.id, { newCode: e.target.value })}
                />
              </td>
              <td>
                <DateInput readOnly ariaLabel="Date changed" value={row.dateChanged} />
              </td>
              <td className="wifi-cell">
                {row.wifiName ? (
                  <>
                    <span className="wifi-name">
                      <Wifi size={12} />
                      {row.wifiName}
                    </span>
                    {row.wifiPassword && (
                      <small className="wifi-pass">{row.wifiPassword}</small>
                    )}
                  </>
                ) : (
                  <span className="code-muted">—</span>
                )}
              </td>
              <td>
                <input
                  type="text"
                  value={row.notes}
                  onChange={(e) => onUpdate(row.id, { notes: e.target.value })}
                />
              </td>
              <td>
                {row.needsChange ? (
                  <span className="code-warning">
                    Not changed since checkout
                    {row.lastCheckout ? ` (${formatDisplayDate(row.lastCheckout)})` : ''}
                  </span>
                ) : (
                  <span className="code-ok">OK</span>
                )}
              </td>
              <td>
                <div className="table-actions">
                  <CopyButton text={buildDoorCopyText(row)} />
                  <button disabled={!row.isDirty} onClick={() => onSave(row)}>
                    Save
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LockboxCodesTable({
  rows,
  onDelete,
  onSave,
  onUpdate,
}: {
  rows: EditableLockboxCode[]
  onDelete: (code: EditableLockboxCode) => void
  onSave: (code: EditableLockboxCode) => void
  onUpdate: (id: string, updates: Partial<EditableLockboxCode>) => void
}) {
  return (
    <div className="table-scroll">
      <table className="codes-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Apartment</th>
            <th>Old code</th>
            <th>Current code</th>
            <th>Date changed</th>
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.isNew ? 'row-new' : row.isDirty ? 'row-dirty' : ''}>
              <td>
                <input
                  placeholder="e.g. Main entrance"
                  type="text"
                  value={row.name}
                  onChange={(e) => onUpdate(row.id, { name: e.target.value })}
                />
              </td>
              <td>
                <input
                  placeholder="Apt number"
                  type="text"
                  value={row.apartmentNumber}
                  onChange={(e) => onUpdate(row.id, { apartmentNumber: e.target.value })}
                />
              </td>
              <td>
                <input readOnly type="text" value={row.oldCode} />
              </td>
              <td>
                <input
                  type="text"
                  value={row.newCode}
                  onChange={(e) => onUpdate(row.id, { newCode: e.target.value })}
                />
              </td>
              <td>
                <DateInput readOnly ariaLabel="Date changed" value={row.dateChanged} />
              </td>
              <td>
                <input
                  type="text"
                  value={row.notes}
                  onChange={(e) => onUpdate(row.id, { notes: e.target.value })}
                />
              </td>
              <td>
                <div className="table-actions">
                  <CopyButton text={buildLockboxCopyText(row)} />
                  <button disabled={!row.isDirty} onClick={() => onSave(row)}>
                    Save
                  </button>
                  <button className="danger-text-btn" onClick={() => onDelete(row)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
