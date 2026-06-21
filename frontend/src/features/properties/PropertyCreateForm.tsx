import { Building2, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  createAmenity,
  createPropertyReview,
  deletePropertyPhoto,
  deletePropertyReview,
  fetchAmenities,
  fetchPropertyPhotos,
  fetchPropertyReviews,
  reorderPropertyPhotos,
  updatePropertyAmenities,
  uploadPropertyPhoto,
  type PropertyEditPayload,
  type PropertyPayload,
} from '../../api/pmsApi'
import type { AmenityRecord, PropertyListing, PropertyPhotoRecord, PropertyReviewRecord } from '../../types/domain'

type PropertyCreateFormProps = {
  error: string
  onCancel: () => void
  onSubmit: (payload: PropertyPayload | PropertyEditPayload) => Promise<PropertyListing>
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [listingActive, setListingActive] = useState(property?.listingActive ?? true)
  const [description, setDescription] = useState(property?.description ?? '')

  const [amenities, setAmenities] = useState<AmenityRecord[]>([])
  const [selectedAmenities, setSelectedAmenities] = useState<Set<string>>(
    new Set(property?.amenityIds ?? [])
  )
  const [newAmenityName, setNewAmenityName] = useState('')
  const [addingAmenity, setAddingAmenity] = useState(false)

  const [galleryPhotos, setGalleryPhotos] = useState<PropertyPhotoRecord[]>([])
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([])
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [photoError, setPhotoError] = useState('')

  const [reviews, setReviews] = useState<PropertyReviewRecord[]>([])
  const [newReview, setNewReview] = useState({ guestName: '', rating: 5, comment: '', stayLabel: '' })
  const [savingReview, setSavingReview] = useState(false)

  useEffect(() => {
    fetchAmenities()
      .then(setAmenities)
      .catch(() => {})

    if (property?.id) {
      fetchPropertyPhotos(property.id)
        .then(setGalleryPhotos)
        .catch(() => {})
      fetchPropertyReviews(property.id)
        .then(setReviews)
        .catch(() => {})
    }
  }, [property?.id])

  async function handleAddReview() {
    if (!property?.id || !newReview.guestName.trim()) return
    setSavingReview(true)
    try {
      const created = await createPropertyReview(property.id, newReview)
      setReviews((prev) => [created, ...prev])
      setNewReview({ guestName: '', rating: 5, comment: '', stayLabel: '' })
    } catch {
      /* non-critical */
    } finally {
      setSavingReview(false)
    }
  }

  async function handleDeleteReview(reviewId: string) {
    if (!property?.id) return
    try {
      await deletePropertyReview(property.id, reviewId)
      setReviews((prev) => prev.filter((r) => r.id !== reviewId))
    } catch {
      /* non-critical */
    }
  }

  function handleFileChange() {
    const file = fileInputRef.current?.files?.[0]
    if (file) setPreviewUrl(URL.createObjectURL(file))
  }

  function handleGalleryFiles() {
    const files = Array.from(galleryInputRef.current?.files ?? [])
    if (!files.length) return
    setPendingPhotos((prev) => [...prev, ...files])
    setPendingPreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))])
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  function removePending(index: number) {
    setPendingPhotos((prev) => prev.filter((_, i) => i !== index))
    setPendingPreviews((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleDeletePhoto(photoId: string) {
    if (!property?.id) return
    try {
      await deletePropertyPhoto(property.id, photoId)
      setGalleryPhotos((prev) => prev.filter((p) => p.id !== photoId))
    } catch {
      setPhotoError('Could not delete photo.')
    }
  }

  async function handleMovePhoto(index: number, direction: -1 | 1) {
    const newList = [...galleryPhotos]
    const swapIndex = index + direction
    if (swapIndex < 0 || swapIndex >= newList.length) return
    ;[newList[index], newList[swapIndex]] = [newList[swapIndex], newList[index]]
    const reordered = newList.map((p, i) => ({ ...p, sortOrder: i }))
    setGalleryPhotos(reordered)
    if (property?.id) {
      try {
        await reorderPropertyPhotos(property.id, reordered.map((p) => ({ id: p.id, sortOrder: p.sortOrder })))
      } catch {
        setPhotoError('Could not reorder photos.')
      }
    }
  }

  function toggleAmenity(id: string) {
    setSelectedAmenities((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAddAmenity() {
    const name = newAmenityName.trim()
    if (!name) return
    // Reuse an existing amenity if the name already exists.
    const existing = amenities.find((a) => a.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      setSelectedAmenities((prev) => new Set(prev).add(existing.id))
      setNewAmenityName('')
      return
    }
    setAddingAmenity(true)
    try {
      const created = await createAmenity({ name, icon: '', sortOrder: amenities.length })
      setAmenities((prev) => [...prev, created])
      setSelectedAmenities((prev) => new Set(prev).add(created.id))
      setNewAmenityName('')
    } catch {
      /* non-critical */
    } finally {
      setAddingAmenity(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPhotoError('')
    const form = new FormData(event.currentTarget)
    const photo = form.get('photo')
    const photoFile = photo instanceof File && photo.size > 0 ? photo : null

    const base = {
      name: String(form.get('name') || ''),
      bedrooms: Number(form.get('bedrooms') || 0),
      basePriceEur: String(form.get('basePriceEur') || '0'),
      address: String(form.get('address') || ''),
      floor: String(form.get('floor') || ''),
      wifiName: String(form.get('wifiName') || ''),
      wifiPassword: String(form.get('wifiPassword') || ''),
      description,
      listingActive,
      maxGuests: Number(form.get('maxGuests') || 0),
      beds: Number(form.get('beds') || 1),
      bathrooms: Number(form.get('bathrooms') || 1),
      locationLabel: String(form.get('locationLabel') || ''),
      rating: String(form.get('rating') || ''),
      reviewCount: Number(form.get('reviewCount') || 0),
    }

    let savedProperty: PropertyListing
    try {
      savedProperty = await onSubmit({ ...base, photo: photoFile })
    } catch {
      return
    }

    try {
      await updatePropertyAmenities(savedProperty.id, Array.from(selectedAmenities))
    } catch {
      /* non-critical */
    }

    if (pendingPhotos.length > 0) {
      setUploadingPhotos(true)
      let sortBase = galleryPhotos.length
      try {
        for (const file of pendingPhotos) {
          await uploadPropertyPhoto(savedProperty.id, file, sortBase++)
        }
      } catch {
        setPhotoError('Some photos could not be uploaded.')
      } finally {
        setUploadingPhotos(false)
        setPendingPhotos([])
        setPendingPreviews([])
      }
    }
  }

  const currentPhotoUrl = previewUrl ?? property?.photoUrl ?? null

  return (
    <form className="property-create-form" onSubmit={handleSubmit}>
      <label>
        Name
        <input name="name" placeholder="Apartment #3" required type="text" defaultValue={property?.name || ''} />
      </label>
      <label>
        Bedrooms
        <input min="0" name="bedrooms" placeholder="3" required type="number" defaultValue={property?.bedrooms ?? ''} />
      </label>
      <label>
        Max guests
        <input min="1" name="maxGuests" placeholder="4" type="number" defaultValue={property?.maxGuests || ''} />
      </label>
      <label>
        Beds
        <input min="1" name="beds" placeholder="3" type="number" defaultValue={property?.beds ?? ''} />
      </label>
      <label>
        Bathrooms
        <input min="1" name="bathrooms" placeholder="1" type="number" defaultValue={property?.bathrooms ?? ''} />
      </label>
      <label>
        Floor
        <input name="floor" placeholder="3rd floor" type="text" defaultValue={property?.floor || ''} />
      </label>
      <label>
        Location label (guest-facing)
        <input name="locationLabel" placeholder="Prishtina, Kosovo" type="text" defaultValue={property?.locationLabel || ''} />
      </label>
      <label>
        Rating (0–5)
        <input min="0" max="5" step="0.01" name="rating" placeholder="4.92" type="number" defaultValue={property?.rating || ''} />
      </label>
      <label>
        Review count
        <input min="0" name="reviewCount" placeholder="128" type="number" defaultValue={property?.reviewCount ?? ''} />
      </label>
      <label>
        Price per night
        <input min="0" name="basePriceEur" placeholder="62" required step="0.01" type="number" defaultValue={property?.basePriceEur || ''} />
      </label>
      <label>
        Wi-Fi Name
        <input name="wifiName" placeholder="Apartment3_WiFi" type="text" defaultValue={property?.wifiName || ''} />
      </label>
      <label>
        Wi-Fi Password
        <input name="wifiPassword" placeholder="password123" type="text" defaultValue={property?.wifiPassword || ''} />
      </label>
      <label>
        Cover photo
        <div className="photo-upload-preview">
          {currentPhotoUrl ? (
            <img className="photo-thumb" src={currentPhotoUrl} alt="Property photo" />
          ) : (
            <div className="photo-thumb-placeholder">
              <Building2 size={22} />
            </div>
          )}
          <input accept="image/*" name="photo" type="file" ref={fileInputRef} onChange={handleFileChange} />
        </div>
      </label>
      <label className="wide-field">
        Address
        <textarea name="address" defaultValue={property?.address || ''} />
      </label>
      <label className="wide-field">
        Description (booking website)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Bright, modern apartment in the heart of Prishtina…"
          rows={3}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={listingActive} onChange={(e) => setListingActive(e.target.checked)} />
        Show on booking website
      </label>

      <div className="wide-field">
        <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: '0.9rem' }}>Amenities (what this place offers)</p>
        {amenities.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 10 }}>
            {amenities.map((a) => (
              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.88rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedAmenities.has(a.id)}
                  onChange={() => toggleAmenity(a.id)}
                />
                {a.name}
              </label>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Add an amenity, e.g. Balcony"
            value={newAmenityName}
            onChange={(e) => setNewAmenityName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAmenity() } }}
            style={{ flex: '1 1 200px', minHeight: 34, padding: '0 10px' }}
          />
          <button type="button" className="btn btn-sm btn-primary" onClick={handleAddAmenity} disabled={addingAmenity || !newAmenityName.trim()}>
            <Plus size={13} /> Add amenity
          </button>
        </div>
      </div>

      <div className="wide-field">
        <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.9rem' }}>Gallery photos</p>
        {galleryPhotos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {galleryPhotos.map((photo, i) => (
              <div key={photo.id} style={{ position: 'relative', width: 80, flexShrink: 0 }}>
                <img
                  src={photo.url}
                  alt=""
                  style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 2 }}>
                  <button type="button" className="btn btn-sm" style={{ padding: '1px 4px' }} onClick={() => handleMovePhoto(i, -1)} disabled={i === 0}>
                    <ChevronUp size={12} />
                  </button>
                  <button type="button" className="btn btn-sm" style={{ padding: '1px 4px' }} onClick={() => handleMovePhoto(i, 1)} disabled={i === galleryPhotos.length - 1}>
                    <ChevronDown size={12} />
                  </button>
                  <button type="button" className="btn btn-sm btn-outline" style={{ padding: '1px 4px' }} onClick={() => handleDeletePhoto(photo.id)} title="Delete">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {pendingPreviews.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {pendingPreviews.map((url, i) => (
              <div key={i} style={{ position: 'relative', width: 80 }}>
                <img
                  src={url}
                  alt=""
                  style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4, border: '2px dashed var(--border)', opacity: 0.7 }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  style={{ position: 'absolute', top: 2, right: 2, padding: '1px 3px' }}
                  onClick={() => removePending(i)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem',
            border: '1.5px dashed var(--border)', borderRadius: 8, padding: '10px 16px', fontWeight: 600,
          }}
        >
          <Plus size={15} />
          Select photos to upload (you can pick several at once)
          <input accept="image/*" multiple type="file" ref={galleryInputRef} onChange={handleGalleryFiles} style={{ display: 'none' }} />
        </label>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
          Use the ↑ ↓ buttons under each photo to set their order. The first photo is shown first to guests.
        </p>
        {photoError && <p style={{ color: 'var(--error)', fontSize: '0.85rem', margin: '4px 0 0' }}>{photoError}</p>}
        {uploadingPhotos && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>Uploading photos…</p>}
      </div>

      {isEditing && (
        <div className="wide-field">
          <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.9rem' }}>Guest reviews</p>
          {reviews.length > 0 && (
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              {reviews.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {r.guestName} · {'★'.repeat(r.rating)}{r.stayLabel ? ` · ${r.stayLabel}` : ''}
                    </div>
                    {r.comment && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>{r.comment}</div>}
                  </div>
                  <button type="button" className="btn btn-sm btn-outline" style={{ padding: '2px 6px' }} onClick={() => handleDeleteReview(r.id)} title="Delete">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Guest name"
              value={newReview.guestName}
              onChange={(e) => setNewReview((p) => ({ ...p, guestName: e.target.value }))}
              style={{ flex: '1 1 140px', minHeight: 34, padding: '0 8px' }}
            />
            <select
              value={newReview.rating}
              onChange={(e) => setNewReview((p) => ({ ...p, rating: Number(e.target.value) }))}
              style={{ minHeight: 34, padding: '0 6px' }}
            >
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
            </select>
            <input
              type="text"
              placeholder="May 2026"
              value={newReview.stayLabel}
              onChange={(e) => setNewReview((p) => ({ ...p, stayLabel: e.target.value }))}
              style={{ flex: '0 1 110px', minHeight: 34, padding: '0 8px' }}
            />
            <input
              type="text"
              placeholder="Comment"
              value={newReview.comment}
              onChange={(e) => setNewReview((p) => ({ ...p, comment: e.target.value }))}
              style={{ flex: '2 1 200px', minHeight: 34, padding: '0 8px' }}
            />
            <button type="button" className="btn btn-sm btn-primary" onClick={handleAddReview} disabled={savingReview || !newReview.guestName.trim()}>
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      <div className="property-create-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" disabled={saving || uploadingPhotos} type="submit">
          {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Save property'}
        </button>
      </div>
    </form>
  )
}
