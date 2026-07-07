import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { NewReservationModal } from '../../features/reservations/NewReservationModal'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppLayout() {
  const { user } = useAuth()
  const [reservationModalOpen, setReservationModalOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const canCreateReservation = user.role === 'admin' || user.role === 'management'

  // Lock background scroll while the mobile nav drawer is open
  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [navOpen])

  return (
    <div className="app-shell">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {navOpen && (
        <div
          aria-hidden="true"
          className="sidebar-backdrop"
          onClick={() => setNavOpen(false)}
        />
      )}
      <main className="main-panel">
        <Topbar
          navOpen={navOpen}
          onMenuToggle={() => setNavOpen((open) => !open)}
          onNewReservation={() => setReservationModalOpen(true)}
        />
        <Outlet />
      </main>
      {canCreateReservation && (
        <NewReservationModal
          onClose={() => setReservationModalOpen(false)}
          open={reservationModalOpen}
        />
      )}
    </div>
  )
}
