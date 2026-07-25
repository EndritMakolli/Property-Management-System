import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
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
  const price = Math.round(Number(property.basePriceEur) || 0)
  return L.divIcon({
    className: '',
    html: `<span class="map-price-pin${selected ? ' selected' : ''}">€${price}</span>`,
    iconSize: [0, 0],
    iconAnchor: [24, 14],
  })
}

function homeIcon(name: string) {
  return L.divIcon({
    className: '',
    html: `<span class="map-home-pin">🏢 ${name.replace(/</g, '&lt;')}</span>`,
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
