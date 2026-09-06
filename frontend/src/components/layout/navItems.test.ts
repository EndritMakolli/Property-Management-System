import { describe, expect, it } from 'vitest'
import { navItemsForRole } from './navItems'

// The Codes entry is the interesting one: it is the same route on both
// platforms but a different page behind it — door codes and wifi for an
// apartment, service and registration for a vehicle. It was gated to AirStay,
// which left the Fleet page built and unreachable.

function labels(role: Parameters<typeof navItemsForRole>[0], platform?: 'airstay' | 'fleet') {
  return navItemsForRole(role, platform).map((item) => item.label)
}

describe('navItemsForRole', () => {
  it('gives a role-less session nothing', () => {
    expect(navItemsForRole('', 'airstay')).toEqual([])
  })

  it('shows Codes on AirStay', () => {
    expect(labels('admin', 'airstay')).toContain('Codes')
  })

  it('shows the same entry on Fleet, named for what it holds there', () => {
    const fleet = labels('admin', 'fleet')
    expect(fleet).toContain('Service')
    expect(fleet).not.toContain('Codes')
  })

  it('keeps the entry on one route, whichever platform is active', () => {
    const onAirstay = navItemsForRole('admin', 'airstay').find((i) => i.label === 'Codes')
    const onFleet = navItemsForRole('admin', 'fleet').find((i) => i.label === 'Service')
    expect(onAirstay?.path).toBe('/codes')
    expect(onFleet?.path).toBe('/codes')
  })

  it('lets cleaning reach it on both platforms', () => {
    expect(labels('cleaning', 'airstay')).toContain('Codes')
    expect(labels('cleaning', 'fleet')).toContain('Service')
  })

  it('still keeps cleaning out of Finance', () => {
    expect(labels('cleaning', 'airstay')).not.toContain('Finance')
  })

  it('still keeps management out of Reports', () => {
    expect(labels('management', 'airstay')).not.toContain('Reports')
  })

  it('returns every item when no platform is given', () => {
    expect(labels('admin').length).toBeGreaterThanOrEqual(labels('admin', 'airstay').length)
  })

  it('never returns two entries for the same path', () => {
    const paths = navItemsForRole('admin', 'fleet').map((item) => item.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
