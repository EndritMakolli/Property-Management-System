import { Outlet } from 'react-router-dom'
import ClientHeader from '../../components/client/ClientHeader'
import '../../styles/client.css'

// Shell for all public (guest-facing) pages.
export default function ClientLayout() {
  return (
    <div className="client-root">
      <ClientHeader />
      <main>
        <Outlet />
      </main>
    </div>
  )
}
