import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { PlatformProvider } from './context/PlatformContext'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import ClientLayout from './pages/client/ClientLayout'
import ClientHomePage from './pages/client/ClientHomePage'
import './App.css'

// PMS pages are code-split so the public guest site never downloads the admin app.
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const InvoicePage = lazy(() => import('./pages/InvoicePage').then((m) => ({ default: m.InvoicePage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const AvailabilityPage = lazy(() => import('./pages/AvailabilityPage').then((m) => ({ default: m.AvailabilityPage })))
const SearchReservationsPage = lazy(() => import('./pages/SearchReservationsPage').then((m) => ({ default: m.SearchReservationsPage })))
const ReservationsPage = lazy(() => import('./pages/ReservationsPage').then((m) => ({ default: m.ReservationsPage })))
const ArchivePage = lazy(() => import('./pages/ArchivePage').then((m) => ({ default: m.ArchivePage })))
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const PropertiesPage = lazy(() => import('./pages/PropertiesPage').then((m) => ({ default: m.PropertiesPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const CodesPage = lazy(() => import('./pages/CodesPage').then((m) => ({ default: m.CodesPage })))
const SynchronizationsPage = lazy(() => import('./pages/SynchronizationsPage').then((m) => ({ default: m.SynchronizationsPage })))
const AdminPanelPage = lazy(() => import('./pages/AdminPanelPage').then((m) => ({ default: m.AdminPanelPage })))
const FinancePage = lazy(() => import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })))
const ReceiptsPage = lazy(() => import('./pages/ReceiptsPage').then((m) => ({ default: m.ReceiptsPage })))
const MaintenancePage = lazy(() => import('./pages/MaintenancePage').then((m) => ({ default: m.MaintenancePage })))
const NeedsAttentionPage = lazy(() => import('./pages/NeedsAttentionPage').then((m) => ({ default: m.NeedsAttentionPage })))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })))
const BookingRequestsPage = lazy(() => import('./pages/BookingRequestsPage').then((m) => ({ default: m.BookingRequestsPage })))
const PricingRulesPage = lazy(() => import('./pages/PricingRulesPage').then((m) => ({ default: m.PricingRulesPage })))
const BookingSettingsPage = lazy(() => import('./pages/BookingSettingsPage').then((m) => ({ default: m.BookingSettingsPage })))
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage').then((m) => ({ default: m.PlaceholderPage })))

function App() {
  return (
    <PlatformProvider>
      <AuthProvider>
        <Suspense fallback={<p className="auth-loading">Loading…</p>}>
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
        </Suspense>
      </AuthProvider>
    </PlatformProvider>
  )
}

export default App
