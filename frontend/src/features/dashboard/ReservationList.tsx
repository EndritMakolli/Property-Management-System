import { useState } from 'react'
import type { DashboardStay } from '../../types/domain'

type ReservationListProps = {
  initialVisibleCount?: number
  items: DashboardStay[]
  title: string
  // When provided, rows become clickable/keyboard-focusable and call this with the
  // reservation id so the parent can open the editor. Omitted (e.g. cleaner view)
  // leaves rows static.
  onSelect?: (id: string) => void
}

function formatEur(amount: number) {
  return `€${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function ReservationList({ title, items, initialVisibleCount, onSelect }: ReservationListProps) {
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
      {visibleItems.map((item) => {
        const clickable = Boolean(onSelect)
        return (
          <article
            className={`reservation-item${clickable ? ' is-clickable' : ''}`}
            key={item.id}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onSelect?.(item.id) : undefined}
            onKeyDown={
              clickable
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect?.(item.id)
                    }
                  }
                : undefined
            }
          >
            <div>
              <strong>{item.guestName}</strong>
              <span>{item.propertyName}</span>
              <small>{item.detail}</small>
            </div>
            <div className="reservation-item-right">
              {item.amount != null && <span className="reservation-amount money">{formatEur(item.amount)}</span>}
              <span className={`platform platform-${item.platformCode}`}>{item.platform}</span>
            </div>
          </article>
        )
      })}
      {canToggle && (
        <button className="show-more-button" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'Show less' : `Show more (${items.length - visibleItems.length})`}
        </button>
      )}
    </div>
  )
}
