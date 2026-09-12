// One month of the leave register, as a grid: a row per person, a cell per day.
//
// The same shape as the availability grid on the calendar page — apartments
// down the side, days across the top — because it is read the same way, at a
// glance, looking for who is missing on a given day.
//
// Pure, so the arithmetic can be checked without a calendar: clipping a period
// to the month on show is exactly the kind of thing that is off by one day and
// never noticed.

import type { LeaveType, StaffLeaveRecord } from '../../api/staffLeave'

export type GridDay = {
  day: number
  /** ISO date, and the key every lookup uses. */
  key: string
  isWeekend: boolean
}

export type GridCell = {
  id: string
  leaveType: LeaveType
  leaveTypeLabel: string
}

/** staffMemberId -> ISO date -> what they were doing that day. */
export type LeaveGrid = Record<string, Record<string, GridCell>>

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Every day of one month. `month` is 1-12, as a person would say it. */
export function monthDays(year: number, month: number): GridDay[] {
  // Day 0 of the next month is the last day of this one, which avoids a table
  // of month lengths and gets February right in a leap year for free.
  const length = new Date(year, month, 0).getDate()
  return Array.from({ length }, (_, index) => {
    const day = index + 1
    const weekday = new Date(year, month - 1, day).getDay()
    return { day, key: iso(year, month, day), isWeekend: weekday === 0 || weekday === 6 }
  })
}

/**
 * Fill the grid for one month.
 *
 * Periods are clipped to the month on show rather than skipped: a fortnight
 * starting in July and ending in August is half of each, and appears in both.
 */
export function buildLeaveGrid(
  periods: StaffLeaveRecord[],
  year: number,
  month: number,
): LeaveGrid {
  const first = iso(year, month, 1)
  const days = monthDays(year, month)
  const last = days[days.length - 1].key
  const grid: LeaveGrid = {}

  for (const period of periods) {
    // ISO dates compare correctly as strings, which is why there is no parsing.
    if (period.endDate < first || period.startDate > last) continue

    const row = (grid[period.staffMemberId] ??= {})
    for (const { key } of days) {
      if (key >= period.startDate && key <= period.endDate) {
        row[key] = {
          id: period.id,
          leaveType: period.leaveType,
          leaveTypeLabel: period.leaveTypeLabel,
        }
      }
    }
  }

  return grid
}
