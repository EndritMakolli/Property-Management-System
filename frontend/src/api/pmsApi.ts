// Barrel for the PMS API. The implementation lives in per-domain modules so
// each file stays small; existing imports from './pmsApi' keep working.

export { formatApiError } from './client'
export * from './auth'
export * from './properties'
export * from './reservations'
export * from './codes'
export * from './finance'
export * from './maintenance'
export * from './receipts'
export * from './bookingEngine'
