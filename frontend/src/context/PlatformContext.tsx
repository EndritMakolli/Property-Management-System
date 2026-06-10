import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type PlatformId = 'airstay' | 'fleet'

export type PlatformConfig = {
  id: PlatformId
  brandName: string
  brandMark: string
  tagline: string
  unitSingular: string
  unitPlural: string
  propertiesLabel: string
  brandColor: string
}

export const PLATFORMS: Record<PlatformId, PlatformConfig> = {
  airstay: {
    id: 'airstay',
    brandName: 'AirStay',
    brandMark: 'A',
    tagline: 'Property operations',
    unitSingular: 'Apartment',
    unitPlural: 'Apartments',
    propertiesLabel: 'Properties',
    brandColor: '#e20606',
  },
  fleet: {
    id: 'fleet',
    brandName: 'Fleet',
    brandMark: 'F',
    tagline: 'Vehicle operations',
    unitSingular: 'Car',
    unitPlural: 'Cars',
    propertiesLabel: 'Fleet',
    brandColor: '#1a4d9b',
  },
}

type PlatformContextValue = {
  platform: PlatformConfig
  switchPlatform: (id: PlatformId) => void
}

const PlatformContext = createContext<PlatformContextValue | undefined>(undefined)

function readStoredPlatform(): PlatformId {
  const stored = localStorage.getItem('pms.platform')
  return stored === 'fleet' ? 'fleet' : 'airstay'
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platformId, setPlatformId] = useState<PlatformId>(readStoredPlatform)

  const value = useMemo<PlatformContextValue>(
    () => ({
      platform: PLATFORMS[platformId],
      switchPlatform(id) {
        localStorage.setItem('pms.platform', id)
        setPlatformId(id)
      },
    }),
    [platformId],
  )

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

export function usePlatform() {
  const ctx = useContext(PlatformContext)
  if (!ctx) throw new Error('usePlatform must be inside PlatformProvider')
  return ctx
}
