// The car outline on the hire agreement, for marking damage at handover.
//
// Uses the operator's own diagram when one is present at
// `frontend/public/car-diagram.png`, and falls back to the drawing below when
// it is not — so the contract is never missing its diagram, and swapping in a
// better one is dropping a file rather than a code change.
//
// The fallback is inline SVG rather than an image: it prints crisply at any
// size, costs no request, and is deliberately plain line-work because it is
// something to draw on with a pen.

import { useState } from 'react'

const OPERATOR_DIAGRAM = '/car-diagram.png'

export function CarDiagram() {
  const [useFallback, setUseFallback] = useState(false)

  if (!useFallback) {
    return (
      <img
        alt="Car outline for marking damage"
        className="car-diagram"
        src={OPERATOR_DIAGRAM}
        onError={() => setUseFallback(true)}
      />
    )
  }

  return <CarOutline />
}

/** Four views — top, front, rear and side — the standard inspection sheet. */
function CarOutline() {
  return (
    <svg
      aria-label="Car outline for marking damage"
      className="car-diagram"
      role="img"
      viewBox="0 0 300 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
        {/* ── Top strip: the roof seen from above ─────────────────────────── */}
        <g transform="translate(78 4)">
          <rect x="0" y="0" width="144" height="42" rx="15" />
          <path d="M26 6 q46 -5 92 0" />
          <path d="M26 36 q46 5 92 0" />
          <rect x="46" y="12" width="52" height="18" rx="5" />
        </g>

        {/* ── Middle row: front view, body from above, rear view ──────────── */}
        {/* Front */}
        <g transform="translate(6 62)">
          <rect x="10" y="6" width="52" height="60" rx="7" />
          <rect x="0" y="16" width="10" height="18" rx="3" />
          <rect x="62" y="16" width="10" height="18" rx="3" />
          <rect x="18" y="16" width="36" height="20" rx="4" />
          <path d="M18 46 h36" />
          <circle cx="26" cy="56" r="4" />
          <circle cx="46" cy="56" r="4" />
        </g>

        {/* Body from above */}
        <g transform="translate(88 58)">
          <rect x="0" y="0" width="124" height="72" rx="26" />
          <path d="M14 22 q48 -10 96 0" />
          <path d="M14 50 q48 10 96 0" />
          <rect x="34" y="26" width="56" height="20" rx="5" />
          {/* wing mirrors */}
          <path d="M0 28 h-8 M124 28 h8" />
        </g>

        {/* Rear */}
        <g transform="translate(228 62)">
          <rect x="4" y="6" width="52" height="60" rx="7" />
          <rect x="56" y="16" width="10" height="18" rx="3" />
          <rect x="-6" y="16" width="10" height="18" rx="3" />
          <rect x="12" y="16" width="36" height="20" rx="4" />
          <path d="M12 46 h36" />
          <rect x="14" y="52" width="12" height="7" rx="2" />
          <rect x="34" y="52" width="12" height="7" rx="2" />
        </g>

        {/* ── Bottom: side profile ────────────────────────────────────────── */}
        <g transform="translate(24 140)">
          <path d="M4 46 q4 -18 18 -21 l20 -16 q28 -7 56 0 l22 16 q28 3 44 9 q12 5 12 13 v5 q0 4 -6 4 H10 q-6 0 -6 -4 Z" />
          <path d="M46 12 l-14 13 h34 V12 Z" />
          <path d="M74 12 v13 h34 l-14 -13 Z" />
          <path d="M70 25 v25" />
          <circle cx="46" cy="46" r="13" />
          <circle cx="136" cy="46" r="13" />
          <circle cx="46" cy="46" r="5" />
          <circle cx="136" cy="46" r="5" />
        </g>
      </g>
    </svg>
  )
}
