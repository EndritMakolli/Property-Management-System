import { apiForm, apiGet, apiSend } from './client'

export type CompanyProfileRecord = {
  name: string
  address: string
  city: string
  country: string
  taxId: string
  vatId: string
  email: string
  phone: string
  website: string
  logoUrl: string
  bankName: string
  iban: string
  swift: string
  bankName2: string
  iban2: string
  swift2: string
  latitude: string
  longitude: string
  defaultTaxRate: string
}

export type CompanyProfilePayload = Partial<Omit<CompanyProfileRecord, 'logoUrl'>>

export async function fetchCompanyProfile() {
  const data = await apiGet<{ company: CompanyProfileRecord }>('/api/company-profile/')
  return data.company
}

export async function updateCompanyProfile(payload: CompanyProfilePayload) {
  const data = await apiSend<{ company: CompanyProfileRecord }>('/api/company-profile/', 'PATCH', payload)
  return data.company
}

// Multipart save: text fields plus a logo upload or removal.
export async function saveCompanyProfileWithLogo(
  payload: CompanyProfilePayload,
  logo: File | null,
  removeLogo = false,
) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) formData.append(key, String(value))
  }
  if (logo) formData.append('logo', logo)
  if (removeLogo) formData.append('removeLogo', '1')
  const data = await apiForm<{ company: CompanyProfileRecord }>('/api/company-profile/', 'POST', formData)
  return data.company
}
