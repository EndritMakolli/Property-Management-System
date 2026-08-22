// "1 bath", "1.5 baths", "2 baths" — never "1.0 bath".
//
// Bathrooms is a decimal column so a half bathroom (one full, one without a
// shower) can be expressed. That means the raw value is 1, 1.5 or 2, and only
// the fractional ones should show a decimal point.
export function formatBaths(value: number | string | undefined, options?: { withUnit?: boolean }) {
  const count = Number(value)
  const safe = Number.isFinite(count) ? count : 1
  // Trailing zeroes are noise: 2.0 is "2", 1.5 stays "1.5".
  const number = String(Number(safe.toFixed(1)))

  if (options?.withUnit === false) return number
  return `${number} ${safe === 1 ? 'bath' : 'baths'}`
}
