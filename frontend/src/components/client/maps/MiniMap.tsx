import { Circle, MapContainer, TileLayer } from 'react-leaflet'
import { OSM_ATTRIBUTION, OSM_TILE_URL } from '../../shared/leafletSetup'

type MiniMapProps = {
  latitude: number
  longitude: number
  label?: string
}

// Airbnb-style approximate location for the "Where you'll be" section: a
// shaded radius instead of an exact pin, shown before a booking is made.
export default function MiniMap({ latitude, longitude }: MiniMapProps) {
  return (
    <div style={{ height: 280, borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        <Circle
          center={[latitude, longitude]}
          pathOptions={{ color: '#b99756', fillColor: '#b99756', fillOpacity: 0.25, weight: 2 }}
          radius={350}
        />
        <Circle
          center={[latitude, longitude]}
          pathOptions={{ color: '#ffffff', fillColor: '#b99756', fillOpacity: 1, weight: 2 }}
          radius={18}
        />
      </MapContainer>
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
    </div>
  )
}
