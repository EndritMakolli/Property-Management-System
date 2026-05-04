import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { NewReservationModal } from '../../features/reservations/NewReservationModal'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppLayout() {
  const { user } = useAuth()
  const [reservationModalOpen, setReservationModalOpen] = useState(false)
  const canCreateReservation = user.role === 'admin' || user.role === 'management'

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Topbar onNewReservation={() => setReservationModalOpen(true)} />
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
