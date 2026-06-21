import { activePlatform, apiGet } from './client'

export interface WorkloadDay {
  date: string
  weekday: string
  checkIns: number
  checkOuts: number
}

export interface MonthForecast {
  monthLabel: string
  daysInMonth: number
  daysRemaining: number
  onBooksNights: number
  onBooksTurnoverEur: number
  freeNightsRemaining: number
  usualOccupancyPct: number
  avgNightlyEur: number
  expectedPickupEur: number
  projectedTurnoverEur: number
}

export interface DashboardForecast {
  generatedAt: string
  platform: string
  propertyCount: number
  workload: { days: WorkloadDay[] }
  monthForecast: MonthForecast
}

export async function fetchDashboardForecast() {
  const params = new URLSearchParams({ platform: activePlatform() })
  return apiGet<DashboardForecast>(`/api/dashboard/forecast/?${params.toString()}`)
}
