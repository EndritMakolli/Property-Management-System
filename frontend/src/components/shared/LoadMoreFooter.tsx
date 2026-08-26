// "Showing 20 of 397" plus the button that fetches the next page.
//
// Says nothing at all when everything is already on screen: a footer reading
// "Showing 3 of 3" is noise on every short list.

type LoadMoreFooterProps = {
  shown: number
  total: number
  loading?: boolean
  noun?: string
  onLoadMore: () => void
}

export function LoadMoreFooter({
  shown,
  total,
  loading = false,
  noun = 'result',
  onLoadMore,
}: LoadMoreFooterProps) {
  if (total === 0 || shown >= total) return null
  const remaining = total - shown

  return (
    <div className="load-more-footer">
      <span className="load-more-count">
        Showing {shown} of {total} {noun}
        {total === 1 ? '' : 's'}
      </span>
      <button className="pill-button" disabled={loading} type="button" onClick={onLoadMore}>
        {loading ? 'Loading…' : `Load ${Math.min(remaining, 20)} more`}
      </button>
    </div>
  )
}
