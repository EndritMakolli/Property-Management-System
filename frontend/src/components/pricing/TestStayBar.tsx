// "Test a stay" — the lens the whole pricing page is read through.
//
// The rule editor could never answer the two questions that actually matter:
// what would a guest pay, and why didn't the rule I just wrote fire? The
// engine has always known both; nothing displayed them. Pick a property and
// dates here and every rule row on the page reports what it did.

import { AlertTriangle, ChevronDown, ChevronUp, Lock } from 'lucide-react'
import { useState } from 'react'
import type { PricingQuote, PropertyListing } from '../../types/domain'
import { buildCalculation } from './quoteCalculation'

export type TestStay = {
  propertyId: string
  checkIn: string
  checkOut: string
  promoCode: string
}

function money(value: string): string {
  const n = Number(value)
  return Number.isFinite(n) ? `\u20ac${n.toLocaleString('en', { maximumFractionDigits: 2 })}` : `\u20ac${value}`
}

/** '2026-06-12' -> 'Fri 12 Jun'. The strip is scanned, not read. */
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}

export function TestStayBar({
  properties,
  stay,
  onChange,
  quote,
  promoError,
  loading,
  error,
}: {
  properties: PropertyListing[]
  stay: TestStay
  onChange: (next: TestStay) => void
  quote: PricingQuote | null
  promoError: string
  loading: boolean
  error: string
}) {
  const [showNights, setShowNights] = useState(false)

  function set<K extends keyof TestStay>(key: K, value: TestStay[K]) {
    onChange({ ...stay, [key]: value })
  }

  const ready = Boolean(stay.propertyId && stay.checkIn && stay.checkOut)
  const sum = quote ? buildCalculation(quote) : null

  return (
    <div className="test-stay">
      <div className="test-stay-controls">
        <div>
          <label htmlFor="test-property">Property</label>
          <select
            id="test-property"
            value={stay.propertyId}
            onChange={(e) => set('propertyId', e.target.value)}
          >
            <option value="">Choose a property…</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="test-check-in">Check-in</label>
          <input
            id="test-check-in"
            type="date"
            value={stay.checkIn}
            onChange={(e) => set('checkIn', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="test-check-out">Check-out</label>
          <input
            id="test-check-out"
            type="date"
            value={stay.checkOut}
            onChange={(e) => set('checkOut', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="test-promo">Promo code</label>
          <input
            id="test-promo"
            type="text"
            placeholder="none"
            value={stay.promoCode}
            onChange={(e) => set('promoCode', e.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="test-stay-result">
        {!ready ? (
          <p className="test-stay-hint">
            Pick a property and dates to see what a guest would pay — and what each rule below did.
          </p>
        ) : error ? (
          <p className="test-stay-error"><AlertTriangle size={14} /> {error}</p>
        ) : !quote || !sum ? (
          <p className="test-stay-hint">Pricing…</p>
        ) : (
          <>
            <div className="test-stay-total" aria-busy={loading}>
              <strong>{money(quote.total)}</strong>
              <button className="btn btn-sm btn-outline" onClick={() => setShowNights((v) => !v)}>
                {showNights ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {showNights ? 'Hide nights' : 'Show nights'}
              </button>
            </div>

            {/* The sum written out, so the total can be checked rather than
                taken on trust. Each step is a rule from the list below. */}
            <p className="test-stay-maths">
              <span>{sum.opening}</span>
              <span className="op">=</span>
              <span>{sum.subtotal}</span>
              {sum.steps.map((step) => (
                <span key={step.label} className="test-stay-step">
                  <span className="op">{step.delta}</span>
                  <span className="step-label">{step.label}</span>
                </span>
              ))}
              <span className="op">=</span>
              <strong>{sum.total}</strong>
              <span className="test-stay-avg">avg {sum.average}/night</span>
            </p>

            {promoError && (
              <p className="test-stay-warning"><AlertTriangle size={14} /> {promoError}</p>
            )}

            {quote.errors.map((message) => (
              <p key={message} className="test-stay-error">
                <AlertTriangle size={14} /> {message} This stay would be refused.
              </p>
            ))}

            {showNights && (
              <div className="test-stay-nights">
                {quote.nightlyBreakdown.map((night) => (
                  <div key={night.date} className={`test-night${night.locked ? ' locked' : ''}`}>
                    <span className="test-night-date">{shortDay(night.date)}</span>
                    <span className="test-night-rate">
                      {money(night.rate)}
                      {night.locked && <Lock size={11} aria-label="Price locked by a final-price rule" />}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {showNights && quote.nightlyBreakdown.some((n) => n.locked) && (
              <p className="test-stay-hint">
                <Lock size={11} /> Locked nights were set by a final-price rule. No later group and no
                whole-stay discount can change them.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
