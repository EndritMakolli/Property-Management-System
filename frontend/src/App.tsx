import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { PlatformProvider } from './context/PlatformContext'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import { AdminPanelPage } from './pages/AdminPanelPage'
import { BookingRequestsPage } from './pages/BookingRequestsPage'
import { BookingSettingsPage } from './pages/BookingSettingsPage'
import { PricingRulesPage } from './pages/PricingRulesPage'
import { ArchivePage } from './pages/ArchivePage'
import { AvailabilityPage } from './pages/AvailabilityPage'
import { CalendarPage } from './pages/CalendarPage'
import { CodesPage } from './pages/CodesPage'
import { DashboardPage } from './pages/DashboardPage'
import { FinancePage } from './pages/FinancePage'
import { InvoicePage } from './pages/InvoicePage'
import { InvoicesPage } from './pages/InvoicesPage'
import { LoginPage } from './pages/LoginPage'
import ClientLayout from './pages/client/ClientLayout'
import ClientHomePage from './pages/client/ClientHomePage'
import { MaintenancePage } from './pages/MaintenancePage'
import { NeedsAttentionPage } from './pages/NeedsAttentionPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { PropertiesPage } from './pages/PropertiesPage'
import { ReceiptsPage } from './pages/ReceiptsPage'
import { ReservationsPage } from './pages/ReservationsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SearchReservationsPage } from './pages/SearchReservationsPage'
import { SynchronizationsPage } from './pages/SynchronizationsPage'
import './App.css'

function App() {
  return (
    <PlatformProvider>
    <AuthProvider>
      <Routes>
        {/* Public guest-facing site */}
        <Route element={<ClientLayout />}>
          <Route path="/" element={<ClientHomePage />} />
        </Route>

        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/invoice" element={<InvoicePage />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/availability" element={<AvailabilityPage />} />
            <Route path="/search-reservations" element={<SearchReservationsPage />} />
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/properties" element={<PropertiesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/codes" element={<CodesPage />} />
            <Route path="/synchronizations" element={<SynchronizationsPage />} />
            <Route path="/admin-panel" element={<AdminPanelPage />} />
            <Route path="/finance" element={<FinancePage />} />
            <Route path="/receipts" element={<ReceiptsPage />} />
            <Route path="/maintenance" element={<MaintenancePage />} />
            <Route path="/needs-attention" element={<NeedsAttentionPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/booking-requests" element={<BookingRequestsPage />} />
            <Route path="/pricing-rules" element={<PricingRulesPage />} />
            <Route path="/booking-settings" element={<BookingSettingsPage />} />
            <Route path="*" element={<PlaceholderPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
    </PlatformProvider>
  )
}

export default App
