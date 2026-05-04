import type { FormEvent } from 'react'
import type { PropertyEditPayload, PropertyPayload } from '../../api/pmsApi'
import type { PropertyListing } from '../../types/domain'

type PropertyCreateFormProps = {
  error: string
  onCancel: () => void
  onSubmit: (payload: PropertyPayload | PropertyEditPayload) => void
  property?: PropertyListing | null
  saving: boolean
}

export function PropertyCreateForm({
  error,
  onCancel,
  onSubmit,
  property,
  saving,
}: PropertyCreateFormProps) {
  const isEditing = Boolean(property)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const photo = form.get('photo')

    const payload = {
      name: String(form.get('name') || ''),
      bedrooms: Number(form.get('bedrooms') || 0),
      basePriceEur: String(form.get('basePriceEur') || '0'),
      address: String(form.get('address') || ''),
    }

    onSubmit(
      isEditing
        ? payload
        : {
            ...payload,
            photo: photo instanceof File && photo.size > 0 ? photo : null,
          },
    )
  }

  return (
    <form className="property-create-form" onSubmit={handleSubmit}>
      <label>
        Name
        <input
          name="name"
          placeholder="Apartment #3"
          required
          type="text"
          defaultValue={property?.name || ''}
        />
      </label>
      <label>
        Bedrooms
        <input
          min="0"
          name="bedrooms"
          placeholder="3"
          required
          type="number"
          defaultValue={property?.bedrooms ?? ''}
        />
      </label>
      <label>
        Price per night
        <input
          min="0"
          name="basePriceEur"
          placeholder="62"
          required
          step="0.01"
          type="number"
          defaultValue={property?.basePriceEur || ''}
        />
      </label>
      {!isEditing && (
        <label>
          Photo
          <input accept="image/*" name="photo" type="file" />
        </label>
      )}
      <label className="wide-field">
        Address
        <textarea name="address" defaultValue={property?.address || ''} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="property-create-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Save property'}
        </button>
      </div>
    </form>
  )
}
