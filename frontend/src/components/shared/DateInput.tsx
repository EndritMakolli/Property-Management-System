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

  // Desktop convenience: clicking anywhere in the field opens the picker. On mobile
  // the real <input type="date"> receives the tap directly (see .date-input-picker),
  // so this is only an enhancement and must never throw if showPicker() is unsupported
  // or the picker is already opening.
  function openPicker() {
    if (readOnly) {
      return
    }

    const picker = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null
    if (!picker) {
      return
    }

    try {
      if (picker.showPicker) {
        picker.showPicker()
      } else {
        picker.focus()
      }
    } catch {
      /* showPicker() can throw (e.g. called without a user gesture) — ignore. */
    }
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
