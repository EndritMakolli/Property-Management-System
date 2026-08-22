import { CheckSquare, Download, FileText, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  fetchOutstandingExpenses,
  fetchProperties,
  fetchReservations,
  setExpensePaidForMonth,
  updateReservationPayment,
  type OutstandingExpense,
} from '../api/pmsApi'
import { useAuth } from '../auth/AuthContext'
import { Metric } from '../components/shared/Metric'
import { PaymentStatusDonuts } from '../features/dashboard/PaymentStatusDonuts'
import { buildDueRows, togglePayload, type DueRow } from '../features/payments/paymentPeriods'
import { monthNames } from '../features/reports/reportCalculations'
import { useReservationTypeOptions } from '../features/reservations/reservationOptions'
import type { PropertyListing, ReservationRecord } from '../types/domain'
import { toDateInputValue } from '../utils/date'
import '../styles/payments.css'

type PaidFilter = 'all' | 'unpaid' | 'paid'


function euro(amount: number) {
  return `EUR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function PaymentsPage() {
  const typeOptions = useReservationTypeOptions({ excludeMaintenance: true })
  const now = new Date()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [reservations, setReservations] = useState<ReservationRecord[]>([])
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [unpaidExpenses, setUnpaidExpenses] = useState<OutstandingExpense[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [monthFilter, setMonthFilter] = useState(String(now.getMonth() + 1))
  const [yearFilter, setYearFilter] = useState(String(now.getFullYear()))
  const [propertyFilter, setPropertyFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all')

  const today = toDateInputValue(new Date())

  async function loadData() {
    try {
      const [resRows, propRows] = await Promise.all([fetchReservations(), fetchProperties()])
      setReservations(resRows)
      setProperties(propRows)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
    if (isAdmin) {
      // Every unpaid expense month up to now — including arrears from earlier
      // months, which a current-month-only view would hide.
      fetchOutstandingExpenses()
        .then((data) => setUnpaidExpenses(data.outstanding))
        .catch(() => setUnpaidExpenses([]))
    }
  }

  useEffect(() => {
    loadData()
    const refresh = () => loadData()
    window.addEventListener('pms:reservation-created', refresh)
    return () => window.removeEventListener('pms:reservation-created', refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allRows = useMemo(() => buildDueRows(reservations, today), [reservations, today])

  const yearOptions = useMemo(() => {
    const years = new Set<string>([String(now.getFullYear())])
    for (const row of allRows) years.add(row.sortKey.slice(0, 4))
    return [...years].sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows])

  const rows = useMemo(() => {
    return allRows.filter((row) => {
      if (yearFilter && row.sortKey.slice(0, 4) !== yearFilter) return false
      if (monthFilter && row.sortKey.slice(5, 7) !== monthFilter.padStart(2, '0')) return false
      if (propertyFilter && row.reservation.propertyId !== propertyFilter) return false
      if (typeFilter && row.reservation.reservationType !== typeFilter) return false
      if (paidFilter === 'unpaid' && row.paid) return false
      if (paidFilter === 'paid' && !row.paid) return false
      return true
    })
  }, [allRows, yearFilter, monthFilter, propertyFilter, typeFilter, paidFilter])

  const owed = rows.filter((row) => !row.paid).reduce((sum, row) => sum + row.amount, 0)
  const collected = rows.filter((row) => row.paid).reduce((sum, row) => sum + row.amount, 0)
  const remaining = rows.filter((row) => !row.paid).length

  // Marks the specific month this row represents, not "the expense" as a whole.
  async function markExpensePaid(expense: OutstandingExpense) {
    setError('')
    try {
      await setExpensePaidForMonth(expense.id, expense.year, expense.month, true)
      setUnpaidExpenses((current) =>
        current.filter(
          (row) => !(row.id === expense.id && row.year === expense.year && row.month === expense.month),
        ),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the expense.')
    }
  }

  async function toggle(row: DueRow) {
    setBusyKey(row.key)
    setError('')
    try {
      const saved = await updateReservationPayment(row.reservation.id, togglePayload(row))
      setReservations((current) => current.map((r) => (r.id === saved.id ? saved : r)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the payment.')
    } finally {
      setBusyKey(null)
    }
  }

  function exportToCSV() {
    const headers = ['Guest', 'Phone', 'Apartment', 'Type', 'Period / Due', 'Due date', 'Amount EUR', 'Paid']
    const csvRows = rows.map((row) => [
      row.reservation.guestName,
      row.reservation.guestPhone,
      row.reservation.apartment,
      row.reservation.reservationType,
      row.dueLabel,
      row.sortKey,
      row.amount.toFixed(2),
      row.paid ? 'Yes' : 'No',
    ])
    const csv = [headers, ...csvRows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payments-${yearFilter || 'all'}-${monthFilter ? monthFilter.padStart(2, '0') : 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="payments-page">
      <div className="payments-head">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">
            Every payment owed by guests who have checked in — monthly stays appear once per rent period.
          </p>
        </div>
        <button className="pill-button" type="button" onClick={exportToCSV}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="metric-row">
        <Metric label="Outstanding" value={euro(owed)} />
        <Metric label="Collected (in view)" value={euro(collected)} />
        <Metric label="Payments remaining" value={String(remaining)} />
        <Metric label="Rows in view" value={String(rows.length)} />
      </div>

      <div className="payments-filters">
        <select aria-label="Month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value="">All months</option>
          {monthNames.map((name, index) => (
            <option key={name} value={String(index + 1)}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="Year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="">All years</option>
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <select aria-label="Apartment" value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
          <option value="">All apartments</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
        <select aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="payments-chips pill-toggle-group">
          {(['all', 'unpaid', 'paid'] as PaidFilter[]).map((value) => (
            <button
              key={value}
              className={`pill-toggle${paidFilter === value ? ' active' : ''}`}
              type="button"
              onClick={() => setPaidFilter(value)}
            >
              {value === 'all' ? 'All' : value === 'unpaid' ? 'Unpaid' : 'Paid'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {status === 'loading' && <p className="payments-empty">Loading payments…</p>}
      {status === 'error' && <p className="form-error">Could not load reservations.</p>}

      {status === 'ready' && (
        <PaymentStatusDonuts
          month={monthFilter ? Number(monthFilter) : now.getMonth() + 1}
          reservations={reservations}
          year={yearFilter ? Number(yearFilter) : now.getFullYear()}
        />
      )}

      {status === 'ready' && (
        <section className="panel">
          {rows.length === 0 ? (
            <p className="payments-empty">No payments match these filters.</p>
          ) : (
            <div className="payments-table-wrap">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th aria-label="Paid" />
                    <th>Guest</th>
                    <th>Apartment</th>
                    <th>Type</th>
                    <th>Period / due</th>
                    <th className="payments-amount">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className={row.paid ? 'paid-row' : ''}>
                      <td>
                        <label className="cleaning-check" title={row.paid ? 'Mark as not paid' : 'Mark as paid'}>
                          <input
                            type="checkbox"
                            checked={row.paid}
                            disabled={busyKey === row.key}
                            onChange={() => toggle(row)}
                          />
                          {row.paid ? <CheckSquare size={18} /> : <Square size={18} />}
                        </label>
                      </td>
                      <td className="payments-guest">
                        <strong>{row.reservation.guestName || row.reservation.guestPhone || 'Guest'}</strong>
                        {row.reservation.guestPhone && <small>{row.reservation.guestPhone}</small>}
                      </td>
                      <td>{row.reservation.apartment}</td>
                      <td>
                        <span className={`search-res-platform search-res-platform-${row.reservation.reservationType}`}>
                          {row.reservation.reservationType}
                        </span>
                      </td>
                      <td>{row.dueLabel}</td>
                      <td className="payments-amount">{euro(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {isAdmin && unpaidExpenses.length > 0 && (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>
            <FileText size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Unpaid expenses ({unpaidExpenses.length})
          </h3>
          <ul className="payments-due-list">
            {unpaidExpenses.map((expense) => (
              <li className="payments-due-row" key={`${expense.id}-${expense.year}-${expense.month}`}>
                <div className="payments-due-info">
                  <strong>
                    {expense.name}
                    <span className="payments-due-period">
                      {' '}
                      · {monthNames[expense.month - 1]} {expense.year}
                    </span>
                  </strong>
                  <span>
                    {expense.categoryName}
                    {expense.vendor ? ` · ${expense.vendor}` : ''}
                    {expense.invoiceDate ? ` · ${expense.invoiceDate}` : ''}
                  </span>
                </div>
                {expense.invoiceFileUrl && (
                  <a className="pill-button" href={expense.invoiceFileUrl} rel="noreferrer" target="_blank">
                    Invoice
                  </a>
                )}
                <button className="pill-button" type="button" onClick={() => markExpensePaid(expense)}>
                  Mark paid
                </button>
                <strong className="payments-due-amount">
                  EUR {Number(expense.amountEur).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
