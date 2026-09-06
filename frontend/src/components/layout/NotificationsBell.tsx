// The bell in the topbar.
//
// The feed is computed server-side from current state, so there is nothing to
// retract: a reminder disappears when the thing is dealt with, without anyone
// dismissing it. Marking read is only about the count on the bell.
//
// It polls rather than holding a socket open. A service falling due is not a
// per-second event, and one small request a few times an hour costs less than
// a connection per open tab.

import { AlertTriangle, Bell, CalendarClock, Check, Inbox } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchNotifications,
  markNotificationsRead,
  type NotificationRecord,
} from '../../api/notifications'

const POLL_MS = 5 * 60 * 1000

function iconFor(kind: string) {
  if (kind.startsWith('registration')) return <CalendarClock size={15} />
  if (kind.startsWith('service')) return <AlertTriangle size={15} />
  return <Inbox size={15} />
}

export function NotificationsBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<NotificationRecord[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const payload = await fetchNotifications()
      setRows(payload.notifications)
      setUnread(payload.unread)
    } catch {
      // A failed poll leaves the last good feed on screen rather than
      // emptying the bell and implying all is well.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // Close on a click anywhere else, the way the other popovers behave.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function markAllRead() {
    setUnread(0)
    setRows((current) => current.map((row) => ({ ...row, read: true })))
    try {
      await markNotificationsRead({ all: true })
    } catch {
      load()
    }
  }

  async function openNotification(row: NotificationRecord) {
    setOpen(false)
    if (!row.read) {
      setUnread((current) => Math.max(0, current - 1))
      setRows((current) => current.map((r) => (r.key === row.key ? { ...r, read: true } : r)))
      markNotificationsRead({ keys: [row.key] }).catch(() => load())
    }
    navigate(row.link)
  }

  return (
    <div className="notif-wrap" ref={panelRef}>
      <button
        aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
        className={`icon-button notif-button${unread > 0 ? ' has-unread' : ''}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={19} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="notif-mark-all" type="button" onClick={markAllRead}>
                <Check size={13} /> Mark all read
              </button>
            )}
          </div>

          {loading ? (
            <p className="notif-empty">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="notif-empty">Nothing needs attention.</p>
          ) : (
            <ul className="notif-list">
              {rows.map((row) => (
                <li key={row.key}>
                  <button
                    className={`notif-item notif-${row.severity}${row.read ? ' read' : ''}`}
                    type="button"
                    onClick={() => openNotification(row)}
                  >
                    <span className="notif-icon">{iconFor(row.kind)}</span>
                    <span className="notif-text">
                      <strong>{row.title}</strong>
                      <span>{row.message}</span>
                    </span>
                    {!row.read && <span className="notif-dot" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
