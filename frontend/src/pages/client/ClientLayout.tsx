import { Outlet, useLocation } from 'react-router-dom'
import ClientHeader from '../../components/client/ClientHeader'
import { ErrorBoundary } from '../../components/shared/ErrorBoundary'
import '../../styles/client.css'

// Shell for all public (guest-facing) pages.
export default function ClientLayout() {
  const location = useLocation()

  return (
    <div className="client-root">
      <ClientHeader />
      <main>
        {/* Keyed by path so navigating away from a crashed page resets the boundary */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
