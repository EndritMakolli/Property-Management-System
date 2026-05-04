export function formatNightlyPrice(price: string) {
  const amount = Number(price)

  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Price not set'
  }

  return `${amount.toFixed(2)} EUR`
}
