import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet'
import { DEFAULT_CENTER, OSM_ATTRIBUTION, OSM_TILE_URL } from './leafletSetup'

type MapPickerProps = {
  latitude: string
  longitude: string
  onChange: (latitude: string, longitude: string) => void
  height?: number
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

// Click-to-set location picker. Lazy-load this component (React.lazy) so
// leaflet never lands in the core PMS bundle.
export default function MapPicker({ latitude, longitude, onChange, height = 260 }: MapPickerProps) {
  const lat = Number(latitude)
  const lng = Number(longitude)
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && latitude !== '' && longitude !== ''
  const center: [number, number] = hasPin ? [lat, lng] : DEFAULT_CENTER

  return (
    <div style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <MapContainer center={center} zoom={hasPin ? 15 : 12} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        <ClickHandler onPick={(pickedLat, pickedLng) => onChange(pickedLat.toFixed(6), pickedLng.toFixed(6))} />
        {hasPin && <Marker position={[lat, lng]} />}
      </MapContainer>
    </div>
  )
}
