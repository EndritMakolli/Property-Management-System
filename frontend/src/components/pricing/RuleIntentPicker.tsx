// Start a rule from what you are trying to do, not from the engine's field
// list. The chosen intent decides which fields the form then asks for.

import { Check } from 'lucide-react'
import { type RuleIntent } from './ruleIntents'
import type { PricingRulePayload } from '../../api/bookingEngine'

export function RuleIntentPicker({
  intents,
  current,
  onPick,
}: {
  /** Only what this group holds. Offering every kind of rule here is how a
   *  long-stay tier or a promo code ended up being offered inside Seasonal
   *  Pricing, which has its own group for each. */
  intents: RuleIntent[]
  current?: PricingRulePayload['ruleType']
  onPick: (intent: RuleIntent) => void
}) {
  return (
    <div className="intent-picker">
      <p className="intent-picker-question">What do you want this rule to do?</p>
      <div className="intent-grid">
        {intents.map((intent) => (
          <button
            key={intent.ruleType}
            type="button"
            className={`intent-card${current === intent.ruleType ? ' selected' : ''}`}
            onClick={() => onPick(intent)}
          >
            <span className="intent-card-title">
              {intent.title}
              {current === intent.ruleType && <Check size={14} />}
            </span>
            <span className="intent-card-blurb">{intent.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
