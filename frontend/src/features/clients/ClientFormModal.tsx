import { FileText, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  createGuest,
  deleteGuestDocument,
  fetchGuestDocuments,
  updateGuest,
  uploadGuestDocument,
  type GuestDocType,
  type GuestDocumentRecord,
  type GuestPayload,
} from '../../api/guests'
import type { GuestRecord } from '../../types/domain'

const DOC_TYPE_OPTIONS: { value: GuestDocType; label: string }[] = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID' },
  { value: 'drivers_license', label: "Driver's license" },
  { value: 'other', label: 'Other document' },
]

type ClientFormModalProps = {
  client?: GuestRecord | null
  onClose: () => void
  onSaved: (saved: GuestRecord) => void
  open: boolean
}

const emptyForm: GuestPayload = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  whatsappNumber: '',
  nationality: '',
  notes: '',
  isReturning: false,
}

export function ClientFormModal({ client, onClose, onSaved, open }: ClientFormModalProps) {
  const isEditing = Boolean(client)
  const [form, setForm] = useState<GuestPayload>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [documents, setDocuments] = useState<GuestDocumentRecord[]>([])
  const [docType, setDocType] = useState<GuestDocType>('passport')
  const [docBusy, setDocBusy] = useState(false)
  const [docError, setDocError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setDocError('')
    setDocuments([])
    setForm(
      client
        ? {
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
            phone: client.phone,
            whatsappNumber: client.whatsappNumber,
            nationality: client.nationality,
            notes: client.notes,
            isReturning: client.isReturning,
          }
        : emptyForm,
    )
    if (!client) return

    // Guard against a slow response for a previously-opened client landing in
    // this modal — showing one person's ID documents under another's name.
    let ignore = false
    fetchGuestDocuments(client.id)
      .then((rows) => { if (!ignore) setDocuments(rows) })
      .catch(() => { if (!ignore) setDocError('Could not load ID documents.') })
    return () => { ignore = true }
  }, [client, open])

  if (!open) return null

  async function handleDocumentUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !client) return
    if (file.size > 10 * 1024 * 1024) {
      setDocError('The file is larger than 10 MB.')
      return
    }
    setDocBusy(true)
    setDocError('')
    try {
      const uploaded = await uploadGuestDocument(client.id, file, docType)
      setDocuments((current) => [...current, uploaded])
    } catch (caught) {
      setDocError(caught instanceof Error ? caught.message : 'Could not upload the document.')
    } finally {
      setDocBusy(false)
    }
  }

  async function handleDocumentDelete(documentId: string) {
    if (!client || !window.confirm('Delete this document?')) return
    setDocBusy(true)
    setDocError('')
    try {
      await deleteGuestDocument(client.id, documentId)
      setDocuments((current) => current.filter((doc) => doc.id !== documentId))
    } catch (caught) {
      setDocError(caught instanceof Error ? caught.message : 'Could not delete the document.')
    } finally {
      setDocBusy(false)
    }
  }

  function update(patch: Partial<GuestPayload>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const saved = client ? await updateGuest(client.id, form) : await createGuest(form)
      onSaved(saved)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the client.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal form-modal" aria-modal="true" role="dialog">
        <div className="form-modal-head">
          <div>
            <h3>{isEditing ? `Edit ${client?.fullName}` : 'Register client'}</h3>
            <p>{isEditing ? 'Update this client’s details.' : 'Add a guest to your client directory.'}</p>
          </div>
          <button className="form-modal-close" aria-label="Close" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="form-modal-body" id="client-form" onSubmit={save}>
          {error && <p className="form-error">{error}</p>}

          <div className="form-section">
            <p className="form-section-title">Identity</p>
            <div className="form-grid">
              <label className="form-field">
                First name
                <input
                  required
                  type="text"
                  value={form.firstName ?? ''}
                  onChange={(e) => update({ firstName: e.target.value })}
                />
              </label>
              <label className="form-field">
                Last name
                <input type="text" value={form.lastName ?? ''} onChange={(e) => update({ lastName: e.target.value })} />
              </label>
              <label className="form-field wide">
                Nationality
                <input
                  type="text"
                  placeholder="Kosovo"
                  value={form.nationality ?? ''}
                  onChange={(e) => update({ nationality: e.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Contact</p>
            <div className="form-grid">
              <label className="form-field">
                Phone
                <input type="tel" value={form.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} />
              </label>
              <label className="form-field">
                WhatsApp
                <input
                  type="tel"
                  value={form.whatsappNumber ?? ''}
                  onChange={(e) => update({ whatsappNumber: e.target.value })}
                />
              </label>
              <label className="form-field wide">
                Email
                <input
                  type="email"
                  placeholder="guest@example.com"
                  value={form.email ?? ''}
                  onChange={(e) => update({ email: e.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Notes</p>
            <label className="form-field">
              <textarea value={form.notes ?? ''} onChange={(e) => update({ notes: e.target.value })} />
            </label>
            <label className="form-checkbox-row" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={form.isReturning ?? false}
                onChange={(e) => update({ isReturning: e.target.checked })}
              />
              Returning guest
            </label>
          </div>

          <div className="form-section">
            <p className="form-section-title">ID documents</p>
            {docError && <p className="form-error">{docError}</p>}
            {!isEditing ? (
              <p className="list-empty">Save the client first, then attach ID documents here.</p>
            ) : (
              <>
                {documents.length === 0 ? (
                  <p className="list-empty">No documents uploaded yet.</p>
                ) : (
                  <ul className="client-doc-list">
                    {documents.map((doc) => (
                      <li className="client-doc-item" key={doc.id}>
                        <FileText size={15} />
                        <a href={doc.url} target="_blank" rel="noreferrer" className="client-doc-name">
                          {doc.docTypeLabel}
                          {doc.originalName ? ` — ${doc.originalName}` : ''}
                        </a>
                        <button
                          aria-label="Delete document"
                          className="client-doc-delete"
                          disabled={docBusy}
                          type="button"
                          onClick={() => handleDocumentDelete(doc.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="client-doc-upload">
                  <select
                    aria-label="Document type"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as GuestDocType)}
                  >
                    {DOC_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <label className={`pill-button${docBusy ? ' disabled' : ''}`}>
                    <Upload size={14} />
                    {docBusy ? 'Working…' : 'Upload document'}
                    <input
                      accept="image/*,application/pdf"
                      disabled={docBusy}
                      hidden
                      type="file"
                      onChange={handleDocumentUpload}
                    />
                  </label>
                </div>
                <p className="client-doc-hint">
                  Images or PDF, up to 10 MB. To replace a document, upload the new one and delete the old.
                </p>
              </>
            )}
          </div>
        </form>

        <div className="form-modal-footer">
          <button className="pill-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="pill-button accent" disabled={saving} form="client-form" type="submit">
            {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Register client'}
          </button>
        </div>
      </section>
    </div>
  )
}
