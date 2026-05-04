import { Building2, Plus, Search } from 'lucide-react'
import type { PropertyListing } from '../../types/domain'
import { formatNightlyPrice } from './formatting'

type PropertyListingsProps = {
  onAdd: () => void
  onEdit: (property: PropertyListing) => void
  properties: PropertyListing[]
  status: 'loading' | 'ready' | 'error'
}

export function PropertyListings({ onAdd, onEdit, properties, status }: PropertyListingsProps) {
  return (
    <section className="listings-page">
      <div className="listings-header">
        <h2>Your listings</h2>
        <div className="listings-actions">
          <button>
            Show tips <span>9+</span>
          </button>
          <button className="round-button" aria-label="Search listings">
            <Search size={18} />
          </button>
          <button className="round-button" aria-label="View options">
            <Building2 size={18} />
          </button>
          <button className="round-button" aria-label="Add listing" onClick={onAdd}>
            <Plus size={18} />
          </button>
        </div>
      </div>

      {status === 'loading' && <p className="listings-message">Loading properties...</p>}
      {status === 'error' && (
        <p className="listings-message">Start the Django server, then refresh this page.</p>
      )}
      {status === 'ready' && properties.length === 0 && (
        <p className="listings-message">No properties yet. Add one in Django admin.</p>
      )}

      <div className="listings-grid">
        {properties.map((property) => (
          <article className="listing-card" key={property.id}>
            <div className="listing-photo">
              {property.photoUrl ? (
                <img alt={property.name} src={property.photoUrl} />
              ) : (
                <div className="photo-placeholder">
                  <Building2 size={34} />
                </div>
              )}
              <span className="listed-badge">
                <i />
                Listed
              </span>
            </div>
            <div className="listing-info">
              <strong>{property.name}</strong>
              <span>{property.bedrooms} bedrooms</span>
              <span>{formatNightlyPrice(property.basePriceEur)} per night</span>
              <small>{property.address || 'Home in Prishtina, Kosovo'}</small>
              <button className="listing-edit-button" type="button" onClick={() => onEdit(property)}>
                Edit
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
