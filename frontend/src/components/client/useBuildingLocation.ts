import { useEffect, useState } from 'react'
import { apiGet } from '../../api/client'

// The one location every apartment shares.
//
// Apartments carry no coordinates of their own — publishing them would pin a
// guest's exact door before they book — so the public site shows the building
// they all sit in, configured once in the Admin panel. Both the map page and
// the apartment detail read it from here so they cannot drift apart.
export type BuildingLocation = {
  /** Building name, falling back to its address. Empty if neither is set. */
  label: string
  /** What to call the marker on a map. */
  name: string
  latitude: number | null
  longitude: number | null
}

const EMPTY: BuildingLocation = {
  label: '',
  name: 'Our building',
  latitude: null,
  longitude: null,
}

export function useBuildingLocation(): BuildingLocation {
  const [location, setLocation] = useState<BuildingLocation>(EMPTY)

  useEffect(() => {
    let ignore = false
    apiGet<{
      companyName?: string
      companyLatitude?: string
      companyLongitude?: string
      buildingName?: string
      buildingAddress?: string
    }>('/api/booking/settings/')
      .then((settings) => {
        if (ignore) return
        const latitude = Number(settings.companyLatitude)
        const longitude = Number(settings.companyLongitude)
        const pinned =
          Boolean(settings.companyLatitude) &&
          Boolean(settings.companyLongitude) &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude)
        setLocation({
          label: settings.buildingName || settings.buildingAddress || '',
          name: settings.companyName || 'Our building',
          latitude: pinned ? latitude : null,
          longitude: pinned ? longitude : null,
        })
      })
      .catch(() => {
        // A missing or unreachable setting just means no map; the detail
        // panel falls back to the text label.
      })
    return () => {
      ignore = true
    }
  }, [])

  return location
}
