// Static placeholder data for the public site. Real API wiring comes later.

export interface ClientProperty {
  id: string
  name: string
  bedrooms: number
  maxGuests: number
  pricePerNight: number
  discountPct?: number
  emoji: string
}

export const PLACEHOLDER_PROPERTIES: ClientProperty[] = [
  { id: '1', name: 'Sunlit Studio #12', bedrooms: 1, maxGuests: 2, pricePerNight: 45, discountPct: 15, emoji: '🏙️' },
  { id: '2', name: 'Cozy Loft #15', bedrooms: 1, maxGuests: 3, pricePerNight: 55, emoji: '🛋️' },
  { id: '3', name: 'Modern Apartment #18', bedrooms: 2, maxGuests: 4, pricePerNight: 70, discountPct: 10, emoji: '🏢' },
  { id: '4', name: 'Premium Suite #21', bedrooms: 2, maxGuests: 4, pricePerNight: 85, emoji: '✨' },
  { id: '5', name: 'Garden View #24', bedrooms: 1, maxGuests: 2, pricePerNight: 50, emoji: '🪴' },
  { id: '6', name: 'City Center #27', bedrooms: 3, maxGuests: 6, pricePerNight: 110, discountPct: 20, emoji: '🌆' },
]
