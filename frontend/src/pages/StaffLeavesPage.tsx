// Staff leaves: a register the office keeps.
//
// Not a request-and-approve workflow. Staff are added by name — most of them
// have no login — each gets a yearly allowance, and whoever keeps the register
// writes down the days they were off. The one question it exists to answer is
// "how many days has this person left", so that is the first column.
//
// The grid is the availability grid's shape: a row per person, a day per
// column, one month at a time. It is read the same way — at a glance, looking
// for who is missing on a given day.

import { ChevronLeft, ChevronRight, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatApiError } from '../api/client'
import {
  createStaffMember,
  deleteStaffLeave,
  deleteStaffMember,
  fetchStaffLeave,
  recordStaffLeave,
  updateStaffMember,
  type LeaveType,
  type StaffLeaveYear,
} from '../api/staffLeave'
import { buildLeaveGrid, monthDays } from '../features/staff/leaveGrid'
import { formatDisplayDate, toDateInputValue } from '../utils/date'
import '../styles/staff-leaves.css'

const LEAVE_TYPES: { value: LeaveType; label: string; short: string }[] = [
  { value: 'annual', label: 'Annual leave', short: 'A' },
  { value: 'sick', label: 'Sick leave', short: 'S' },
  { value: 'unpaid', label: 'Unpaid leave', short: 'U' },
  { value: 'parental', label: 'Parental leave', short: 'P' },
  { value: 'other', label: 'Other', short: 'O' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function StaffLeavesPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<StaffLeaveYear | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [addingPerson, setAddingPerson] = useState(false)
  const [personName, setPersonName] = useState('')
  const [personRole, setPersonRole] = useState('')
  const [personAllowance, setPersonAllowance] = useState('21')

  const [addingLeave, setAddingLeave] = useState(false)
  const [leaveStaffId, setLeaveStaffId] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('annual')
  const [leaveStart, setLeaveStart] = useState(toDateInputValue(now))
  const [leaveEnd, setLeaveEnd] = useState(toDateInputValue(now))
  const [leaveNote, setLeaveNote] = useState('')

  const load = useCallback(async () => {
    try {
      setError('')
      setData(await fetchStaffLeave(year))
    } catch (caught) {
      setError(formatApiError(caught))
    }
  }, [year])

  useEffect(() => {
    load()
  }, [load])

  const days = useMemo(() => monthDays(year, month), [year, month])
  const grid = useMemo(() => buildLeaveGrid(data?.leave ?? [], year, month), [data, year, month])

  function stepMonth(by: number) {
    const next = month + by
    if (next < 1) {
      setMonth(12)
      setYear((y) => y - 1)
    } else if (next > 12) {
      setMonth(1)
      setYear((y) => y + 1)
    } else {
      setMonth(next)
    }
  }

  async function guard(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
    } catch (caught) {
      setError(formatApiError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function submitPerson(event: React.FormEvent) {
    event.preventDefault()
    await guard(async () => {
      await createStaffMember({
        name: personName,
        role: personRole,
        annualLeaveDays: Number(personAllowance) || 0,
      })
      setPersonName('')
      setPersonRole('')
      setAddingPerson(false)
    })
  }

  async function submitLeave(event: React.FormEvent) {
    event.preventDefault()
    if (!leaveStaffId) {
      setError('Choose who was off.')
      return
    }
    await guard(async () => {
      await recordStaffLeave({
        staffMemberId: leaveStaffId,
        leaveType,
        startDate: leaveStart,
        endDate: leaveEnd,
        note: leaveNote,
      })
      setLeaveNote('')
      setAddingLeave(false)
    })
  }

  const staff = data?.staff ?? []
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  return (
    <section className="staff-leaves">
      <header className="leaves-band">
        <div>
          <p className="eyebrow">Team</p>
          <h2>Staff leaves</h2>
        </div>
        <div className="leaves-band-actions">
          <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button className="primary-button" type="button" onClick={() => setAddingPerson((v) => !v)}>
            <UserPlus size={16} /> Add staff
          </button>
          <button
            className="primary-button"
            disabled={staff.length === 0}
            type="button"
            onClick={() => {
              setLeaveStaffId((current) => current || staff[0]?.id || '')
              setAddingLeave((v) => !v)
            }}
          >
            <Plus size={16} /> Record leave
          </button>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}

      {addingPerson && (
        <form className="leaves-form" onSubmit={submitPerson}>
          <label>
            Name
            <input
              autoFocus
              placeholder="e.g. Arben Krasniqi"
              type="text"
              value={personName}
              onChange={(event) => setPersonName(event.target.value)}
            />
          </label>
          <label>
            Job
            <input
              placeholder="Optional"
              type="text"
              value={personRole}
              onChange={(event) => setPersonRole(event.target.value)}
            />
          </label>
          <label>
            Days a year
            <input
              min={0}
              type="number"
              value={personAllowance}
              onChange={(event) => setPersonAllowance(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          <button className="primary-button" disabled={busy} type="submit">Add</button>
        </form>
      )}

      {addingLeave && (
        <form className="leaves-form" onSubmit={submitLeave}>
          <label>
            Who
            <select value={leaveStaffId} onChange={(event) => setLeaveStaffId(event.target.value)}>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select value={leaveType} onChange={(event) => setLeaveType(event.target.value as LeaveType)}>
              {LEAVE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            First day
            <input type="date" value={leaveStart} onChange={(event) => setLeaveStart(event.target.value)} />
          </label>
          <label>
            Last day
            <input type="date" value={leaveEnd} onChange={(event) => setLeaveEnd(event.target.value)} />
          </label>
          <label>
            Note
            <input
              placeholder="Optional"
              type="text"
              value={leaveNote}
              onChange={(event) => setLeaveNote(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={busy} type="submit">Record</button>
        </form>
      )}

      {staff.length === 0 ? (
        <p className="listings-message">
          Nobody on the register yet. Add staff by name — they do not need a login.
        </p>
      ) : (
        <>
          {/* The question the page exists to answer, first. Only annual leave
              spends the allowance; sick days sit beside it, not inside it. */}
          <div className="leaves-totals">
            {staff.map((person) => (
              <article className="leaves-total" key={person.id}>
                <div className="leaves-total-head">
                  <strong>{person.name}</strong>
                  {person.role && <small>{person.role}</small>}
                </div>
                <div className={`leaves-remaining${person.annualRemaining < 0 ? ' is-over' : ''}`}>
                  <span className="leaves-remaining-number">{person.annualRemaining}</span>
                  <small>of {person.annualAllowance} left</small>
                </div>
                <small className="leaves-total-detail">
                  {person.annualTaken} taken
                  {person.sickDays > 0 ? ` · ${person.sickDays} sick` : ''}
                  {person.unpaidDays > 0 ? ` · ${person.unpaidDays} unpaid` : ''}
                </small>
                <div className="leaves-total-actions">
                  <label>
                    Allowance
                    <input
                      min={0}
                      type="number"
                      value={person.annualAllowance}
                      onChange={(event) =>
                        guard(() =>
                          updateStaffMember(person.id, {
                            annualLeaveDays: Number(event.target.value) || 0,
                          }),
                        )
                      }
                    />
                  </label>
                  <button
                    className="btn btn-sm btn-outline"
                    title="Remove from the register"
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${person.name} and every leave recorded against them? Their history goes too.`,
                        )
                      ) {
                        guard(() => deleteStaffMember(person.id))
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </article>
            ))}
          </div>

          {/* The grid: a row per person, a day per column, one month at a time. */}
          <div className="leaves-grid-panel">
            <header className="leaves-grid-head">
              <button
                aria-label="Previous month"
                className="btn btn-sm btn-outline"
                type="button"
                onClick={() => stepMonth(-1)}
              >
                <ChevronLeft size={15} />
              </button>
              <strong>{MONTHS[month - 1]} {year}</strong>
              <button
                aria-label="Next month"
                className="btn btn-sm btn-outline"
                type="button"
                onClick={() => stepMonth(1)}
              >
                <ChevronRight size={15} />
              </button>
              <div className="leaves-key">
                {LEAVE_TYPES.map((type) => (
                  <span key={type.value}>
                    <i className={`leaves-swatch leaves-swatch--${type.value}`} /> {type.label}
                  </span>
                ))}
              </div>
            </header>

            <div className="leaves-grid-scroll">
              <table className="leaves-grid">
                <thead>
                  <tr>
                    <th className="leaves-grid-name">Staff</th>
                    {days.map((cell) => (
                      <th
                        className={cell.isWeekend ? 'is-weekend' : undefined}
                        key={cell.key}
                        scope="col"
                      >
                        {cell.day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.map((person) => (
                    <tr key={person.id}>
                      <th className="leaves-grid-name" scope="row">{person.name}</th>
                      {days.map((cell) => {
                        const entry = grid[person.id]?.[cell.key]
                        if (!entry) {
                          return (
                            <td className={cell.isWeekend ? 'is-weekend' : undefined} key={cell.key} />
                          )
                        }
                        const short =
                          LEAVE_TYPES.find((t) => t.value === entry.leaveType)?.short ?? '·'
                        return (
                          <td
                            className={`leaves-cell leaves-cell--${entry.leaveType}${
                              cell.isWeekend ? ' is-weekend' : ''
                            }`}
                            key={cell.key}
                            title={`${person.name} — ${entry.leaveTypeLabel}, ${formatDisplayDate(cell.key)}. Click to remove this period.`}
                            onClick={() => {
                              if (window.confirm('Remove this whole period of leave?')) {
                                guard(() => deleteStaffLeave(entry.id))
                              }
                            }}
                          >
                            {short}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data && data.leave.length > 0 && (
            <div className="leaves-list">
              <h3>Recorded in {year}</h3>
              <ul>
                {data.leave.map((row) => (
                  <li key={row.id}>
                    <strong>{row.staffName}</strong>
                    <span className={`leaves-chip leaves-chip--${row.leaveType}`}>
                      {row.leaveTypeLabel}
                    </span>
                    <span>
                      {formatDisplayDate(row.startDate)} → {formatDisplayDate(row.endDate)}
                    </span>
                    <small>{row.days} {row.days === 1 ? 'day' : 'days'}{row.note ? ` · ${row.note}` : ''}</small>
                    <button
                      className="btn btn-sm btn-outline"
                      disabled={busy}
                      title="Remove"
                      type="button"
                      onClick={() => guard(() => deleteStaffLeave(row.id))}
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
