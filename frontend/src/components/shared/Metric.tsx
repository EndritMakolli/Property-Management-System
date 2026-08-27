import { looksLikeMoney } from './money'

type MetricProps = {
  label: string
  value: string
}

export function Metric({ label, value }: MetricProps) {
  // A tile is handed either "EUR 26,544" or "94%" and cannot know which in
  // advance, so it decides for itself whether the privacy switch hides it.
  // Everywhere else the `money` class is applied deliberately.
  return (
    <article className="metric">
      <span>{label}</span>
      <strong className={looksLikeMoney(value) ? 'money' : undefined}>{value}</strong>
    </article>
  )
}
