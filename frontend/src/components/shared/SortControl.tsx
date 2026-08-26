// A key picker plus an ascending/descending toggle.
//
// Generic over the key list so any page can hand it its own options; the
// clients directory passes CLIENT_SORT_OPTIONS.

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'

export type SortDirection = 'asc' | 'desc'

type SortControlProps<K extends string> = {
  options: { value: K; label: string }[]
  sortKey: K
  direction: SortDirection
  onChange: (key: K, direction: SortDirection) => void
}

export function SortControl<K extends string>({
  options,
  sortKey,
  direction,
  onChange,
}: SortControlProps<K>) {
  return (
    <div className="sort-control">
      <select
        aria-label="Sort by"
        value={sortKey}
        onChange={(event) => onChange(event.target.value as K, direction)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        className="sort-direction-btn"
        title={direction === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
        type="button"
        onClick={() => onChange(sortKey, direction === 'asc' ? 'desc' : 'asc')}
      >
        {direction === 'asc' ? <ArrowUpNarrowWide size={15} /> : <ArrowDownWideNarrow size={15} />}
      </button>
    </div>
  )
}
