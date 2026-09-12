import { apiDelete, apiGet, apiSend } from './client'

export type ContractKind = 'apartment' | 'vehicle'

export type ContractTemplateRecord = {
  kind: ContractKind
  label: string
  bodySq: string
  bodyEn: string
  updatedAt: string
}

export type ContractParty = {
  name: string
  address?: string
  city?: string
  country?: string
  taxId?: string
  vatId?: string
  email?: string
  phone?: string
  logoUrl?: string
  idNumber?: string
  nationality?: string
}

export type ContractSubject = {
  isVehicle: boolean
  name: string
  detail: string
  /** Vehicle identity — a hire agreement must name this car, not a model. */
  brand: string
  model: string
  chassisNumber: string
  licencePlate: string
  allowedCountries: string
  address: string
  checkIn: string
  checkOut: string
  nights: number
  guests: number
  totalPriceEur: string
  nightlyPriceEur: string
}

/** A draft filled in for one reservation, ready to print.
 *
 *  The parties and the stay come back as data rather than as text inside the
 *  body: the document lays them out, so nobody retypes an address to change a
 *  clause. `body` holds the terms alone. */
export type RenderedContract = {
  kind: ContractKind
  language: 'sq' | 'en'
  body: string
  /** Placeholders the reservation could not fill — still visible in the body. */
  unresolved: string[]
  reference: string
  issuedOn: string
  company: ContractParty
  client: ContractParty
  subject: ContractSubject
  /** Whether somebody has edited this contract. A fresh render is not a draft;
   *  a draft is returned exactly as it was typed and never re-rendered over. */
  isDraft: boolean
  updatedAt: string
  updatedBy: string
  /** Written in by hand at the desk, and kept with the draft. */
  fields: { licenceNumber: string; deposit: string }
}

export type ContractDraftPayload = {
  body: string
  clientIdNumber?: string
  licenceNumber?: string
  deposit?: string
}

export async function fetchContractTemplates() {
  const data = await apiGet<{ templates: ContractTemplateRecord[] }>('/api/contract-templates/')
  return data.templates
}

export async function updateContractTemplate(
  kind: ContractKind,
  payload: { bodySq?: string; bodyEn?: string },
) {
  const data = await apiSend<{ template: ContractTemplateRecord }>(
    `/api/contract-templates/${kind}/`,
    'PATCH',
    payload,
  )
  return data.template
}

export async function fetchReservationContract(reservationId: string, language: 'sq' | 'en') {
  return apiGet<RenderedContract>(
    `/api/reservations/${reservationId}/contract/?language=${language}`,
  )
}

/** Save the contract as edited. Returns it as it will now be reopened. */
export async function saveReservationContract(
  reservationId: string,
  language: 'sq' | 'en',
  payload: ContractDraftPayload,
) {
  return apiSend<RenderedContract>(
    `/api/reservations/${reservationId}/contract/?language=${language}`,
    'PUT',
    payload,
  )
}

/** Throw the edit away and go back to the template. Nothing else is touched —
 *  the reservation and the guest are not the contract's to delete. */
export async function resetReservationContract(reservationId: string, language: 'sq' | 'en') {
  await apiDelete(
    `/api/reservations/${reservationId}/contract/?language=${language}`,
    'Could not reset the contract.',
  )
}
