type MetricProps = {
  label: string
  value: string
}

export function Metric({ label, value }: MetricProps) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
