import { useEffect, useMemo } from 'react'
import { Circle, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import type { PublicProperty } from '../../../api/bookingApi'
import L, { DEFAULT_CENTER, OSM_ATTRIBUTION, OSM_TILE_URL } from '../../shared/leafletSetup'

export type MapProperty = PublicProperty & { lat: number; lng: number }

export type HomeMarker = { lat: number; lng: number; name: string }

type PropertiesMapProps = {
  properties: MapProperty[]
  selectedId?: string | null
  onPinClick: (property: MapProperty) => void
  home?: HomeMarker | null
}

function priceIcon(property: MapProperty, selected: boolean) {
  // Prefer the rule-adjusted nightly rate for the guest's dates when present.
  const nightly = property.priceBreakdown?.effective_nightly
  const price = Math.round(Number(nightly ?? property.basePriceEur) || 0)
  return L.divIcon({
    className: '',
    html: `<span class="map-price-pin${selected ? ' selected' : ''}">€${price}</span>`,
    iconSize: [0, 0],
    iconAnchor: [24, 14],
  })
}

// Leaflet's divIcon takes raw HTML, so anything interpolated into it must be
// fully escaped — the company name is admin-supplied but renders for every
// public visitor, which is exactly the shape of a stored-XSS bug.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function homeIcon(name: string) {
  return L.divIcon({
    className: '',
    html: `<span class="map-home-pin">🏢 ${escapeHtml(name)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [40, 16],
  })
}

function FitToPins({ properties, home }: { properties: MapProperty[]; home?: HomeMarker | null }) {
  const map = useMap()
  useEffect(() => {
    const points = properties.map((p) => [p.lat, p.lng] as [number, number])
    if (home) points.push([home.lat, home.lng])
    if (points.length === 0) return
    const bounds = L.latLngBounds(points)
    map.fitBounds(bounds.pad(0.25), { maxZoom: 15 })
  }, [map, properties, home])
  return null
}

// The guest-facing map with €-price pins (+ the company building marker).
export default function PropertiesMap({ properties, selectedId, onPinClick, home }: PropertiesMapProps) {
  const center = useMemo<[number, number]>(() => {
    if (properties.length > 0) return [properties[0].lat, properties[0].lng]
    if (home) return [home.lat, home.lng]
    return DEFAULT_CENTER
  }, [properties, home])

  return (
    <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
      <FitToPins home={home} properties={properties} />
      {home && <Marker icon={homeIcon(home.name)} position={[home.lat, home.lng]} />}
      {/* Approximate-location circle (Airbnb style): the apartment is somewhere
          inside it. Coordinates are already privacy-shifted server-side, so no
          exact point is revealed — the price pin sits at the circle center.
          mapRadiusM of 0 means privacy is off and the coordinates are exact, so
          drawing a circle would falsely imply the location is approximate. */}
      {properties
        .filter((property) => property.mapRadiusM > 0)
        .map((property) => (
          <Circle
            key={`area-${property.id}`}
            center={[property.lat, property.lng]}
            pathOptions={{
              color: property.id === selectedId ? '#4a9be0' : '#7db8e8',
              fillColor: '#8ec5f2',
              fillOpacity: property.id === selectedId ? 0.35 : 0.22,
              weight: property.id === selectedId ? 2.5 : 1.5,
            }}
            radius={property.mapRadiusM}
            eventHandlers={{ click: () => onPinClick(property) }}
          />
        ))}
      {properties.map((property) => (
        <Marker
          key={property.id}
          position={[property.lat, property.lng]}
          icon={priceIcon(property, property.id === selectedId)}
          eventHandlers={{ click: () => onPinClick(property) }}
        />
      ))}
    </MapContainer>
  )
}
