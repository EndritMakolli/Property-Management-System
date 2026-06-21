import { useState, type FormEvent } from 'react'
import {
  createFinancialObligation,
  deleteFinancialObligation,
  updateFinancialObligation,
  type FinancialObligationPayload,
} from '../../api/pmsApi'
import { DateInput } from '../../components/shared/DateInput'
import type { FinancialObligationRecord } from '../../types/domain'
import { formatDisplayDate } from '../../utils/date'
import { FinanceList } from './FinanceList'
import { money } from './financeUtils'

type ObligationsPanelProps = {
  obligations: FinancialObligationRecord[]
  onReload: () => Promise<void>
  onError: (message: string) => void
}

export function ObligationsPanel({ obligations, onReload, onError }: ObligationsPanelProps) {
  const [obligationForm, setObligationForm] = useState<FinancialObligationPayload>({
    companyName: '',
    description: '',
    amountEur: '',
    dueDate: '',
    paid: false,
    notes: '',
  })

  async function addObligation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await createFinancialObligation(obligationForm)
      setObligationForm({ companyName: '', description: '', amountEur: '', dueDate: '', paid: false, notes: '' })
      await onReload()
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : 'Could not create obligation.')
    }
  }

  async function toggleObligationPaid(obligation: FinancialObligationRecord) {
    await updateFinancialObligation(obligation.id, {
      companyName: obligation.companyName,
      description: obligation.description,
      amountEur: obligation.amountEur,
      dueDate: obligation.dueDate,
      paid: !obligation.paid,
      notes: obligation.notes,
    })
    await onReload()
  }

  return (
    <article className="panel finance-section">
      <h3>Financial Obligations</h3>
      <form className="finance-form" onSubmit={addObligation}>
        <input
          required
          placeholder="Company"
          value={obligationForm.companyName}
          onChange={(event) => setObligationForm({ ...obligationForm, companyName: event.target.value })}
        />
        <input
          placeholder="Description"
          value={obligationForm.description}
          onChange={(event) => setObligationForm({ ...obligationForm, description: event.target.value })}
        />
        <input
          required
          min="0"
          placeholder="Debt value"
          step="0.01"
          type="number"
          value={obligationForm.amountEur}
          onChange={(event) => setObligationForm({ ...obligationForm, amountEur: event.target.value })}
        />
        <DateInput ariaLabel="Due date" value={obligationForm.dueDate} onChange={(value) => setObligationForm({ ...obligationForm, dueDate: value })} />
        <button className="primary-button" type="submit">Add obligation</button>
      </form>
      <FinanceList
        rows={obligations}
        empty="No obligations yet."
        onDelete={(id) => deleteFinancialObligation(id).then(onReload)}
        render={(obligation) => (
          <>
            <strong>{obligation.companyName}</strong>
            <span>{obligation.description || 'No description'}</span>
            <span>{obligation.dueDate ? formatDisplayDate(obligation.dueDate) : 'No due date'}</span>
            <span>{obligation.paid ? 'Paid' : 'Unpaid'}</span>
            <strong>EUR {money(obligation.amountEur)}</strong>
            <button type="button" onClick={() => toggleObligationPaid(obligation)}>
              {obligation.paid ? 'Mark unpaid' : 'Mark paid'}
            </button>
          </>
        )}
      />
    </article>
  )
}
