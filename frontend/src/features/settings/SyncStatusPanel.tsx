// What the timed synchronisation is doing, and why a feed is behind.
//
// Auto-sync used to be a checkbox and an interval with nothing to show for
// them: no way to tell whether it had ever run, when it would run next, or
// which link had been failing quietly for a fortnight. A schedule you cannot
// see is a schedule you cannot trust, and the first thing anyone does with one
// they cannot trust is press Sync All every morning, which is what this
// replaces.

import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fetchSyncStatus, runDueSyncs, type SyncStatusResult } from '../../api/pmsApi'
import { formatApiError } from '../../api/client'

/** '2026-09-12T08:31:00Z' -> 'in 4 h' / '12 min ago'. Relative, because the
 *  question is always "is this recent enough", never "at what o'clock". */
function relative(iso: string): string {
  if (!iso) return 'never'
  const ms = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(ms)
  const minutes = Math.round(abs / 60000)
  const text =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes} min`
        : abs < 86_400_000
          ? `${Math.round(minutes / 60)} h`
          : `${Math.round(minutes / 1440)} d`
  if (text === 'just now') return text
  return ms > 0 ? `in ${text}` : `${text} ago`
}

export function SyncStatusPanel({ onSynced }: { onSynced?: () => void }) {
  const [status, setStatus] = useState<SyncStatusResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setStatus(await fetchSyncStatus())
    } catch (caught) {
      setError(formatApiError(caught))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // While a run is in flight the panel follows it, then stops. Polling a page
  // that is not doing anything is just load.
  useEffect(() => {
    if (!status?.running) return
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [status?.running, load])

  async function handleRun() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await runDueSyncs()
      await load()
      onSynced?.()
    } catch (caught) {
      // A 409 is the lock doing its job, not a fault — say so plainly.
      setError(formatApiError(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <section className="sync-status">
        <p className="listings-message">{error || 'Loading synchronisation status…'}</p>
      </section>
    )
  }

  const failing = status.channels.filter((channel) => channel.consecutiveFailures > 0)
  const lastFinished = status.recentRuns.find((run) => run.finishedAt)

  return (
    <section className="sync-status">
      <header>
        <div>
          <p className="eyebrow">Timed synchronisation</p>
          <h3>
            {status.running ? (
              <>
                <Loader2 className="spin" size={16} /> Running now
              </>
            ) : failing.length > 0 ? (
              <>
                <AlertTriangle size={16} /> {failing.length} feed
                {failing.length === 1 ? '' : 's'} failing
              </>
            ) : (
              <>
                <CheckCircle2 size={16} /> Up to date
              </>
            )}
          </h3>
        </div>
        <button
          className="btn btn-sm btn-outline"
          disabled={busy || Boolean(status.running)}
          type="button"
          onClick={handleRun}
        >
          <RefreshCw className={busy ? 'spin' : undefined} size={14} />
          {status.running ? 'Running…' : `Sync ${status.dueNow} due`}
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}

      <dl className="sync-facts">
        <div>
          <dt>Auto-sync on</dt>
          <dd>
            {status.autoSyncProperties} propert
            {status.autoSyncProperties === 1 ? 'y' : 'ies'}
          </dd>
        </div>
        <div>
          <dt>Due now</dt>
          <dd>{status.dueNow}</dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>
            {lastFinished
              ? `${relative(lastFinished.finishedAt)} · ${lastFinished.propertiesSynced} synced${
                  lastFinished.errorCount > 0 ? `, ${lastFinished.errorCount} failed` : ''
                }`
              : 'never'}
          </dd>
        </div>
      </dl>

      {status.autoSyncProperties === 0 && (
        <p className="sync-hint">
          <Clock size={13} /> No property has auto-sync switched on yet, so nothing is fetched on a
          schedule. Turn it on per apartment below.
        </p>
      )}

      {failing.length > 0 && (
        <ul className="sync-failing">
          {failing.map((channel) => (
            <li key={`${channel.propertyId}-${channel.channel}`}>
              <strong>
                {channel.propertyName} [{channel.channel}]
              </strong>
              <span>
                {channel.consecutiveFailures} failed attempt
                {channel.consecutiveFailures === 1 ? '' : 's'} · retrying{' '}
                {relative(channel.nextAttemptAt)}
              </span>
              {channel.lastError && <small>{channel.lastError}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
