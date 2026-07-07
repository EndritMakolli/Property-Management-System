import { Bell, Menu, Plus } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'

type TopbarProps = {
  navOpen?: boolean
  onMenuToggle?: () => void
  onNewReservation: () => void
}

export function Topbar({ navOpen = false, onMenuToggle, onNewReservation }: TopbarProps) {
  const { logout, user } = useAuth()
  const canCreateReservation = user.role === 'admin' || user.role === 'management'

  return (
    <header className="topbar">
      <div className="topbar-heading">
        {onMenuToggle && (
          <button
            aria-expanded={navOpen}
            aria-label="Open menu"
            className="icon-button menu-button"
            onClick={onMenuToggle}
            type="button"
          >
            <Menu size={20} />
          </button>
        )}
        <div>
          <p className="eyebrow">Daily overview</p>
          <h1>Property management dashboard</h1>
        </div>
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
