import { Pencil } from 'lucide-react'
import type { ReactNode } from 'react'

type FinanceListProps<T extends { id: string }> = {
  empty: string
  onDelete: (id: string) => void
  onEdit?: (row: T) => void
  render: (row: T) => ReactNode
  rows: T[]
}

export function FinanceList<T extends { id: string }>({ empty, onDelete, onEdit, render, rows }: FinanceListProps<T>) {
  if (rows.length === 0) {
    return <p className="list-empty">{empty}</p>
  }

  return (
    <div className="finance-list">
      {rows.map((row) => (
        <article className="finance-list-row" key={row.id}>
          <div>{render(row)}</div>
          <div className="finance-list-actions">
            {onEdit && (
              <button type="button" title="Edit" onClick={() => onEdit(row)}>
                <Pencil size={13} />
              </button>
            )}
            <button type="button" onClick={() => onDelete(row.id)}>
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}
