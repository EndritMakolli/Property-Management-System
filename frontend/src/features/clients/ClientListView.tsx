// The client directory: search, apartment, period, sort, twenty at a time.

import { Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchProperties } from '../../api/pmsApi'
import { setGuestArchived } from '../../api/guests'
import { LoadMoreFooter } from '../../components/shared/LoadMoreFooter'
import { MonthYearFilter, type PeriodValue } from '../../components/shared/MonthYearFilter'
import { SortControl, type SortDirection } from '../../components/shared/SortControl'
import type { GuestRecord, PropertyListing } from '../../types/domain'
import { ClientCard } from './ClientCard'
import { CLIENT_SORT_OPTIONS, isClientSortKey, nextDirection, type ClientSortKey } from './clientSort'
import { useClientPage } from './useClientPage'

const SORT_STORAGE_KEY = 'pms.clients.sort'

function readStoredSort(): { key: ClientSortKey; direction: SortDirection } {
  const fallback = { key: 'name' as ClientSortKey, direction: 'asc' as SortDirection }
  try {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY)
    if (!stored) return fallback
    const parsed = JSON.parse(stored) as { key?: string; direction?: string }
    // A key the server does not know would come back as an unsorted page, so
    // an unrecognised stored value falls back rather than being trusted.
    if (!parsed.key || !isClientSortKey(parsed.key)) return fallback
    return {
      key: parsed.key,
      direction: parsed.direction === 'desc' ? 'desc' : 'asc',
    }
  } catch {
    return fallback
  }
}

type ClientListViewProps = {
  onEdit: (client: GuestRecord) => void
  onRegister: () => void
  refreshToken: number
}

export function ClientListView({ onEdit, onRegister, refreshToken }: ClientListViewProps) {
  const [search, setSearch] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [period, setPeriod] = useState<PeriodValue>(null)
  const [sort, setSort] = useState(readStoredSort)
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort))
  }, [sort])

  useEffect(() => {
    fetchProperties()
      .then(setProperties)
      .catch(() => {})
  }, [])

  const page = useClientPage(
    {
      propertyId: propertyId || undefined,
      month: period?.month,
      year: period?.year,
      sort: nextDirection(sort.key, sort.direction),
    },
    search,
  )

  useEffect(() => {
    if (refreshToken > 0) page.reload()
    // Only when the parent signals a save; page.reload is stable enough here.
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

  return (
    <>
      <div className="client-filter-bar">
        <div className="clients-search">
          <Search size={16} />
          <input
            placeholder="Search name, email, phone…"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select
          aria-label="Apartment"
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
        >
          <option value="">All apartments</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>

        <MonthYearFilter id="clients-period" value={period} onChange={setPeriod} />

        <SortControl
          direction={sort.direction}
          options={CLIENT_SORT_OPTIONS}
          sortKey={sort.key}
          onChange={(key, direction) => setSort({ key, direction })}
        />

        <button className="pill-button accent" type="button" onClick={onRegister}>
          <Plus size={15} /> Register client
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}
      {page.status === 'loading' && <p className="clients-empty">Loading clients…</p>}
      {page.status === 'error' && <p className="form-error">Could not load clients.</p>}

      {page.status === 'ready' && (
        <>
          <p className="clients-count">
            {page.total} client{page.total === 1 ? '' : 's'}
            {period ? ' who stayed in the selected month' : ''}
          </p>

          {page.clients.length === 0 ? (
            <p className="clients-empty">
              No clients match these filters. Clear them, or register a client — a new reservation
              also creates one automatically.
            </p>
          ) : (
            <div className="client-card-list">
              {page.clients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
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
      )}
    </>
  )
}
