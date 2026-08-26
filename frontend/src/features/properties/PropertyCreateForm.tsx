import { ChevronDown, ChevronUp, ImageUp, Plus, Trash2, X } from 'lucide-react'
import { lazy, Suspense, type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react'

// Lazy so leaflet stays out of the core PMS bundle.
const MapPicker = lazy(() => import('../../components/shared/MapPicker'))
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
import {
  PHOTO_ACCEPT_ATTR,
  rejectionFor,
  uploadFailureMessage,
  type PhotoRejection,
} from './photoUploads'

type PropertyCreateFormProps = {
  error: string
  onCancel: () => void
  onSubmit: (payload: PropertyPayload | PropertyEditPayload) => Promise<PropertyListing>
  /** Called once the property AND its gallery photos are saved. The parent
   *  closes the modal here, not inside onSubmit — closing there unmounted
   *  this form before the uploads ran, so failures were invisible. */
  onDone: () => void
  property?: PropertyListing | null
  saving: boolean
}

export function PropertyCreateForm({
  error,
  onCancel,
  onDone,
  onSubmit,
  property,
  saving,
}: PropertyCreateFormProps) {
  const isEditing = Boolean(property)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [coverDragging, setCoverDragging] = useState(false)
  const [listingActive, setListingActive] = useState(property?.listingActive ?? true)
  const [description, setDescription] = useState(property?.description ?? '')
  const [latitude, setLatitude] = useState(property?.latitude ?? '')
  const [longitude, setLongitude] = useState(property?.longitude ?? '')
  const [mapOpen, setMapOpen] = useState(Boolean(property?.latitude && property?.longitude))

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
    if (!file) return
    const reason = rejectionFor(file)
    if (reason) {
      // Clear it, or the form would post a file the server has to refuse.
      if (fileInputRef.current) fileInputRef.current.value = ''
      setPreviewUrl(null)
      setPhotoError(uploadFailureMessage([{ name: file.name, reason }]))
      return
    }
    setPhotoError('')
    setPreviewUrl(URL.createObjectURL(file))
  }

  function handleCoverDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setCoverDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file && fileInputRef.current) {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      fileInputRef.current.files = transfer.files
      handleFileChange()
    }
  }

  function handleGalleryFiles() {
    const files = Array.from(galleryInputRef.current?.files ?? [])
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (!files.length) return

    // Screen here rather than one failed request at a time. A file the server
    // is certain to refuse should say so while it is still on screen next to
    // the photo you picked.
    const usable: File[] = []
    const rejected: PhotoRejection[] = []
    for (const file of files) {
      const reason = rejectionFor(file)
      if (reason) rejected.push({ name: file.name, reason })
      else usable.push(file)
    }

    setPhotoError(uploadFailureMessage(rejected))
    if (!usable.length) return
    setPendingPhotos((prev) => [...prev, ...usable])
    setPendingPreviews((prev) => [...prev, ...usable.map((f) => URL.createObjectURL(f))])
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
      latitude,
      longitude,
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

    if (pendingPhotos.length === 0) {
      onDone()
      return
    }

    // Upload one at a time and keep whatever succeeded. Aborting the whole
    // batch on the first bad file used to lose the good ones with it.
    setUploadingPhotos(true)
    let sortBase = galleryPhotos.length
    const uploaded: PropertyPhotoRecord[] = []
    const failed: File[] = []
    const rejections: PhotoRejection[] = []

    for (const file of pendingPhotos) {
      try {
        uploaded.push(await uploadPropertyPhoto(savedProperty.id, file, sortBase++))
      } catch (caught) {
        // The server says exactly why — which format, or which size limit.
        // Swallowing it left "12 photos could not be uploaded" and no way to
        // find out what to do about it.
        failed.push(file)
        rejections.push({
          name: file.name,
          reason: caught instanceof Error ? caught.message : '',
        })
      }
    }

    setUploadingPhotos(false)
    setGalleryPhotos((current) => [...current, ...uploaded])
    setPendingPhotos(failed)
    setPendingPreviews((current) =>
      current.filter((_, index) => failed.includes(pendingPhotos[index])),
    )

    if (failed.length > 0) {
      // Stay open so the message is actually readable and the files can be retried.
      setPhotoError(uploadFailureMessage(rejections))
      return
    }

    onDone()
  }

  const currentPhotoUrl = previewUrl ?? property?.photoUrl ?? null

  return (
    <div className="modal-backdrop">
      <section className="modal form-modal form-modal--wide" aria-modal="true" role="dialog">
        <div className="form-modal-head">
          <div>
            <h3>{isEditing ? `Edit ${property?.name}` : 'Add new property'}</h3>
            <p>{isEditing ? 'Update this apartment’s details.' : 'Enter the apartment information.'}</p>
          </div>
          <button className="form-modal-close" aria-label="Close" type="button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <form className="form-modal-body" id="property-form" onSubmit={handleSubmit}>
          {error && <p className="form-error">{error}</p>}

          <div className="form-section">
            <p className="form-section-title">Cover photo</p>
            <label
              className={`dropzone${coverDragging ? ' dragover' : ''}`}
              onDragLeave={() => setCoverDragging(false)}
              onDragOver={(e) => {
                e.preventDefault()
                setCoverDragging(true)
              }}
              onDrop={handleCoverDrop}
            >
              {currentPhotoUrl ? (
                <span className="dropzone-preview">
                  <img src={currentPhotoUrl} alt="Property cover" />
                </span>
              ) : (
                <>
                  <ImageUp size={22} />
                  <span>Click or drop an image to upload the cover photo</span>
                </>
              )}
              <input accept={PHOTO_ACCEPT_ATTR} name="photo" type="file" ref={fileInputRef} onChange={handleFileChange} />
            </label>
          </div>

          <div className="form-section">
            <p className="form-section-title">Basics</p>
            <div className="form-grid">
              <label className="form-field wide">
                Name
                <input name="name" placeholder="Apartment #3" required type="text" defaultValue={property?.name || ''} />
              </label>
              <label className="form-field">
                Bedrooms
                <input min="0" name="bedrooms" placeholder="3" required type="number" defaultValue={property?.bedrooms ?? ''} />
              </label>
              <label className="form-field">
                Beds
                <input min="1" name="beds" placeholder="3" type="number" defaultValue={property?.beds ?? ''} />
              </label>
              <label className="form-field">
                Bathrooms
                <input min="0" name="bathrooms" placeholder="1" step="0.5" type="number" defaultValue={property?.bathrooms ?? ''} />
              </label>
              <label className="form-field">
                Max guests
                <input min="1" name="maxGuests" placeholder="4" type="number" defaultValue={property?.maxGuests || ''} />
              </label>
              <label className="form-field">
                Floor
                <input name="floor" placeholder="3rd floor" type="text" defaultValue={property?.floor || ''} />
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Location</p>
            <div className="form-grid">
              <label className="form-field wide">
                Location label (guest-facing)
                <input name="locationLabel" placeholder="Prishtina, Kosovo" type="text" defaultValue={property?.locationLabel || ''} />
              </label>
              <label className="form-field wide">
                Address
                <textarea name="address" defaultValue={property?.address || ''} />
              </label>
            </div>

            <div className="pill-toggle-group" style={{ marginTop: 10 }}>
              <button
                className={`pill-button${mapOpen ? ' accent' : ''}`}
                type="button"
                onClick={() => setMapOpen((current) => !current)}
              >
                {mapOpen ? 'Hide map' : 'Pin on map'}
              </button>
              {latitude && longitude && (
                <>
                  <span className="returning-badge">
                    📍 {Number(latitude).toFixed(4)}, {Number(longitude).toFixed(4)}
                  </span>
                  <button
                    className="pill-button"
                    type="button"
                    onClick={() => {
                      setLatitude('')
                      setLongitude('')
                    }}
                  >
                    Clear pin
                  </button>
                </>
              )}
            </div>

            {mapOpen && (
              <div style={{ marginTop: 10 }}>
                <Suspense fallback={<p className="listings-message">Loading map…</p>}>
                  <MapPicker
                    latitude={latitude}
                    longitude={longitude}
                    onChange={(lat, lng) => {
                      setLatitude(lat)
                      setLongitude(lng)
                    }}
                  />
                </Suspense>
                <p className="form-field-hint" style={{ marginTop: 6 }}>
                  Click the map to place the pin guests will see.
                </p>
              </div>
            )}
          </div>

          <div className="form-section">
            <p className="form-section-title">Wi-Fi</p>
            <div className="form-grid">
              <label className="form-field">
                Wi-Fi name
                <input name="wifiName" placeholder="Apartment3_WiFi" type="text" defaultValue={property?.wifiName || ''} />
              </label>
              <label className="form-field">
                Wi-Fi password
                <input name="wifiPassword" placeholder="password123" type="text" defaultValue={property?.wifiPassword || ''} />
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Booking website</p>
            <div className="form-grid">
              <label className="form-field">
                Rating (0–5)
                <input min="0" max="5" step="0.01" name="rating" placeholder="4.92" type="number" defaultValue={property?.rating || ''} />
              </label>
              <label className="form-field">
                Review count
                <input min="0" name="reviewCount" placeholder="128" type="number" defaultValue={property?.reviewCount ?? ''} />
              </label>
              <label className="form-field wide">
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Bright, modern apartment in the heart of Prishtina…"
                  rows={3}
                />
              </label>
              <label className="form-checkbox-row wide">
                <input type="checkbox" checked={listingActive} onChange={(e) => setListingActive(e.target.checked)} />
                Show on booking website
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Amenities</p>
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
                style={{ flex: '1 1 200px' }}
              />
              <button type="button" className="pill-button" onClick={handleAddAmenity} disabled={addingAmenity || !newAmenityName.trim()}>
                <Plus size={13} /> Add amenity
              </button>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Gallery photos</p>
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
          <input accept={PHOTO_ACCEPT_ATTR} multiple type="file" ref={galleryInputRef} onChange={handleGalleryFiles} style={{ display: 'none' }} />
        </label>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
          Use the ↑ ↓ buttons under each photo to set their order. The first photo is shown first to guests.
        </p>
        {photoError && <p style={{ color: 'var(--error)', fontSize: '0.85rem', margin: '4px 0 0' }}>{photoError}</p>}
        {uploadingPhotos && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>Uploading photos…</p>}
      </div>

      {isEditing && (
        <div className="form-section">
          <p className="form-section-title">Guest reviews</p>
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
            <button type="button" className="pill-button" onClick={handleAddReview} disabled={savingReview || !newReview.guestName.trim()}>
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      )}
        </form>

        <div className="form-modal-footer">
          <button className="pill-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="pill-button accent" disabled={saving || uploadingPhotos} form="property-form" type="submit">
            {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Add property'}
          </button>
        </div>
      </section>
    </div>
  )
}
