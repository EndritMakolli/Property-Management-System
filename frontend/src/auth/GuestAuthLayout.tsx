// Wraps every public route in the guest session, without touching staff auth.

import { Outlet } from 'react-router-dom'
import { GuestAuthProvider } from './GuestAuthContext'

export function GuestAuthLayout() {
  return (
    <GuestAuthProvider>
      <Outlet />
    </GuestAuthProvider>
  )
}
