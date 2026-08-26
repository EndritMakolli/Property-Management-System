// "Added just now" / "Added 3 hours ago" / "Added 12-Jun-2024".
//
// Shared by the reservations Latest-added view and the clients one. `now` is a
// parameter rather than a call to Date.now() inside, so the boundaries are
// testable instead of depending on when the suite happens to run.

export function formatAdded(value?: string, now: number = Date.now()): string {
  if (!value) return 'Added date unknown'
  const created = new Date(value)
  const time = created.getTime()
  if (Number.isNaN(time)) return 'Added date unknown'

  const minutes = Math.round((now - time) / 60000)
  // A clock skew between server and browser can put a record slightly in the
  // future; "in 2 minutes" would read as a bug, so it clamps to just now.
  if (minutes < 1) return 'Added just now'
  if (minutes < 60) return `Added ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Added ${hours} hour${hours !== 1 ? 's' : ''} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `Added ${days} day${days !== 1 ? 's' : ''} ago`

  const day = String(created.getDate()).padStart(2, '0')
  const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(created)
  return `Added ${day}-${month}-${created.getFullYear()}`
}
