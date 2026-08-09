import { Circle, MapContainer, Marker, TileLayer } from 'react-leaflet'
import { OSM_ATTRIBUTION, OSM_TILE_URL } from '../../shared/leafletSetup'

type MiniMapProps = {
  latitude: number
  longitude: number
  radiusM: number
  label?: string
}

// Airbnb-style approximate location for the "Where you'll be" section: a
// light-blue shaded radius instead of an exact pin. The coordinates are
// already privacy-shifted by the backend; no exact point is ever drawn.
// radiusM comes from the server — 0 means privacy is off and the coordinates
// are exact, so a circle would falsely imply the location is approximate.
export default function MiniMap({ latitude, longitude, radiusM }: MiniMapProps) {
  const approximate = radiusM > 0
  return (
    <div style={{ height: 280, borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={approximate ? 14 : 16}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        {approximate ? (
          <Circle
            center={[latitude, longitude]}
            pathOptions={{ color: '#7db8e8', fillColor: '#8ec5f2', fillOpacity: 0.28, weight: 2 }}
            radius={radiusM}
          />
        ) : (
          <Marker position={[latitude, longitude]} />
        )}
      </MapContainer>
      {approximate && (
        <span
          style={{
            position: 'absolute',
            bottom: 10,
            left: 10,
            zIndex: 1000,
            background: 'rgba(255,255,255,0.92)',
            borderRadius: 999,
            padding: '5px 12px',
            fontSize: '0.78rem',
            color: '#4a4438',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          Exact location shared after booking
        </span>
      )}
    </div>
  )
}
