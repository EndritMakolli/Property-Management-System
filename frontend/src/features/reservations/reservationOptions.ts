import type { ReservationPlatform } from '../../types/domain'

export const reservationTypeOptions = [
  { label: 'Private', value: 'private' },
  { label: 'Airbnb', value: 'airbnb' },
  { label: 'Booking', value: 'booking' },
  { label: 'Maintenance', value: 'maintenance' },
] as const satisfies ReadonlyArray<{ label: string; value: ReservationPlatform }>
