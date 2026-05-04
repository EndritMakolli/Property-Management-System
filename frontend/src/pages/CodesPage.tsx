import { KeyRound, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  createLockboxCode,
  deleteLockboxCode,
  fetchDoorCodes,
  fetchLockboxCodes,
  updateDoorCode,
  updateLockboxCode,
  type CodePayload,
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
      setDoorCodes(doorRows.map((item) => ({ ...item, isDirty: false })))
      setLockboxCodes(lockboxRows.map((item) => ({ ...item, isDirty: false })))
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
      const saved = await updateDoorCode(code.id, {
        newCode: code.newCode,
        notes: code.notes,
      })
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
      const saved = code.isNew
        ? await createLockboxCode(toCodePayload(code))
        : await updateLockboxCode(code.id, toCodePayload(code))
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
        apartmentNumber: '',
        oldCode: '',
        newCode: '',
        dateChanged: '',
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
        <button className={activeTab === 'door' ? 'active' : ''} onClick={() => setActiveTab('door')}>
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
        <CodesTable
          rows={doorCodes}
          type="door"
          onSave={saveDoorCode}
          onUpdate={updateDoorRow}
        />
      )}

      {status === 'ready' && activeTab === 'lockbox' && (
        <CodesTable
          rows={lockboxCodes}
          type="lockbox"
          onDelete={removeLockboxCode}
          onSave={saveLockboxCode}
          onUpdate={updateLockboxRow}
        />
      )}
    </section>
  )
}

type CodesTableProps =
  | {
      rows: EditableDoorCode[]
      type: 'door'
      onSave: (code: EditableDoorCode) => void
      onUpdate: (id: string, updates: Partial<EditableDoorCode>) => void
    }
  | {
      rows: EditableLockboxCode[]
      type: 'lockbox'
      onDelete: (code: EditableLockboxCode) => void
      onSave: (code: EditableLockboxCode) => void
      onUpdate: (id: string, updates: Partial<EditableLockboxCode>) => void
    }

function CodesTable(props: CodesTableProps) {
  return (
    <div className="table-scroll">
      <table className="codes-table">
        <thead>
          <tr>
            <th>{props.type === 'door' ? 'Apartment number' : 'Lockbox name'}</th>
            <th>Old code</th>
            <th>Current code</th>
            <th>Date changed</th>
            <th>Notes</th>
            <th>Reminder</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <CodeTableRow key={row.id} props={props} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CodeTableRow({
  props,
  row,
}: {
  props: CodesTableProps
  row: EditableDoorCode | EditableLockboxCode
}) {
  const isDoor = props.type === 'door'
  const doorRow = row as EditableDoorCode
  const lockboxRow = row as EditableLockboxCode

  function saveRow() {
    if (props.type === 'door') {
      props.onSave(doorRow)
      return
    }
    props.onSave(lockboxRow)
  }

  return (
            <tr>
              <td>
                {isDoor ? (
                  <strong>{row.apartmentNumber}</strong>
                ) : (
                  <input
                    placeholder="Lockbox name"
                    type="text"
                    value={row.apartmentNumber}
                    onChange={(event) => {
                      if (props.type === 'lockbox') {
                        props.onUpdate(row.id, { apartmentNumber: event.target.value })
                      }
                    }}
                  />
                )}
              </td>
              <td>
                <input
                  readOnly
                  type="text"
                  value={row.oldCode}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.newCode}
                  onChange={(event) => props.onUpdate(row.id, { newCode: event.target.value } as never)}
                />
              </td>
              <td>
                <DateInput readOnly ariaLabel="Date changed" value={row.dateChanged} />
              </td>
              <td>
                <input
                  type="text"
                  value={row.notes}
                  onChange={(event) => props.onUpdate(row.id, { notes: event.target.value } as never)}
                />
              </td>
              <td>
                {isDoor && doorRow.needsChange ? (
                  <span className="code-warning">
                    Not changed since last reservation
                    {doorRow.lastCheckout ? ` (${formatDisplayDate(doorRow.lastCheckout)})` : ''}
                  </span>
                ) : (
                  <span className="code-ok">OK</span>
                )}
              </td>
              <td>
                <div className="table-actions">
                  <button disabled={!row.isDirty} onClick={saveRow}>
                    Save
                  </button>
                  {!isDoor && props.type === 'lockbox' && (
                    <button onClick={() => props.onDelete(lockboxRow)}>Delete</button>
                  )}
                </div>
              </td>
            </tr>
  )
}

function toCodePayload(code: EditableDoorCode | EditableLockboxCode): CodePayload {
  return {
    apartmentNumber: 'apartmentNumber' in code ? code.apartmentNumber : undefined,
    newCode: code.newCode,
    notes: code.notes,
  }
}
