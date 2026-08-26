// One client, as a card. Shared by all three tabs so the directory, the
// latest-added list and the archive cannot drift apart visually.

import { Archive, ArchiveRestore, Mail, Pencil, Phone, RotateCcw, Trash2, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { GuestRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'

type ClientCardProps = {
  client: GuestRecord
  /** Shown under the name instead of the contact line, e.g. "Added 3 days ago". */
  subtitle?: string
  onEdit?: (client: GuestRecord) => void
  onArchive?: (client: GuestRecord) => void
  onRestore?: (client: GuestRecord) => void
  onDelete?: (client: GuestRecord) => void
  confirmingDelete?: boolean
}

export function ClientCard({
  client,
  subtitle,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  confirmingDelete = false,
}: ClientCardProps) {
  const navigate = useNavigate()
  const paid = Number(client.totalPaidEur)

  return (
    <div className="client-card">
      <span className="client-card-avatar" aria-hidden="true">
        <UserRound size={20} />
      </span>

      <button
        className="client-card-main"
        type="button"
        title="Open this client"
        onClick={() => navigate(`/clients/${client.id}`)}
      >
        <strong className="client-card-name">{client.fullName || 'Unnamed client'}</strong>
        {subtitle ? (
          <span className="client-card-sub">{subtitle}</span>
        ) : (
          <span className="client-card-contact">
            {client.phone && (
              <span>
                <Phone size={11} /> {client.phone}
              </span>
            )}
            {client.email && (
              <span>
                <Mail size={11} /> {client.email}
              </span>
            )}
            {!client.phone && !client.email && <span className="client-card-muted">No contact details</span>}
          </span>
        )}
      </button>

      <div className="client-card-stats">
        <span title="Stays">
          <b>{client.totalStays}</b> stay{client.totalStays === 1 ? '' : 's'}
        </span>
        <span title="Nights">
          <b>{client.totalNights}</b> night{client.totalNights === 1 ? '' : 's'}
        </span>
        <span title="Total paid">
          <b>EUR {Number.isFinite(paid) ? paid.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0'}</b>
        </span>
      </div>

      <div className="client-card-badges">
        {client.isReturning && (
          <span className="returning-badge">
            <RotateCcw size={11} /> Returning
          </span>
        )}
        {client.nationality && <span className="client-card-flagtext">{client.nationality}</span>}
        {client.isArchived && client.createdAt && (
          <span className="client-card-muted">Added {formatDisplayDate(client.createdAt.slice(0, 10))}</span>
        )}
      </div>

      <div className="client-card-actions">
        {onEdit && (
          <button
            className="pill-button"
            title="Edit this client's details"
            type="button"
            onClick={() => onEdit(client)}
          >
            <Pencil size={13} />
          </button>
        )}
        {onRestore && (
          <button
            className="pill-button"
            title="Restore this client to the directory"
            type="button"
            onClick={() => onRestore(client)}
          >
            <ArchiveRestore size={13} /> Restore
          </button>
        )}
        {onArchive && (
          <button
            className="pill-button"
            title="Archive — keeps their history and can be undone"
            type="button"
            onClick={() => onArchive(client)}
          >
            <Archive size={13} />
          </button>
        )}
        {onDelete && (
          <button
            className={`pill-button${confirmingDelete ? ' danger' : ''}`}
            title={confirmingDelete ? 'Click again to delete permanently' : 'Delete permanently'}
            type="button"
            onClick={() => onDelete(client)}
          >
            <Trash2 size={13} />
            {confirmingDelete ? ' Confirm?' : ''}
          </button>
        )}
      </div>
    </div>
  )
}
