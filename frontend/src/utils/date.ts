export function calculateNights(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) {
    return 0
  }

  const start = new Date(`${checkIn}T00:00:00`)
  const end = new Date(`${checkOut}T00:00:00`)
  const difference = end.getTime() - start.getTime()

  if (difference <= 0) {
    return 0
  }

  return Math.round(difference / 86400000)
}

export function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateValue(value: string) {
  return value ? new Date(`${value}T00:00:00`) : new Date()
}

export function formatDisplayDate(value: string) {
  if (!value) {
    return ''
  }

  const date = parseDateValue(value)
  const day = String(date.getDate()).padStart(2, '0')
  const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(date)
  return `${day}-${month}-${date.getFullYear()}`
}

export function nextDateValue(value: string) {
  const date = parseDateValue(value)
  date.setDate(date.getDate() + 1)
  return toDateInputValue(date)
}
