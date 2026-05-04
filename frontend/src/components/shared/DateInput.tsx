import { useRef } from 'react'
import { formatDisplayDate } from '../../utils/date'

type DateInputProps = {
  ariaLabel?: string
  min?: string
  onChange?: (value: string) => void
  readOnly?: boolean
  required?: boolean
  value: string
}

export function DateInput({
  ariaLabel = 'Choose date',
  min,
  onChange,
  readOnly = false,
  required = false,
  value,
}: DateInputProps) {
  const pickerRef = useRef<HTMLInputElement>(null)

  function openPicker() {
    if (readOnly) {
      return
    }

    const picker = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null
    if (!picker) {
      return
    }

    if (picker.showPicker) {
      picker.showPicker()
      return
    }

    picker.click()
    picker.focus()
  }

  return (
    <span className={`date-input${readOnly ? ' readonly' : ''}`} onClick={openPicker}>
      <input
        aria-label={ariaLabel}
        readOnly
        required={required}
        type="text"
        value={formatDisplayDate(value)}
        onFocus={openPicker}
      />
      {!readOnly && (
        <input
          ref={pickerRef}
          aria-label={`${ariaLabel} picker`}
          className="date-input-picker"
          min={min}
          required={required}
          type="date"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        />
      )}
    </span>
  )
}
