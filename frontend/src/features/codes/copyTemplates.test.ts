import { describe, expect, it } from 'vitest'
import type { DoorCodeRecord } from '../../types/domain'
import { buildDoorCopyText } from './copyTemplates'

function doorCode(overrides: Partial<DoorCodeRecord> = {}): DoorCodeRecord {
  return {
    id: 'd1',
    propertyId: 'p1',
    apartmentNumber: 'Apartment #2',
    floor: 'third floor',
    wifiName: 'AirStay - 2',
    wifiPassword: '12345677-2',
    oldCode: '',
    newCode: '3147*',
    dateChanged: '',
    changedBy: '',
    notes: '',
    lastCheckout: '',
    needsChange: false,
    ...overrides,
  }
}

describe('buildDoorCopyText', () => {
  it('produces the template exactly', () => {
    expect(buildDoorCopyText(doorCode())).toBe(
      'Apartment #2, third floor\n' +
        'Door Code 3147*\n' +
        'Wi-Fi Name: AirStay - 2\n' +
        'Wi-Fi Password: 12345677-2',
    )
  })

  it('does not add a second star to a code that already has one', () => {
    // Every door code on file is stored with its trailing star - the keypad
    // needs it - so the template prints the code as entered rather than
    // decorating it. "3147**" would be wrong at the door.
    expect(buildDoorCopyText(doorCode())).toContain('Door Code 3147*')
    expect(buildDoorCopyText(doorCode())).not.toContain('3147**')
  })

  it('prints a starless code exactly as it was entered', () => {
    expect(buildDoorCopyText(doorCode({ newCode: '3147' }))).toContain('Door Code 3147')
  })
})

describe('buildDoorCopyText - when fields are missing', () => {
  // Most apartments have no floor, wifi or code recorded yet. This text gets
  // pasted straight to a guest, so a blank field has to disappear rather than
  // arrive as "Wi-Fi Password: —".

  it('leaves the floor off the first line when there is none', () => {
    expect(buildDoorCopyText(doorCode({ floor: '' })).split('\n')[0]).toBe('Apartment #2')
  })

  it('drops the door code line when there is no code', () => {
    expect(buildDoorCopyText(doorCode({ newCode: '' }))).not.toContain('Door Code')
  })

  it('drops the wifi name line when there is no network', () => {
    expect(buildDoorCopyText(doorCode({ wifiName: '' }))).not.toContain('Wi-Fi Name')
  })

  it('drops the password line but keeps the network name', () => {
    const text = buildDoorCopyText(doorCode({ wifiPassword: '' }))
    expect(text).toContain('Wi-Fi Name: AirStay - 2')
    expect(text).not.toContain('Wi-Fi Password')
  })

  it('never emits an em dash placeholder', () => {
    const bare = buildDoorCopyText(
      doorCode({ floor: '', newCode: '', wifiName: '', wifiPassword: '' }),
    )
    expect(bare).not.toContain('—')
  })

  it('falls back to just the apartment name when nothing else is known', () => {
    expect(
      buildDoorCopyText(doorCode({ floor: '', newCode: '', wifiName: '', wifiPassword: '' })),
    ).toBe('Apartment #2')
  })

  it('never leaves a trailing comma or a blank line', () => {
    const text = buildDoorCopyText(doorCode({ floor: '', wifiName: '' }))
    expect(text).not.toMatch(/,\s*$/m)
    expect(text).not.toMatch(/\n\n/)
    expect(text.endsWith('\n')).toBe(false)
  })

  it('tolerates whitespace around stored values', () => {
    expect(
      buildDoorCopyText(doorCode({ floor: '  third floor  ', newCode: ' 3147* ' })),
    ).toBe(
      'Apartment #2, third floor\n' +
        'Door Code 3147*\n' +
        'Wi-Fi Name: AirStay - 2\n' +
        'Wi-Fi Password: 12345677-2',
    )
  })

  it('says something useful even with no apartment name', () => {
    const text = buildDoorCopyText(doorCode({ apartmentNumber: '', floor: '' }))
    expect(text).not.toMatch(/^,/)
    expect(text).toContain('Door Code 3147*')
  })
})
