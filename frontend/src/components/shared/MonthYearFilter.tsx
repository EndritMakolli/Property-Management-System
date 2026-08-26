// Month + year, with an "All time" escape hatch.
//
// `value` is null for all time, so a caller never has to invent a sentinel
// month. Shared by the client directory and available to any other list that
// wants the same period control the reservations page has.

import { monthOptions, yearOptions } from '../../features/reservations/monthOptions'

export type PeriodValue = { month: number; year: number } | null

type MonthYearFilterProps = {
  value: PeriodValue
  onChange: (value: PeriodValue) => void
  /** Label for the cleared state, e.g. "All time". */
  allLabel?: string
  id?: string
}

export function MonthYearFilter({
  value,
  onChange,
  allLabel = 'All time',
  id = 'period',
}: MonthYearFilterProps) {
  const today = new Date()
  const activeYear = value?.year ?? today.getFullYear()

  return (
    <div className="period-filter">
      <select
        aria-label="Month"
        id={`${id}-month`}
        value={value ? value.month : ''}
        onChange={(event) => {
          const month = event.target.value
          onChange(month ? { month: Number(month), year: activeYear } : null)
        }}
      >
        <option value="">{allLabel}</option>
        {monthOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Year"
        disabled={!value}
        id={`${id}-year`}
        value={activeYear}
        onChange={(event) => {
          if (value) onChange({ month: value.month, year: Number(event.target.value) })
        }}
      >
        {yearOptions().map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </div>
  )
}
