import type { PropertyListing } from '../../types/domain'

export type CalendarSortBy = 'number' | 'name' | 'bedrooms'

export function sortCalendarProperties(
  properties: PropertyListing[],
  sortBy: CalendarSortBy,
): PropertyListing[] {
  return [...properties].sort((a, b) => {
    if (sortBy === 'number') {
      const diff = extractLeadingNumber(a.name) - extractLeadingNumber(b.name)
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    }
    if (sortBy === 'bedrooms') {
      return a.bedrooms - b.bedrooms || extractLeadingNumber(a.name) - extractLeadingNumber(b.name)
    }
    // name A-Z
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function extractLeadingNumber(name: string): number {
  const match = name.match(/\d+/)
  return match ? parseInt(match[0], 10) : 9999
}

export function filterCalendarProperties(
  properties: PropertyListing[],
  search: string,
  bedrooms: string,
) {
  const bedroomMatch = (property: PropertyListing) =>
    bedrooms === 'any' || property.bedrooms === Number(bedrooms)
  const tokens = search
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)

  if (tokens.length === 0) {
    return properties.filter(bedroomMatch)
  }

  return properties.filter((property) => {
    if (!bedroomMatch(property)) {
      return false
    }

    const searchable = `${property.name} ${property.bedrooms} ${property.apartmentType}`.toLowerCase()
    return tokens.some((token) => {
      if (/^\d+$/.test(token)) {
        return exactNumericToken(property.name, token) || String(property.bedrooms) === token
      }

      return searchable.includes(token)
    })
  })
}

function exactNumericToken(value: string, token: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((part) => part === token)
}
