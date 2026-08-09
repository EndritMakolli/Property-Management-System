import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { NewReservationModal } from '../../features/reservations/NewReservationModal'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppLayout() {
  const { user } = useAuth()
  const location = useLocation()
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
        {/* Keyed by path so navigating away from a crashed page resets the boundary */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
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
