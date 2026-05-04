import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import { AdminPanelPage } from './pages/AdminPanelPage'
import { AvailabilityPage } from './pages/AvailabilityPage'
import { CalendarPage } from './pages/CalendarPage'
import { CodesPage } from './pages/CodesPage'
import { DashboardPage } from './pages/DashboardPage'
import { FinancePage } from './pages/FinancePage'
import { InvoicePage } from './pages/InvoicePage'
import { LoginPage } from './pages/LoginPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { PropertiesPage } from './pages/PropertiesPage'
import { ReservationsPage } from './pages/ReservationsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SynchronizationsPage } from './pages/SynchronizationsPage'
import './App.css'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          {/* Invoice uses its own full-page layout (print-friendly, no sidebar) */}
          <Route path="/invoice" element={<InvoicePage />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/availability" element={<AvailabilityPage />} />
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/codes" element={<CodesPage />} />
            <Route path="/synchronizations" element={<SynchronizationsPage />} />
            <Route path="/admin-panel" element={<AdminPanelPage />} />
            <Route path="/finance" element={<FinancePage />} />
            <Route path="*" element={<PlaceholderPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}

export default App
