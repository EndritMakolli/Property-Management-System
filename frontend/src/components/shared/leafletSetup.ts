// Shared Leaflet bootstrap: CSS + the Vite marker-asset fix. Import this ONLY
// from lazily-loaded map components so leaflet stays in its own chunk.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import marker2x from 'leaflet/dist/images/marker-icon-2x.png'
import marker from 'leaflet/dist/images/marker-icon.png'
import shadow from 'leaflet/dist/images/marker-shadow.png'

L.Icon.Default.mergeOptions({
  iconUrl: marker,
  iconRetinaUrl: marker2x,
  shadowUrl: shadow,
})

export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Prishtina — sensible default center when nothing is pinned yet.
export const DEFAULT_CENTER: [number, number] = [42.6629, 21.1655]

export default L
