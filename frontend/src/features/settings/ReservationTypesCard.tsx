// Reservation types — rename, recolour, add, remove.
//
// A colour set here repaints the whole app at once: calendar pills, table
// chips, archive badges, the needs-attention list and the reports palette all
// read from this one table now. That is why the swatch updates optimistically —
// the change is meant to feel immediate.
//
// Built-in types can be renamed and recoloured but not deleted: the application
// reasons about `monthly`, `booking` and `maintenance` by name, so removing one
// would break billing rather than a swatch. The server enforces that; this just
// explains it before you click.

import { Loader2, Lock, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  createReservationType,
  deleteReservationType,
  updateReservationType,
} from '../../api/reservationTypes'
import { useReservationTypes } from '../../context/ReservationTypesContext'
import type { ReservationTypeRecord } from '../../types/domain'

export function ReservationTypesCard() {
  const { types, publish, reload } = useReservationTypes()
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('#4f46e5')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  function replace(saved: ReservationTypeRecord) {
    publish(types.map((row) => (row.id === saved.id ? saved : row)))
  }

  async function recolour(row: ReservationTypeRecord, color: string) {
    // Optimistic: repaint now, reconcile after. A colour picker fires on every
    // drag, so waiting for the round trip would feel broken.
    replace({ ...row, color })
    setError('')
    try {
      await updateReservationType(row.id, { color })
    } catch (caught) {
      replace(row)
      setError(caught instanceof Error ? caught.message : 'Could not save the colour.')
    }
  }

  async function rename(row: ReservationTypeRecord, label: string) {
    setEditingId(null)
    if (!label.trim() || label === row.label) return
    replace({ ...row, label })
    try {
      await updateReservationType(row.id, { label })
    } catch (caught) {
      replace(row)
      setError(caught instanceof Error ? caught.message : 'Could not save the name.')
    }
  }

  async function add() {
    if (!newLabel.trim()) return
    setAdding(true)
    setError('')
    try {
      const created = await createReservationType({ label: newLabel.trim(), color: newColor })
      publish([...types, created])
      setNewLabel('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the type.')
    } finally {
      setAdding(false)
    }
  }

  async function remove(row: ReservationTypeRecord) {
    setError('')
    try {
      await deleteReservationType(row.id)
      publish(types.filter((item) => item.id !== row.id))
    } catch (caught) {
      // The server says how many reservations use it — show that, not a generic
      // failure, since the count is the whole reason it refused.
      setError(caught instanceof Error ? caught.message : 'Could not delete the type.')
      reload()
    }
  }

  return (
    <article className="panel">
      <h3>Reservation types</h3>
      <p className="admin-backup-desc">
        The kinds of booking you take, and the colour each one draws in. Changing
        a colour here updates the calendar, the tables, the archive and the
        reports together. Built-in types can be renamed and recoloured but not
        removed — the app recognises them by name for billing and syncing.
      </p>

      {error && <p className="form-error">{error}</p>}

      <div className="restype-list">
        {types.map((row) => (
          <div className="restype-row" key={row.id}>
            <input
              className="restype-swatch"
              type="color"
              title={`Colour for ${row.label}`}
              value={row.color}
              onChange={(event) => recolour(row, event.target.value)}
            />

            {editingId === row.id ? (
              <input
                autoFocus
                className="restype-name-input"
                value={editingLabel}
                onChange={(event) => setEditingLabel(event.target.value)}
                onBlur={() => rename(row, editingLabel)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span
                className="restype-name"
                title="Click to rename"
                onClick={() => {
                  setEditingId(row.id)
                  setEditingLabel(row.label)
                }}
              >
                {row.label}
              </span>
            )}

            <code className="restype-code" title="The value stored on every reservation of this type">
              {row.code}
            </code>

            {row.isBuiltin ? (
              <span className="restype-locked" title="Built in — rename and recolour freely, but it cannot be removed">
                <Lock size={12} /> built in
              </span>
            ) : (
              <button
                className="restype-delete"
                title={`Delete ${row.label}`}
                type="button"
                onClick={() => remove(row)}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="restype-create">
        <input
          placeholder="New type, e.g. Corporate"
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
          }}
        />
        <input
          className="restype-swatch"
          type="color"
          title="Colour for the new type"
          value={newColor}
          onChange={(event) => setNewColor(event.target.value)}
        />
        <button className="primary-button" type="button" disabled={adding || !newLabel.trim()} onClick={add}>
          {adding ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
          Add type
        </button>
      </div>
    </article>
  )
}
