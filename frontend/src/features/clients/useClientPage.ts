// Fetching one page of the client directory.
//
// Filters, sort and paging all live on the server, so every change here is a
// refetch rather than a re-filter of what is already loaded — sorting twenty
// rows would sort the page instead of the directory. The search box is
// debounced so typing a name is one request, not one per keystroke.

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchGuestPage, type GuestQuery } from '../../api/guests'
import type { GuestRecord } from '../../types/domain'

export const CLIENT_PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

export function useClientPage(query: GuestQuery, searchTerm: string) {
  const [clients, setClients] = useState<GuestRecord[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // The filters are an object rebuilt on every render, so depending on it
  // directly would refetch forever. Compare the serialised form instead.
  const key = JSON.stringify({ ...query, search: debouncedSearch })
  const requestId = useRef(0)

  const load = useCallback(
    async (offset: number) => {
      const mine = ++requestId.current
      if (offset === 0) setStatus('loading')
      else setLoadingMore(true)
      try {
        const parsed = JSON.parse(key) as GuestQuery
        const page = await fetchGuestPage({ ...parsed, limit: CLIENT_PAGE_SIZE, offset })
        // A slower earlier request must not overwrite a newer one.
        if (mine !== requestId.current) return
        setClients((current) => (offset === 0 ? page.guests : [...current, ...page.guests]))
        setTotal(page.total)
        setStatus('ready')
      } catch {
        if (mine === requestId.current) setStatus('error')
      } finally {
        if (mine === requestId.current) setLoadingMore(false)
      }
    },
    [key],
  )

  useEffect(() => {
    load(0)
  }, [load])

  return {
    clients,
    total,
    status,
    loadingMore,
    loadMore: () => load(clients.length),
    reload: () => load(0),
    replace: (saved: GuestRecord) =>
      setClients((current) => current.map((row) => (row.id === saved.id ? saved : row))),
    remove: (id: string) => {
      setClients((current) => current.filter((row) => row.id !== id))
      setTotal((current) => Math.max(0, current - 1))
    },
  }
}
