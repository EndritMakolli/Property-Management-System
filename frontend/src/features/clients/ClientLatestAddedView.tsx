// The most recently registered clients, newest first.

import { useEffect, useState } from 'react'
import { setGuestArchived } from '../../api/guests'
import { LoadMoreFooter } from '../../components/shared/LoadMoreFooter'
import type { GuestRecord } from '../../types/domain'
import { formatAdded } from '../../utils/relativeTime'
import { ClientCard } from './ClientCard'
import { useClientPage } from './useClientPage'

type Props = {
  onEdit: (client: GuestRecord) => void
  refreshToken: number
}

export function ClientLatestAddedView({ onEdit, refreshToken }: Props) {
  const [error, setError] = useState('')
  const page = useClientPage({ sort: '-added' }, '')

  useEffect(() => {
    if (refreshToken > 0) page.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  async function archive(client: GuestRecord) {
    setError('')
    try {
      await setGuestArchived(client.id, true)
      page.remove(client.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not archive the client.')
    }
  }

  if (page.status === 'loading') return <p className="clients-empty">Loading clients…</p>
  if (page.status === 'error') return <p className="form-error">Could not load clients.</p>

  return (
    <>
      <p className="clients-count">The newest {Math.min(page.clients.length, page.total)} of {page.total} clients</p>
      {error && <p className="form-error">{error}</p>}
      {page.clients.length === 0 ? (
        <p className="clients-empty">No clients registered yet.</p>
      ) : (
        <div className="client-card-list">
          {page.clients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              subtitle={formatAdded(client.createdAt)}
              onArchive={archive}
              onEdit={onEdit}
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
