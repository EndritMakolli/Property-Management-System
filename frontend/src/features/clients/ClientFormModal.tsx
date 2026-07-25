import { X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { createGuest, updateGuest, type GuestPayload } from '../../api/guests'
import type { GuestRecord } from '../../types/domain'

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

  useEffect(() => {
    if (!open) return
    setError('')
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
  }, [client, open])

  if (!open) return null

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
