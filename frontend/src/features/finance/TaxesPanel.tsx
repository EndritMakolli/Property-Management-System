import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { deleteTax, upsertTax, type MonthlyTaxPayload } from '../../api/pmsApi'
import type { MonthlyTaxRecord } from '../../types/domain'
import { money, monthName } from './financeUtils'

type TaxesPanelProps = {
  taxes: MonthlyTaxRecord[]
  setTaxes: Dispatch<SetStateAction<MonthlyTaxRecord[]>>
  selectedMonth: number
  selectedYear: number
  monthLabel: string | number
  refreshKey: number
  onError: (message: string) => void
}

export function TaxesPanel({ taxes, setTaxes, selectedMonth, selectedYear, monthLabel, refreshKey, onError }: TaxesPanelProps) {
  const [taxDraft, setTaxDraft] = useState({ tvsh: '', tatimNeFitim: '', notes: '' })
  const [savingTax, setSavingTax] = useState(false)

  const currentTax = taxes.find((t) => t.year === selectedYear && t.month === selectedMonth)

  // Pre-fill the draft after each data load (refreshKey) and on period change —
  // but not while the user is typing (taxes itself is deliberately not a dep).
  useEffect(() => {
    const existing = taxes.find((t) => t.year === selectedYear && t.month === selectedMonth)
    setTaxDraft({
      tvsh: existing?.tvsh || '',
      tatimNeFitim: existing?.tatimNeFitim || '',
      notes: existing?.notes || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, selectedMonth, selectedYear])

  async function saveTax() {
    setSavingTax(true)
    try {
      const payload: MonthlyTaxPayload = {
        year: selectedYear,
        month: selectedMonth,
        tvsh: taxDraft.tvsh || '0',
        tatimNeFitim: taxDraft.tatimNeFitim || '0',
        notes: taxDraft.notes,
      }
      const updated = await upsertTax(payload)
      setTaxes((prev) => {
        const exists = prev.find((t) => t.year === selectedYear && t.month === selectedMonth)
        if (exists) return prev.map((t) => (t.id === updated.id ? updated : t))
        return [...prev, updated]
      })
    } catch (caughtError) {
      onError(caughtError instanceof Error ? caughtError.message : 'Could not save tax record.')
    } finally {
      setSavingTax(false)
    }
  }

  async function deleteTaxRecord(id: string) {
    await deleteTax(id)
    setTaxes((prev) => prev.filter((t) => t.id !== id))
    setTaxDraft({ tvsh: '', tatimNeFitim: '', notes: '' })
  }

  return (
    <article className="panel finance-section">
      <h3>Taxes — {monthLabel} {selectedYear}</h3>
      <div className="tax-form">
        <label>
          TVSH (VAT)
          <input
            min="0"
            placeholder="0.00"
            step="0.01"
            type="number"
            value={taxDraft.tvsh}
            onChange={(e) => setTaxDraft((d) => ({ ...d, tvsh: e.target.value }))}
          />
        </label>
        <label>
          Tatim në Fitim (Profit Tax)
          <input
            min="0"
            placeholder="0.00"
            step="0.01"
            type="number"
            value={taxDraft.tatimNeFitim}
            onChange={(e) => setTaxDraft((d) => ({ ...d, tatimNeFitim: e.target.value }))}
          />
        </label>
        <label>
          Notes
          <input
            placeholder="Optional notes"
            type="text"
            value={taxDraft.notes}
            onChange={(e) => setTaxDraft((d) => ({ ...d, notes: e.target.value }))}
          />
        </label>
        <div className="tax-form-actions">
          <button
            className="primary-button"
            disabled={savingTax}
            type="button"
            onClick={saveTax}
          >
            {savingTax ? 'Saving...' : currentTax ? 'Update taxes' : 'Save taxes'}
          </button>
          {currentTax && (
            <button
              type="button"
              onClick={() => deleteTaxRecord(currentTax.id)}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {taxes.length > 0 && (
        <div className="tax-history">
          <h4>Tax history</h4>
          <table className="tax-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>TVSH</th>
                <th>Tatim në Fitim</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {taxes
                .slice()
                .sort((a, b) => b.year - a.year || b.month - a.month)
                .map((tax) => (
                  <tr key={tax.id} className={tax.year === selectedYear && tax.month === selectedMonth ? 'tax-row-current' : ''}>
                    <td>{monthName(tax.month)} {tax.year}</td>
                    <td>EUR {money(tax.tvsh)}</td>
                    <td>EUR {money(tax.tatimNeFitim)}</td>
                    <td>{tax.notes || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}
