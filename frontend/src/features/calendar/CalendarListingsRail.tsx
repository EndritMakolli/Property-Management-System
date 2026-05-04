import type { PropertyListing } from '../../types/domain'

type CalendarListingsRailProps = {
  properties: PropertyListing[]
  selectedPropertyId: string
  onSelect: (propertyId: string) => void
}

export function CalendarListingsRail({
  onSelect,
  properties,
  selectedPropertyId,
}: CalendarListingsRailProps) {
  return (
    <aside className="calendar-listings-rail">
      <h2>{properties.length} listings</h2>
      <div className="calendar-listing-search">Search listings...</div>
      <div className="calendar-listing-list">
        {properties.map((property) => (
          <button
            className={`calendar-listing-item${property.id === selectedPropertyId ? ' active' : ''}`}
            key={property.id}
            onClick={() => onSelect(property.id)}
          >
            {property.photoUrl ? (
              <img alt="" src={property.photoUrl} />
            ) : (
              <span className="calendar-listing-placeholder" />
            )}
            <span>
              <strong>{property.name}</strong>
              <small>{property.bedrooms}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
