import { useEffect, useState, type FormEvent } from 'react'
import { createLoan, deleteLoan, type LoanPayload } from '../../api/pmsApi'
import { monthOptions, yearOptions } from '../reservations/monthOptions'
import type { LoanRecord } from '../../types/domain'
import { FinanceList } from './FinanceList'
import { money, monthName } from './financeUtils'

type LoansPanelProps = {
  loans: LoanRecord[]
  selectedMonth: number
  selectedYear: number
  onReload: () => Promise<void>
  onError: (message: string) => void
}

export function LoansPanel({ loans, selectedMonth, selectedYear, onReload, onError }: LoansPanelProps) {
  const [loanForm, setLoanForm] = useState<LoanPayload>({
    name: '',
    monthlyValueEur: '',
    startYear: selectedYear,
    startMonth: selectedMonth,
    endYear: selectedYear,
    endMonth: selectedMonth,
    notes: '',
  })

  useEffect(() => {
    setLoanForm((current) => ({
      ...current,
      startYear: selectedYear,
      startMonth: selectedMonth,
      endYear: Math.max(current.endYear, selectedYear),
    }))
  }, [selectedMonth, selectedYear])

  async function addLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await createLoan(loanForm)
      setLoanForm((current) => ({ ...current, name: '', monthlyValueEur: '', notes: '' }))
      await onReload()
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : 'Could not create loan.')
    }
  }

  return (
    <article className="panel finance-section">
      <h3>Loans</h3>
      <form className="finance-form" onSubmit={addLoan}>
        <input
          required
          placeholder="Loan name"
          value={loanForm.name}
          onChange={(event) => setLoanForm({ ...loanForm, name: event.target.value })}
        />
        <input
          required
          min="0"
          placeholder="Monthly value"
          step="0.01"
          type="number"
          value={loanForm.monthlyValueEur}
          onChange={(event) => setLoanForm({ ...loanForm, monthlyValueEur: event.target.value })}
        />
        <select value={loanForm.endMonth} onChange={(event) => setLoanForm({ ...loanForm, endMonth: Number(event.target.value) })}>
          {monthOptions.map((month) => (
            <option key={month.value} value={month.value}>Ends {month.label}</option>
          ))}
        </select>
        <select value={loanForm.endYear} onChange={(event) => setLoanForm({ ...loanForm, endYear: Number(event.target.value) })}>
          {yearOptions().map((year) => (
            <option key={year} value={year}>Ends {year}</option>
          ))}
        </select>
        <button className="primary-button" type="submit">Add loan</button>
      </form>
      <FinanceList
        rows={loans}
        empty="No active loans for this month."
        onDelete={(id) => deleteLoan(id).then(onReload)}
        render={(loan) => (
          <>
            <strong>{loan.name}</strong>
            <span>{monthName(loan.startMonth)} {loan.startYear} to {monthName(loan.endMonth)} {loan.endYear}</span>
            <strong>EUR {money(loan.monthlyValueEur)}</strong>
          </>
        )}
      />
    </article>
  )
}
