// The client directory, on the same shape as Reservations: tabs across the
// top, cards below, and everything that narrows the list handled by the server
// so the page holds twenty rows rather than four hundred.

import { useState } from 'react'
import { ClientArchiveView } from '../features/clients/ClientArchiveView'
import { ClientFormModal } from '../features/clients/ClientFormModal'
import { ClientLatestAddedView } from '../features/clients/ClientLatestAddedView'
import { ClientListView } from '../features/clients/ClientListView'
import type { GuestRecord } from '../types/domain'
import '../styles/clients.css'

type ClientsView = 'list' | 'latest' | 'archive'
const clientViews: ClientsView[] = ['list', 'latest', 'archive']
const clientViewLabels: Record<ClientsView, string> = {
  list: 'Clients',
  latest: 'Latest added',
  archive: 'Archive',
}

const VIEW_STORAGE_KEY = 'pms.clients.view'

export function ClientsPage() {
  const [view, setView] = useState<ClientsView>(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY) as ClientsView | null
    return stored && clientViews.includes(stored) ? stored : 'list'
  })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<GuestRecord | null>(null)
  // Bumped after a save so the open tab refetches rather than guessing where a
  // new or renamed client belongs in the current sort and filter.
  const [refreshToken, setRefreshToken] = useState(0)

  function chooseView(next: ClientsView) {
    setView(next)
    window.localStorage.setItem(VIEW_STORAGE_KEY, next)
  }

  function edit(client: GuestRecord) {
    setEditing(client)
    setFormOpen(true)
  }

  function register() {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <div className="clients-page">
      <div className="clients-head">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">
            Your guest directory — new reservations link to it automatically, and returning guests
            are flagged.
          </p>
        </div>
      </div>

      <div className="view-tabs">
        {clientViews.map((option) => (
          <button
            key={option}
            className={`view-tab${view === option ? ' active' : ''}`}
            type="button"
            onClick={() => chooseView(option)}
          >
            {clientViewLabels[option]}
          </button>
        ))}
      </div>

      <section className="panel">
        {view === 'list' && (
          <ClientListView onEdit={edit} onRegister={register} refreshToken={refreshToken} />
        )}
        {view === 'latest' && (
          <ClientLatestAddedView onEdit={edit} refreshToken={refreshToken} />
        )}
        {view === 'archive' && <ClientArchiveView />}
      </section>

      <ClientFormModal
        client={editing}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => setRefreshToken((n) => n + 1)}
      />
    </div>
  )
}
