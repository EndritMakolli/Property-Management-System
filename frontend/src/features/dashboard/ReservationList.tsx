import { useState } from 'react'
import type { DashboardStay } from '../../types/domain'

type ReservationListProps = {
  initialVisibleCount?: number
  items: DashboardStay[]
  title: string
}

function formatEur(amount: number) {
  return `€${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function ReservationList({ title, items, initialVisibleCount }: ReservationListProps) {
  const [expanded, setExpanded] = useState(false)
  const canToggle = Boolean(initialVisibleCount && items.length > initialVisibleCount)
  const visibleItems = canToggle && !expanded ? items.slice(0, initialVisibleCount) : items

  const hasAmounts = items.some((item) => item.amount != null)
  const dayTotal = items.reduce((sum, item) => sum + (item.amount ?? 0), 0)

  return (
    <div className="reservation-list">
      <div className="reservation-list-head">
        <h3>{title}</h3>
        {hasAmounts && items.length > 0 && (
          <span className="reservation-day-total" title="Total for the day">{formatEur(dayTotal)}</span>
        )}
      </div>
      {items.length === 0 && <p className="list-empty">No reservations.</p>}
      {visibleItems.map((item) => (
        <article className="reservation-item" key={item.id}>
          <div>
            <strong>{item.guestName}</strong>
            <span>{item.propertyName}</span>
            <small>{item.detail}</small>
          </div>
          <div className="reservation-item-right">
            {item.amount != null && <span className="reservation-amount">{formatEur(item.amount)}</span>}
            <span className={`platform platform-${item.platform.toLowerCase()}`}>{item.platform}</span>
          </div>
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
