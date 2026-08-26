// The arrival details, in the shape they get sent to a guest.
//
//   Apartment #2, third floor
//   Door Code 3147*
//   Wi-Fi Name: AirStay - 2
//   Wi-Fi Password: 12345677-2
//
// Two things this deliberately does not do:
//
//   It does not add the trailing star to the door code. Every code on file is
//   stored with it because the keypad needs it, so appending one would send a
//   guest "3147**".
//
//   It does not print a placeholder for a field that is empty. Most apartments
//   have no wifi or floor recorded yet, and a line reading "Wi-Fi Password: —"
//   is worse than no line at all in a message someone actually receives.

import type { DoorCodeRecord } from '../../types/domain'

function clean(value: string | undefined): string {
  return (value ?? '').trim()
}

export function buildDoorCopyText(code: DoorCodeRecord): string {
  const name = clean(code.apartmentNumber)
  const floor = clean(code.floor)
  const doorCode = clean(code.newCode)
  const wifiName = clean(code.wifiName)
  const wifiPassword = clean(code.wifiPassword)

  const lines: string[] = []

  const heading = [name, floor].filter(Boolean).join(', ')
  if (heading) lines.push(heading)
  if (doorCode) lines.push(`Door Code ${doorCode}`)
  if (wifiName) lines.push(`Wi-Fi Name: ${wifiName}`)
  if (wifiPassword) lines.push(`Wi-Fi Password: ${wifiPassword}`)

  return lines.join('\n')
}
