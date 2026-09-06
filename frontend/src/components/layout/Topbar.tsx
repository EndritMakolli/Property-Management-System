import { Eye, EyeOff, Menu, Plus } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { usePrivacy } from '../../context/PrivacyContext'
import { NotificationsBell } from './NotificationsBell'

type TopbarProps = {
  navOpen?: boolean
  onMenuToggle?: () => void
  onNewReservation: () => void
}

export function Topbar({ navOpen = false, onMenuToggle, onNewReservation }: TopbarProps) {
  const { logout, user } = useAuth()
  const { hidden, toggle } = usePrivacy()
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
        {hidden && <span className="privacy-flag">Figures hidden</span>}
        <button
          aria-label={hidden ? 'Show figures' : 'Hide figures'}
          aria-pressed={hidden}
          className={`icon-button privacy-toggle${hidden ? ' active' : ''}`}
          title={
            hidden
              ? 'Figures are hidden — click to show them'
              : 'Hide every money figure, for when someone is beside you'
          }
          type="button"
          onClick={toggle}
        >
          {hidden ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
        <NotificationsBell />
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
