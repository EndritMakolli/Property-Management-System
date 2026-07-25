import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { deleteGuest, fetchGuests } from '../api/guests'
import { ClientFormModal } from '../features/clients/ClientFormModal'
import type { GuestRecord } from '../types/domain'
import '../styles/clients.css'

export function ClientsPage() {
  const [guests, setGuests] = useState<GuestRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<GuestRecord | null>(null)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    fetchGuests()
      .then((rows) => {
        if (!ignore) {
          setGuests(rows)
          setStatus('ready')
        }
      })
      .catch(() => {
        if (!ignore) setStatus('error')
      })
    return () => {
      ignore = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return guests
    return guests.filter((g) =>
      [g.fullName, g.email, g.phone, g.nationality].some((field) => field.toLowerCase().includes(q)),
    )
  }, [guests, search])

  function handleSaved(saved: GuestRecord) {
    setGuests((current) => {
      const exists = current.some((g) => g.id === saved.id)
      return exists ? current.map((g) => (g.id === saved.id ? saved : g)) : [saved, ...current]
    })
  }

  async function handleDelete(guest: GuestRecord) {
    if (confirmDeleteId !== guest.id) {
      setConfirmDeleteId(guest.id)
      return
    }
    setConfirmDeleteId(null)
    setError('')
    try {
      await deleteGuest(guest.id)
      setGuests((current) => current.filter((g) => g.id !== guest.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the client.')
    }
  }

  return (
    <div className="clients-page">
      <div className="clients-head">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">
            Your guest directory — new reservations link to it automatically, and returning guests are flagged.
          </p>
        </div>
        <button
          className="pill-button accent"
          type="button"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus size={15} /> Register client
        </button>
      </div>

      <div className="clients-search">
        <Search size={16} />
        <input
          placeholder="Search name, email, phone, nationality…"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <p className="form-error">{error}</p>}
      {status === 'loading' && <p className="clients-empty">Loading clients…</p>}
      {status === 'error' && <p className="form-error">Could not load clients.</p>}

      {status === 'ready' && (
        <section className="panel">
          <p className="clients-count">
            {filtered.length} client{filtered.length !== 1 ? 's' : ''}
            {search.trim() ? ` matching “${search.trim()}”` : ''}
          </p>
          {filtered.length === 0 ? (
            <p className="clients-empty">No clients yet — register one, or create a reservation and it will appear here.</p>
          ) : (
            <div className="clients-table-wrap">
              <table className="clients-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Phone</th>
                    <th>Nationality</th>
                    <th>Stays</th>
                    <th>Nights</th>
                    <th>Total paid</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((guest) => (
                    <tr
                      key={guest.id}
                      onClick={() => {
                        setEditing(guest)
                        setFormOpen(true)
                      }}
                    >
                      <td className="clients-name">
                        <strong>{guest.fullName}</strong>
                        {guest.email && <small>{guest.email}</small>}
                      </td>
                      <td>{guest.phone || '—'}</td>
                      <td>{guest.nationality || '—'}</td>
                      <td>{guest.totalStays}</td>
                      <td>{guest.totalNights}</td>
                      <td>
                        EUR {Number(guest.totalPaidEur).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td>
                        {guest.isReturning && (
                          <span className="returning-badge">
                            <RotateCcw size={11} /> Returning
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          className={`pill-button${confirmDeleteId === guest.id ? ' danger' : ''}`}
                          type="button"
                          title={confirmDeleteId === guest.id ? 'Click again to confirm' : 'Delete client'}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(guest)
                          }}
                        >
                          <Trash2 size={13} />
                          {confirmDeleteId === guest.id ? ' Confirm?' : ''}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <ClientFormModal
        client={editing}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  )
}
