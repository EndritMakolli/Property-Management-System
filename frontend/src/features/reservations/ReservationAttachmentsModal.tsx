import { Paperclip, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  deleteReservationAttachment,
  fetchReservationAttachments,
  uploadReservationAttachment,
} from '../../api/pmsApi'
import type { ReservationAttachment } from '../../types/domain'

type Props = {
  reservationId: string
  guestName: string
  onClose: () => void
}

export function ReservationAttachmentsModal({ reservationId, guestName, onClose }: Props) {
  const [attachments, setAttachments] = useState<ReservationAttachment[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let ignore = false
    fetchReservationAttachments(reservationId)
      .then((rows) => { if (!ignore) { setAttachments(rows); setStatus('ready') } })
      .catch(() => { if (!ignore) setStatus('error') })
    return () => { ignore = true }
  }, [reservationId])

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const newAttachment = await uploadReservationAttachment(reservationId, file)
      setAttachments((prev) => [...prev, newAttachment])
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(attachmentId: string) {
    if (!window.confirm('Delete this attachment?')) return
    await deleteReservationAttachment(reservationId, attachmentId)
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ minWidth: 380, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <Paperclip size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Attachments — {guestName || 'Reservation'}
          </h3>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {status === 'loading' && <p className="listings-message">Loading...</p>}
        {status === 'error' && <p className="form-error">Could not load attachments.</p>}

        {status === 'ready' && (
          <>
            {attachments.length === 0 ? (
              <p className="listings-message">No attachments yet.</p>
            ) : (
              <ul className="attachment-list">
                {attachments.map((att) => (
                  <li key={att.id} className="attachment-item">
                    <a
                      className="attachment-name"
                      href={att.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {att.originalName}
                    </a>
                    <button
                      className="attachment-delete"
                      title="Delete"
                      type="button"
                      onClick={() => handleDelete(att.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="attachment-upload-row">
              <label className="attachment-upload-label">
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={handleUpload}
                />
                <span className="primary-button" style={{ cursor: 'pointer' }}>
                  {uploading ? 'Uploading...' : 'Upload file'}
                </span>
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
