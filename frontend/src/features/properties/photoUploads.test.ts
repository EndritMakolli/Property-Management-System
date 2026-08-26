import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_PHOTO_EXTENSIONS,
  PHOTO_ACCEPT_ATTR,
  rejectionFor,
  uploadFailureMessage,
} from './photoUploads'

function file(name: string, size = 1024): File {
  return { name, size } as File
}

// The picker used to say accept="image/*", which is every image format there
// is — so the dialog happily offered .heic and .avif files the server then
// refused one by one, with no reason shown. These two must agree.
describe('the accepted formats', () => {
  it('matches the server allow-list', () => {
    expect([...ACCEPTED_PHOTO_EXTENSIONS].sort()).toEqual(
      ['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'].sort(),
    )
  })

  it('is expressed as an accept attribute the file dialog understands', () => {
    expect(PHOTO_ACCEPT_ATTR).toContain('.avif')
    expect(PHOTO_ACCEPT_ATTR).not.toContain('image/*')
  })
})

describe('rejectionFor', () => {
  it('accepts an ordinary photo', () => {
    expect(rejectionFor(file('room.jpg'))).toBe('')
  })

  it('accepts AVIF, which the whole gallery is already made of', () => {
    expect(rejectionFor(file('room.avif'))).toBe('')
  })

  it('ignores the case of the extension', () => {
    expect(rejectionFor(file('ROOM.JPG'))).toBe('')
  })

  it('names the formats that would work when one does not', () => {
    const reason = rejectionFor(file('room.heic'))
    expect(reason).toContain('AVIF')
    expect(reason).not.toBe('')
  })

  it('refuses a script disguised as a picture', () => {
    expect(rejectionFor(file('payload.svg'))).not.toBe('')
  })

  it('refuses a file with no extension at all', () => {
    expect(rejectionFor(file('screenshot'))).not.toBe('')
  })

  it('says so when the photo is too large', () => {
    const reason = rejectionFor(file('huge.jpg', 11 * 1024 * 1024))
    expect(reason).toContain('10 MB')
  })

  it('allows a photo just under the limit', () => {
    expect(rejectionFor(file('big.jpg', 10 * 1024 * 1024))).toBe('')
  })
})

describe('uploadFailureMessage', () => {
  it('says nothing when nothing failed', () => {
    expect(uploadFailureMessage([])).toBe('')
  })

  it('names the file and the reason for a single failure', () => {
    const message = uploadFailureMessage([{ name: 'room.heic', reason: 'Unsupported format.' }])
    expect(message).toContain('room.heic')
    expect(message).toContain('Unsupported format.')
  })

  it('states the reason once when every file failed the same way', () => {
    const rejections = Array.from({ length: 12 }, (_, i) => ({
      name: `room${i}.heic`,
      reason: 'Unsupported format.',
    }))
    const message = uploadFailureMessage(rejections)
    expect(message).toContain('12 photos')
    // The reason is the point — it must appear, and only once.
    expect(message.match(/Unsupported format\./g)).toHaveLength(1)
  })

  it('lists a few names and counts the rest, rather than printing twelve', () => {
    const rejections = Array.from({ length: 12 }, (_, i) => ({
      name: `room${i}.heic`,
      reason: 'Unsupported format.',
    }))
    const message = uploadFailureMessage(rejections)
    expect(message).toContain('room0.heic')
    expect(message).toContain('9 more')
    expect(message).not.toContain('room11.heic')
  })

  it('keeps the reasons apart when files failed differently', () => {
    const message = uploadFailureMessage([
      { name: 'a.heic', reason: 'Unsupported format.' },
      { name: 'b.jpg', reason: 'Larger than 10 MB.' },
    ])
    expect(message).toContain('Unsupported format.')
    expect(message).toContain('Larger than 10 MB.')
  })

  it('never renders undefined or NaN', () => {
    const message = uploadFailureMessage([{ name: '', reason: '' }])
    expect(message).not.toMatch(/undefined|NaN/)
  })
})
