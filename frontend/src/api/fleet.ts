import { apiGet, apiSend } from './client'

export type VehicleAlert = {
  kind: string
  severity: 'overdue' | 'soon' | 'info'
  message: string
}

export type VehicleServiceRecord = {
  id: string
  name: string
  photoUrl: string
  /** Identity, for the hire agreement: it must name this car, not a model. */
  brand: string
  model: string
  chassisNumber: string
  licencePlate: string
  allowedCountries: string
  lastServiceDate: string
  lastServiceKm: number | null
  currentKm: number | null
  serviceIntervalKm: number | null
  serviceIntervalMonths: number | null
  /** How much notice to give. 0 means only tell me once it is overdue. */
  serviceWarningDays: number | null
  serviceWarningKm: number | null
  registrationWarningDays: number | null
  registrationDate: string
  registrationExpiry: string
  alerts: VehicleAlert[]
}

export type VehicleServicePayload = Partial<{
  brand: string
  model: string
  chassisNumber: string
  licencePlate: string
  allowedCountries: string
  lastServiceDate: string
  lastServiceKm: number | null
  currentKm: number | null
  serviceIntervalKm: number | null
  serviceIntervalMonths: number | null
  serviceWarningDays: number | null
  serviceWarningKm: number | null
  registrationWarningDays: number | null
  registrationDate: string
  registrationExpiry: string
}>

export async function fetchVehicleService() {
  const data = await apiGet<{ vehicles: VehicleServiceRecord[] }>('/api/fleet/service/')
  return data.vehicles
}

export async function updateVehicleService(id: string, payload: VehicleServicePayload) {
  const data = await apiSend<{ vehicle: VehicleServiceRecord }>(
    `/api/fleet/service/${id}/`,
    'PATCH',
    payload,
  )
  return data.vehicle
}
