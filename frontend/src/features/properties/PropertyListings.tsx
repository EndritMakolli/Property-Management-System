import { Building2, Plus, Wifi, X } from 'lucide-react'
import { useState } from 'react'
import type { PropertyListing } from '../../types/domain'
import { formatNightlyPrice } from './formatting'

type PropertyListingsProps = {
  onAdd: () => void
  onDelete: (property: PropertyListing) => void
  onEdit: (property: PropertyListing) => void
  properties: PropertyListing[]
  status: 'loading' | 'ready' | 'error'
}

export function PropertyListings({ onAdd, onDelete, onEdit, properties, status }: PropertyListingsProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [detailProperty, setDetailProperty] = useState<PropertyListing | null>(null)

  function handleDeleteClick(property: PropertyListing) {
    if (confirmDeleteId === property.id) {
      onDelete(property)
      setConfirmDeleteId(null)
    } else {
      setConfirmDeleteId(property.id)
    }
  }

  return (
    <section className="listings-page">
      <div className="listings-header">
        <h2>Your listings</h2>
        <div className="listings-actions">
          <button className="primary-button" aria-label="Add listing" onClick={onAdd}>
            <Plus size={18} />
            Add property
          </button>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading properties...</p>}
      {status === 'error' && (
        <p className="listings-message">Start the Django server, then refresh this page.</p>
      )}
      {status === 'ready' && properties.length === 0 && (
        <p className="listings-message">No properties yet. Add one to get started.</p>
      )}

      <div className="listings-grid">
        {properties.map((property) => {
          const confirming = confirmDeleteId === property.id
          return (
            <article
              className="listing-card"
              key={property.id}
              onClick={() => setDetailProperty(property)}
              style={{ cursor: 'pointer' }}
            >
              <div className="listing-photo">
                {property.photoUrl ? (
                  <img alt={property.name} src={property.photoUrl} />
                ) : (
                  <div className="photo-placeholder">
                    <Building2 size={34} />
                  </div>
                )}
                <span className={`listed-badge ${property.active ? '' : 'unlisted'}`}>
                  <i />
                  {property.active ? 'Listed' : 'Unlisted'}
                </span>
              </div>
              <div className="listing-info">
                <strong>{property.name}</strong>
                <span>{property.bedrooms} bedroom{property.bedrooms !== 1 ? 's' : ''}{property.floor ? ` · ${property.floor}` : ''}</span>
                <span>{formatNightlyPrice(property.basePriceEur)} per night</span>
                <small>{property.address || 'Home in Prishtina, Kosovo'}</small>
                {property.wifiName && (
                  <small className="wifi-row"><Wifi size={12} /> {property.wifiName}</small>
                )}
                <div
                  className="listing-card-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="listing-edit-button"
                    type="button"
                    onClick={() => {
                      setConfirmDeleteId(null)
                      onEdit(property)
                    }}
                  >
                    Edit
                  </button>
                  {confirming ? (
                    <>
                      <button
                        className="listing-delete-button confirm"
                        type="button"
                        onClick={() => handleDeleteClick(property)}
                      >
                        Confirm
                      </button>
                      <button
                        className="listing-delete-button"
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="listing-delete-button"
                      type="button"
                      onClick={() => handleDeleteClick(property)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {detailProperty && (
        <PropertyDetailModal
          property={detailProperty}
          onClose={() => setDetailProperty(null)}
          onEdit={() => {
            onEdit(detailProperty)
            setDetailProperty(null)
          }}
        />
      )}
    </section>
  )
}

function PropertyDetailModal({
  property,
  onClose,
  onEdit,
}: {
  property: PropertyListing
  onClose: () => void
  onEdit: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal property-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{property.name}</h3>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        {property.photoUrl && (
          <img
            src={property.photoUrl}
            alt={property.name}
            className="property-detail-photo"
          />
        )}
        <div className="property-detail-fields">
          <DetailRow label="Bedrooms" value={String(property.bedrooms)} />
          {property.floor && <DetailRow label="Floor" value={property.floor} />}
          <DetailRow label="Nightly price" value={`EUR ${formatNightlyPrice(property.basePriceEur)}`} />
          {property.address && <DetailRow label="Address" value={property.address} />}
          {property.wifiName && <DetailRow label="Wi-Fi Name" value={property.wifiName} />}
          {property.wifiPassword && <DetailRow label="Wi-Fi Password" value={property.wifiPassword} />}
          <DetailRow label="Status" value={property.active ? 'Listed' : 'Unlisted'} />
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose}>Close</button>
          <button className="primary-button" type="button" onClick={onEdit}>Edit</button>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  )
}
