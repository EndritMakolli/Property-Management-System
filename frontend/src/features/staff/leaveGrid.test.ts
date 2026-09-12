import { describe, expect, it } from 'vitest'
import { buildLeaveGrid, monthDays } from './leaveGrid'
import type { StaffLeaveRecord } from '../../api/staffLeave'

const leave = (over: Partial<StaffLeaveRecord> = {}): StaffLeaveRecord =>
  ({
    id: 'l1',
    staffMemberId: 's1',
    staffName: 'Arben',
    leaveType: 'annual',
    leaveTypeLabel: 'Annual leave',
    startDate: '2026-08-03',
    endDate: '2026-08-07',
    days: 5,
    note: '',
    recordedBy: '',
    ...over,
  }) as StaffLeaveRecord

describe('monthDays', () => {
  it('gives every day of a 31-day month', () => {
    expect(monthDays(2026, 8)).toHaveLength(31)
  })

  it('gives 28 for a common February and 29 for a leap one', () => {
    expect(monthDays(2026, 2)).toHaveLength(28)
    expect(monthDays(2028, 2)).toHaveLength(29)
  })

  it('numbers the days from one', () => {
    const days = monthDays(2026, 8)
    expect(days[0].day).toBe(1)
    expect(days[30].day).toBe(31)
  })

  it('keys each day by its ISO date', () => {
    expect(monthDays(2026, 8)[0].key).toBe('2026-08-01')
  })

  it('pads a single-digit day and month', () => {
    expect(monthDays(2026, 1)[4].key).toBe('2026-01-05')
  })

  it('marks weekends, so the grid reads like a calendar', () => {
    // 1 August 2026 is a Saturday.
    const days = monthDays(2026, 8)
    expect(days[0].isWeekend).toBe(true)
    expect(days[1].isWeekend).toBe(true)
    expect(days[2].isWeekend).toBe(false)
  })
})

describe('buildLeaveGrid', () => {
  it('marks every day of a period, both ends included', () => {
    const grid = buildLeaveGrid([leave()], 2026, 8)
    expect(grid.s1['2026-08-03']).toBeTruthy()
    expect(grid.s1['2026-08-07']).toBeTruthy()
    expect(grid.s1['2026-08-08']).toBeUndefined()
    expect(grid.s1['2026-08-02']).toBeUndefined()
  })

  it('reports the kind of leave on each day, so the cell can be coloured', () => {
    const grid = buildLeaveGrid([leave({ leaveType: 'sick' })], 2026, 8)
    expect(grid.s1['2026-08-03'].leaveType).toBe('sick')
  })

  it('clips a period to the month being shown', () => {
    // A fortnight from late July into August, viewed in August.
    const grid = buildLeaveGrid([leave({ startDate: '2026-07-28', endDate: '2026-08-04' })], 2026, 8)
    expect(grid.s1['2026-08-01']).toBeTruthy()
    expect(grid.s1['2026-08-04']).toBeTruthy()
    expect(grid.s1['2026-08-05']).toBeUndefined()
  })

  it('shows a period that runs over new year in both months', () => {
    const period = leave({ startDate: '2026-12-30', endDate: '2027-01-02' })
    expect(buildLeaveGrid([period], 2026, 12).s1['2026-12-31']).toBeTruthy()
    expect(buildLeaveGrid([period], 2027, 1).s1['2027-01-01']).toBeTruthy()
  })

  it('keeps each person to their own row', () => {
    const grid = buildLeaveGrid(
      [leave(), leave({ id: 'l2', staffMemberId: 's2', startDate: '2026-08-20', endDate: '2026-08-21' })],
      2026,
      8,
    )
    expect(grid.s1['2026-08-03']).toBeTruthy()
    expect(grid.s2?.['2026-08-03']).toBeUndefined()
    expect(grid.s2['2026-08-20']).toBeTruthy()
  })

  it('holds two periods for the same person in one row', () => {
    const grid = buildLeaveGrid(
      [leave(), leave({ id: 'l2', startDate: '2026-08-20', endDate: '2026-08-21', leaveType: 'sick' })],
      2026,
      8,
    )
    expect(grid.s1['2026-08-03'].leaveType).toBe('annual')
    expect(grid.s1['2026-08-20'].leaveType).toBe('sick')
  })

  it('carries the period id, so a cell can be clicked to remove it', () => {
    expect(buildLeaveGrid([leave()], 2026, 8).s1['2026-08-03'].id).toBe('l1')
  })

  it('ignores a period from a different month entirely', () => {
    expect(buildLeaveGrid([leave()], 2026, 9)).toEqual({})
  })

  it('is empty when nobody was off', () => {
    expect(buildLeaveGrid([], 2026, 8)).toEqual({})
  })
})
