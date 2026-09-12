import { describe, expect, it } from 'vitest'
import { applyDayClick, forbiddenByMode, type StayEdit } from './stayRangeEdit'

/** No night is taken. */
const clear = () => false
/** Every night is taken. */
const taken = () => true

const stay = (checkIn: string, checkOut: string): StayEdit => ({ checkIn, checkOut })

describe('applyDayClick — range mode (the original one-gesture behaviour)', () => {
  it('starts a new range on the first click', () => {
    expect(applyDayClick(stay('', ''), '2026-06-10', 'range', clear)).toEqual({
      checkIn: '2026-06-10',
      checkOut: '',
      complete: false,
    })
  })

  it('closes the range on the second click', () => {
    expect(applyDayClick(stay('2026-06-10', ''), '2026-06-14', 'range', clear)).toEqual({
      checkIn: '2026-06-10',
      checkOut: '2026-06-14',
      complete: true,
    })
  })

  it('restarts when a complete range is clicked again', () => {
    expect(applyDayClick(stay('2026-06-10', '2026-06-14'), '2026-06-20', 'range', clear)).toEqual({
      checkIn: '2026-06-20',
      checkOut: '',
      complete: false,
    })
  })

  it('restarts rather than inverting when the click lands before check-in', () => {
    expect(applyDayClick(stay('2026-06-10', ''), '2026-06-04', 'range', clear)).toEqual({
      checkIn: '2026-06-04',
      checkOut: '',
      complete: false,
    })
  })

  it('restarts when the range would span a booked night', () => {
    expect(applyDayClick(stay('2026-06-10', ''), '2026-06-14', 'range', taken)).toEqual({
      checkIn: '2026-06-14',
      checkOut: '',
      complete: false,
    })
  })
})

describe('applyDayClick — check-in on its own', () => {
  it('moves check-in and keeps a check-out that is still after it', () => {
    expect(applyDayClick(stay('2026-06-10', '2026-06-14'), '2026-06-11', 'checkIn', clear)).toEqual({
      checkIn: '2026-06-11',
      checkOut: '2026-06-14',
      complete: true,
    })
  })

  it('drops a check-out the new check-in has overtaken', () => {
    expect(applyDayClick(stay('2026-06-10', '2026-06-14'), '2026-06-20', 'checkIn', clear)).toEqual({
      checkIn: '2026-06-20',
      checkOut: '',
      complete: false,
    })
  })

  it('drops a check-out the move would book through someone else', () => {
    expect(applyDayClick(stay('2026-06-10', '2026-06-14'), '2026-06-08', 'checkIn', taken)).toEqual({
      checkIn: '2026-06-08',
      checkOut: '',
      complete: false,
    })
  })

  it('sets check-in on an empty stay without inventing a check-out', () => {
    expect(applyDayClick(stay('', ''), '2026-06-10', 'checkIn', clear)).toEqual({
      checkIn: '2026-06-10',
      checkOut: '',
      complete: false,
    })
  })
})

describe('applyDayClick — check-out on its own', () => {
  it('moves check-out and leaves check-in alone', () => {
    expect(applyDayClick(stay('2026-06-10', '2026-06-14'), '2026-06-18', 'checkOut', clear)).toEqual({
      checkIn: '2026-06-10',
      checkOut: '2026-06-18',
      complete: true,
    })
  })

  it('treats a click as check-in when no check-in has been chosen yet', () => {
    // Editing the far end of a stay that has no near end: there is nothing to
    // measure against, so the click has to mean the start.
    expect(applyDayClick(stay('', ''), '2026-06-10', 'checkOut', clear)).toEqual({
      checkIn: '2026-06-10',
      checkOut: '',
      complete: false,
    })
  })
})

describe('forbiddenByMode — what the calendar refuses to accept', () => {
  it('forbids nothing extra while picking a whole range', () => {
    expect(forbiddenByMode('2026-06-01', 'range', stay('2026-06-10', ''), clear)).toBe(false)
  })

  it('forbids nothing extra while picking a check-in', () => {
    expect(forbiddenByMode('2026-06-01', 'checkIn', stay('2026-06-10', ''), clear)).toBe(false)
  })

  it('forbids a check-out on or before the check-in', () => {
    const current = stay('2026-06-10', '2026-06-14')
    expect(forbiddenByMode('2026-06-10', 'checkOut', current, clear)).toBe(true)
    expect(forbiddenByMode('2026-06-09', 'checkOut', current, clear)).toBe(true)
    expect(forbiddenByMode('2026-06-11', 'checkOut', current, clear)).toBe(false)
  })

  it('forbids a check-out that would book straight through a taken night', () => {
    expect(forbiddenByMode('2026-06-20', 'checkOut', stay('2026-06-10', ''), taken)).toBe(true)
  })

  it('forbids nothing while picking a check-out with no check-in set', () => {
    expect(forbiddenByMode('2026-06-01', 'checkOut', stay('', ''), clear)).toBe(false)
  })
})
