import { CheckSquare, Sparkles, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PanelHeader } from '../../components/shared/PanelHeader'
import type { CleanStatusRecord, PropertyListing, ReservationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { buildCleaningTasks, type CleaningTier } from './cleaningPriority'

const tierClass: Record<CleaningTier, string> = {
  1: 'cleaning-badge-urgent',
  2: 'cleaning-badge-soon',
  3: 'cleaning-badge-wait',
}

type CleaningPanelProps = {
  properties: PropertyListing[]
  reservations: ReservationRecord[]
  cleanStatuses: CleanStatusRecord[]
  reportDate: string
  onToggleCleaned: (propertyId: string, isCleaned: boolean) => Promise<void>
}

export function CleaningPanel({
  properties,
  reservations,
  cleanStatuses,
  reportDate,
  onToggleCleaned,
}: CleaningPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null)

  const tasks = useMemo(
    () => buildCleaningTasks(properties, reservations, cleanStatuses, reportDate),
    [properties, reservations, cleanStatuses, reportDate],
  )
  const pending = tasks.filter((task) => task.needsCleaning).length

  async function toggle(propertyId: string, cleanedNow: boolean) {
    setBusyId(propertyId)
    try {
      await onToggleCleaned(propertyId, !cleanedNow)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="panel cleaning-panel">
      <PanelHeader icon={Sparkles} title={`Cleaning priority — ${pending} to clean`} />
      {tasks.length === 0 ? (
        <p className="list-empty">No apartments need cleaning right now.</p>
      ) : (
        <ul className="cleaning-list">
          {tasks.map((task) => {
            const checked = task.cleanedToday
            return (
              <li key={task.property.id} className={`cleaning-row${checked ? ' done' : ''}`}>
                <label className="cleaning-check" title={checked ? 'Mark as not cleaned' : 'Mark as cleaned'}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busyId === task.property.id}
                    onChange={() => toggle(task.property.id, checked)}
                  />
                  {checked ? <CheckSquare size={19} /> : <Square size={19} />}
                </label>

                <div className="cleaning-info">
                  <strong>{task.property.name}</strong>
                  <span>
                    {task.property.bedrooms} bed{task.property.bedrooms !== 1 ? 's' : ''}
                    {task.property.floor ? ` · ${task.property.floor}` : ''}
                    {task.nextCheckIn ? ` · next check-in ${formatDisplayDate(task.nextCheckIn)}` : ''}
                  </span>
                </div>

                {checked ? (
                  <span className="cleaning-badge cleaning-badge-done">Cleaned</span>
                ) : (
                  <span className={`cleaning-badge ${tierClass[task.tier]}`}>{task.priorityLabel}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
