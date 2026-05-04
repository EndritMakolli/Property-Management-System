import { useState } from 'react'
import type { DashboardStay } from '../../types/domain'

type ReservationListProps = {
  initialVisibleCount?: number
  items: DashboardStay[]
  title: string
}

export function ReservationList({ title, items, initialVisibleCount }: ReservationListProps) {
  const [expanded, setExpanded] = useState(false)
  const canToggle = Boolean(initialVisibleCount && items.length > initialVisibleCount)
  const visibleItems = canToggle && !expanded ? items.slice(0, initialVisibleCount) : items

  return (
    <div className="reservation-list">
      <h3>{title}</h3>
      {items.length === 0 && <p className="list-empty">No reservations.</p>}
      {visibleItems.map((item) => (
        <article className="reservation-item" key={item.id}>
          <div>
            <strong>{item.guestName}</strong>
            <span>{item.propertyName}</span>
            <small>{item.detail}</small>
          </div>
          <span className={`platform platform-${item.platform.toLowerCase()}`}>{item.platform}</span>
        </article>
      ))}
      {canToggle && (
        <button className="show-more-button" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'Show less' : `Show more (${items.length - visibleItems.length})`}
        </button>
      )}
    </div>
  )
}
