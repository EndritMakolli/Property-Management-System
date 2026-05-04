import { Bell, Plus } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'

type TopbarProps = {
  onNewReservation: () => void
}

export function Topbar({ onNewReservation }: TopbarProps) {
  const { logout, user } = useAuth()
  const canCreateReservation = user.role === 'admin' || user.role === 'management'

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Daily overview</p>
        <h1>Property management dashboard</h1>
      </div>
      <div className="topbar-actions">
        <button className="icon-button" aria-label="Notifications">
          <Bell size={19} />
        </button>
        {canCreateReservation && (
          <button className="primary-button" onClick={onNewReservation}>
            <Plus size={18} />
            New reservation
          </button>
        )}
        <button onClick={logout}>Logout</button>
      </div>
    </header>
  )
}
