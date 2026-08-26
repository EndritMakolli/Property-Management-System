// Clients filed away. Their history is intact and they can be brought back;
// deleting from here is the only permanent option, and it is not undoable.

import { useState } from 'react'
import { deleteGuest, setGuestArchived } from '../../api/guests'
import { LoadMoreFooter } from '../../components/shared/LoadMoreFooter'
import type { GuestRecord } from '../../types/domain'
import { ClientCard } from './ClientCard'
import { useClientPage } from './useClientPage'

export function ClientArchiveView() {
  const [error, setError] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const page = useClientPage({ archived: true, sort: 'name' }, '')

  async function restore(client: GuestRecord) {
    setError('')
    try {
      await setGuestArchived(client.id, false)
      page.remove(client.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not restore the client.')
    }
  }

  async function remove(client: GuestRecord) {
    // Two clicks, because this one cannot be taken back.
    if (confirmingId !== client.id) {
      setConfirmingId(client.id)
      return
    }
    setConfirmingId(null)
    setError('')
    try {
      await deleteGuest(client.id)
      page.remove(client.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the client.')
    }
  }

  if (page.status === 'loading') return <p className="clients-empty">Loading archive…</p>
  if (page.status === 'error') return <p className="form-error">Could not load the archive.</p>

  return (
    <>
      <p className="clients-count">
        {page.total} archived client{page.total === 1 ? '' : 's'}
      </p>
      {error && <p className="form-error">{error}</p>}
      {page.clients.length === 0 ? (
        <p className="clients-empty">
          Nothing archived. Archiving a client hides them from the directory without touching their
          reservation history.
        </p>
      ) : (
        <div className="client-card-list">
          {page.clients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              confirmingDelete={confirmingId === client.id}
              onDelete={remove}
              onRestore={restore}
            />
          ))}
        </div>
      )}
      <LoadMoreFooter
        loading={page.loadingMore}
        noun="client"
        shown={page.clients.length}
        total={page.total}
        onLoadMore={page.loadMore}
      />
    </>
  )
}
