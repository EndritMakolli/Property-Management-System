import { apiDelete, apiGet, apiSend } from './client'

export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'parental' | 'other'

export type StaffMemberRecord = {
  id: string
  name: string
  role: string
  /** Days of annual leave a year. 21 unless somebody says otherwise. */
  annualLeaveDays: number
  active: boolean
  notes: string
}

export type StaffLeaveRecord = {
  id: string
  staffMemberId: string
  staffName: string
  leaveType: LeaveType
  leaveTypeLabel: string
  startDate: string
  /** Inclusive: Monday to Friday off is five days, not four. */
  endDate: string
  days: number
  note: string
  recordedBy: string
}

/** One person's year. Only annual leave spends the allowance — sick days are
 *  not holiday, and are reported beside it rather than inside it. */
export type StaffYearSummary = {
  id: string
  name: string
  role: string
  annualAllowance: number
  annualTaken: number
  /** Can go negative: somebody who has taken 25 of 21 has. */
  annualRemaining: number
  sickDays: number
  unpaidDays: number
  otherDays: number
}

export type StaffLeaveYear = {
  year: number
  staff: StaffYearSummary[]
  leave: StaffLeaveRecord[]
}

export async function fetchStaffLeave(year: number) {
  return apiGet<StaffLeaveYear>(`/api/staff-leave/?year=${year}`)
}

export async function fetchStaffMembers(inactive = false) {
  const data = await apiGet<{ staff: StaffMemberRecord[] }>(
    `/api/staff-members/${inactive ? '?inactive=1' : ''}`,
  )
  return data.staff
}

export async function createStaffMember(payload: {
  name: string
  role?: string
  annualLeaveDays?: number
}) {
  const data = await apiSend<{ member: StaffMemberRecord }>('/api/staff-members/', 'POST', payload)
  return data.member
}

export async function updateStaffMember(
  id: string,
  payload: { name?: string; role?: string; annualLeaveDays?: number; active?: boolean },
) {
  const data = await apiSend<{ member: StaffMemberRecord }>(
    `/api/staff-members/${id}/`,
    'PATCH',
    payload,
  )
  return data.member
}

export async function deleteStaffMember(id: string) {
  await apiDelete(`/api/staff-members/${id}/`, 'Could not remove this person.')
}

export async function recordStaffLeave(payload: {
  staffMemberId: string
  leaveType: LeaveType
  startDate: string
  endDate: string
  note?: string
}) {
  const data = await apiSend<{ leave: StaffLeaveRecord }>('/api/staff-leave/', 'POST', payload)
  return data.leave
}

export async function deleteStaffLeave(id: string) {
  await apiDelete(`/api/staff-leave/${id}/`, 'Could not remove this leave.')
}
