import { Navigate, useLocation } from 'react-router-dom'

// The old per-reservation invoice page. Invoicing now lives in the Invoices
// module — forward there and keep the reservation (router state) intact, so
// every existing "Invoice" button still works.
export function InvoicePage() {
  const location = useLocation()
  return <Navigate replace state={location.state} to="/invoices" />
}
