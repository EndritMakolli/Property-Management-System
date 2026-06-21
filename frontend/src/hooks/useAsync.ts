import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncStatus = 'loading' | 'ready' | 'error'

/**
 * Runs an async loader and exposes { data, status, error, reload }.
 * Replaces the repeated useState(loading)/useState(error)/try-catch
 * boilerplate found in data-fetching pages.
 *
 * The loader re-runs whenever `deps` change; stale responses are ignored.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [status, setStatus] = useState<AsyncStatus>('loading')
  const [error, setError] = useState('')
  const runId = useRef(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps)

  const reload = useCallback(async () => {
    const id = ++runId.current
    setStatus('loading')
    setError('')
    try {
      const result = await load()
      if (id === runId.current) {
        setData(result)
        setStatus('ready')
      }
    } catch (caught) {
      if (id === runId.current) {
        setError(caught instanceof Error ? caught.message : 'The request could not be completed.')
        setStatus('error')
      }
    }
  }, [load])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, status, error, reload, setData }
}
