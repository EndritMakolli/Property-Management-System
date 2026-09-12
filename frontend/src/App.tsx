import { GuestAuthLayout } from './auth/GuestAuthLayout'
import { RequireGuest } from './auth/RequireGuest'
import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { PlatformProvider } from './context/PlatformContext'
import { PrivacyProvider } from './context/PrivacyContext'
import { ReservationTypesProvider } from './context/ReservationTypesContext'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import ClientLayout from './pages/client/ClientLayout'
import ClientHomePage from './pages/client/ClientHomePage'
import './App.css'

const MapPage = lazy(() => import('./pages/client/MapPage'))

// PMS pages are code-split so the public guest site never downloads the admin app.
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const InvoicePage = lazy(() => import('./pages/InvoicePage').then((m) => ({ default: m.InvoicePage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const AvailabilityPage = lazy(() => import('./pages/AvailabilityPage').then((m) => ({ default: m.AvailabilityPage })))
const ReservationsPage = lazy(() => import('./pages/ReservationsPage').then((m) => ({ default: m.ReservationsPage })))
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const PropertiesPage = lazy(() => import('./pages/PropertiesPage').then((m) => ({ default: m.PropertiesPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const CodesPage = lazy(() => import('./pages/CodesPage').then((m) => ({ default: m.CodesPage })))
const SynchronizationsPage = lazy(() => import('./pages/SynchronizationsPage').then((m) => ({ default: m.SynchronizationsPage })))
const AdminPanelPage = lazy(() => import('./pages/AdminPanelPage').then((m) => ({ default: m.AdminPanelPage })))
const FinancePage = lazy(() => import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })))
const ReceiptsPage = lazy(() => import('./pages/ReceiptsPage').then((m) => ({ default: m.ReceiptsPage })))
const MaintenancePage = lazy(() => import('./pages/MaintenancePage').then((m) => ({ default: m.MaintenancePage })))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage })))
const ClientsPage = lazy(() => import('./pages/ClientsPage').then((m) => ({ default: m.ClientsPage })))
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage').then((m) => ({ default: m.ClientDetailPage })))
const BookingRequestsPage = lazy(() => import('./pages/BookingRequestsPage').then((m) => ({ default: m.BookingRequestsPage })))
const MessageTemplatesPage = lazy(() => import('./pages/MessageTemplatesPage').then((m) => ({ default: m.MessageTemplatesPage })))
const PricingRulesPage = lazy(() => import('./pages/PricingRulesPage').then((m) => ({ default: m.PricingRulesPage })))
const SecurityPage = lazy(() => import('./pages/SecurityPage').then((m) => ({ default: m.SecurityPage })))
const StaffLeavesPage = lazy(() => import('./pages/StaffLeavesPage').then((m) => ({ default: m.StaffLeavesPage })))
const GuestLoginPage = lazy(() => import('./pages/client/GuestLoginPage').then((m) => ({ default: m.GuestLoginPage })))
const GuestAccountPage = lazy(() => import('./pages/client/GuestAccountPage').then((m) => ({ default: m.GuestAccountPage })))
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage').then((m) => ({ default: m.PlaceholderPage })))

function App() {
  return (
    <PlatformProvider>
      <AuthProvider>
        <PrivacyProvider>
        <ReservationTypesProvider>
        <Suspense fallback={<p className="auth-loading">Loading…</p>}>
          <Routes>
            {/* Public guest-facing site. Everything here sits inside the guest
                session, and is declared ABOVE the RequireAuth block — the "*"
                catch-all lives inside that block, so a mistyped guest URL would
                otherwise bounce to the staff sign-in. */}
            <Route element={<GuestAuthLayout />}>
              <Route element={<ClientLayout />}>
                <Route path="/" element={<ClientHomePage />} />
                <Route path="/map" element={<MapPage />} />
                <Route element={<RequireGuest />}>
                  <Route path="/account" element={<GuestAccountPage />} />
                </Route>
              </Route>
              <Route path="/login" element={<GuestLoginPage />} />
            </Route>

            <Route path="/staff-login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/invoice" element={<InvoicePage />} />
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/availability" element={<AvailabilityPage />} />
                <Route path="/reservations" element={<ReservationsPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/properties" element={<PropertiesPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/codes" element={<CodesPage />} />
                <Route path="/synchronizations" element={<SynchronizationsPage />} />
                <Route path="/admin-panel" element={<AdminPanelPage />} />
                <Route path="/finance" element={<FinancePage />} />
                <Route path="/receipts" element={<ReceiptsPage />} />
                <Route path="/maintenance" element={<MaintenancePage />} />
                <Route path="/invoices" element={<InvoicesPage />} />
                <Route path="/payments" element={<PaymentsPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:clientId" element={<ClientDetailPage />} />
                <Route path="/booking-requests" element={<BookingRequestsPage />} />
                <Route path="/pricing-rules" element={<PricingRulesPage />} />
                <Route path="/staff-leaves" element={<StaffLeavesPage />} />
                <Route path="/message-templates" element={<MessageTemplatesPage />} />
                <Route path="/security" element={<SecurityPage />} />
                <Route path="*" element={<PlaceholderPage />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
        </ReservationTypesProvider>
        </PrivacyProvider>
      </AuthProvider>
    </PlatformProvider>
  )
}

export default App
