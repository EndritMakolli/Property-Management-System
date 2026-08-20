// One step in the evaluation story. Groups run top to bottom, so the page
// numbers them and says in-place what each one does with its matching rules —
// the behaviour used to be explained once, in a paragraph, far from the badge
// it described.

import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { PricingGroupPayload, PricingRulePayload } from '../../api/bookingEngine'
import type { PricingGroupRecord, PricingRuleRecord, PropertyListing, RuleReport } from '../../types/domain'
import { RuleForm, RuleRow } from './RuleRow'
import { isAutoOrdered } from './displayOrder'
import { applyIntent, defaultIntentForGroup, emptyRulePayload } from './ruleIntents'

const BEHAVIOUR_STRAPLINE = {
  stack: 'every matching rule applies, in order',
  exclusive: 'only the first matching rule applies',
  best: 'the biggest discount wins, so they are listed biggest first',
  specific: 'the rule aimed most narrowly wins',
} as const

const BEHAVIOUR_LABEL = {
  stack: 'Stack',
  exclusive: 'First match',
  best: 'Best price',
  specific: 'Closest match',
} as const

// Whether a group's order changes its prices. Everywhere else the engine
// picks the winner itself (see _pricing_engine._single_winner), so reordering
// there only changes how the list reads — which the arrows still say.
const ORDER_DECIDES = new Set(['stack', 'exclusive'])

export function GroupSection({
  group,
  step,
  rules,
  properties,
  groups,
  allRules,
  reports,
  testing,
  onEditGroup,
  onDeleteGroup,
  onSaveRule,
  onDeleteRule,
  onMoveRule,
  onAddRule,
}: {
  group: PricingGroupRecord
  step: number
  rules: PricingRuleRecord[]
  properties: PropertyListing[]
  groups: PricingGroupRecord[]
  allRules: PricingRuleRecord[]
  reports: Map<string, RuleReport>
  testing: boolean
  onEditGroup: (groupId: string, patch: Partial<PricingGroupPayload>) => Promise<void>
  onDeleteGroup: (groupId: string) => Promise<void>
  onSaveRule: (id: string, patch: Partial<PricingRulePayload>) => Promise<void>
  onDeleteRule: (id: string) => Promise<void>
  onMoveRule: (groupId: string, ruleId: string, direction: 'up' | 'down') => void
  onAddRule: (groupId: string, payload: PricingRulePayload) => Promise<void>
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const [editingGroup, setEditingGroup] = useState(false)
  const [groupName, setGroupName] = useState(group.name)
  const [behaviour, setBehaviour] = useState(group.behaviour)
  const [savingGroup, setSavingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')

  const [showAddForm, setShowAddForm] = useState(false)
  const [askIntent, setAskIntent] = useState(true)
  const [newRule, setNewRule] = useState<PricingRulePayload>(() => emptyRulePayload(group.id, rules.length))
  const [savingAdd, setSavingAdd] = useState(false)
  const [addError, setAddError] = useState('')

  const appliedCount = rules.filter((r) => reports.get(r.id)?.status === 'applied').length

  function startEditGroup() {
    setGroupName(group.name)
    setBehaviour(group.behaviour)
    setGroupError('')
    setEditingGroup(true)
    setMenuOpen(false)
  }

  async function handleSaveGroup() {
    setSavingGroup(true)
    setGroupError('')
    try {
      await onEditGroup(group.id, { name: groupName, behaviour })
      setEditingGroup(false)
    } catch (e: unknown) {
      setGroupError(e instanceof Error ? e.message : 'Failed to save group.')
    } finally {
      setSavingGroup(false)
    }
  }

  async function handleDeleteGroup() {
    setMenuOpen(false)
    setGroupError('')
    try {
      await onDeleteGroup(group.id)
    } catch (e: unknown) {
      setGroupError(e instanceof Error ? e.message : 'Could not delete group.')
    }
  }

  function startAdd() {
    // Where a group can hold only one kind of rule, opening on "what do you
    // want this rule to do?" asks a question with one answer. Assume it and
    // go straight to the fields; the form still offers a Change button.
    const blank = emptyRulePayload(group.id, rules.length)
    const only = defaultIntentForGroup(group.name)
    setNewRule(only ? applyIntent(blank, only) : blank)
    setAskIntent(only === null)
    setAddError('')
    setShowAddForm(true)
    setCollapsed(false)
  }

  async function handleAddRule() {
    setSavingAdd(true)
    setAddError('')
    try {
      await onAddRule(group.id, newRule)
      setShowAddForm(false)
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Failed to save rule.')
    } finally {
      setSavingAdd(false)
    }
  }

  return (
    <div className="pricing-panel pricing-group">
      <div className="pricing-panel-header">
        <button
          type="button"
          className="group-heading"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <span className="group-step">{step}</span>
          <span className="group-title">
            <span className="group-name">{group.name}</span>
            <span className="group-strapline">
              <span className={`behaviour-badge behaviour-${group.behaviour}`}>
                {BEHAVIOUR_LABEL[group.behaviour]}
              </span>
              {BEHAVIOUR_STRAPLINE[group.behaviour]}
            </span>
          </span>
          <span className="group-count">
            {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
            {testing && rules.length > 0 && ` · ${appliedCount} applied`}
          </span>
        </button>

        <div className="group-actions">
          <div className="group-menu">
            <button className="btn btn-sm btn-outline" onClick={() => setMenuOpen((v) => !v)} title="Group options">
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="group-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="group-menu-items">
                  <button onClick={startEditGroup}><Pencil size={13} /> Rename or change behaviour</button>
                  <button className="danger" onClick={handleDeleteGroup}><Trash2 size={13} /> Delete group</button>
                </div>
              </>
            )}
          </div>

          <button className="btn btn-sm btn-primary" onClick={startAdd}>
            <Plus size={14} /> Add rule
          </button>
        </div>
      </div>

      {groupError && <p className="pricing-error">{groupError}</p>}

      {editingGroup && (
        <div className="pricing-form">
          <div>
            <label>Name</label>
            <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          </div>
          {/* Only offered where the answer is a real choice. In a group that
              picks its own winner — a base rate by aim, a tier by outcome —
              the behaviour is what makes the group work, and changing it
              would break the model rather than configure it. */}
          {ORDER_DECIDES.has(group.behaviour) ? (
            <div>
              <label>When several rules here match a stay</label>
              <select value={behaviour} onChange={(e) => setBehaviour(e.target.value as PricingGroupRecord['behaviour'])}>
                <option value="stack">Apply all of them, in order</option>
                <option value="exclusive">Apply only the first one, by order</option>
              </select>
            </div>
          ) : null}
          <div className="pricing-form-actions">
            <button className="btn btn-sm btn-primary" onClick={handleSaveGroup} disabled={savingGroup}>
              {savingGroup ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setEditingGroup(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!collapsed && (
        <>
          {rules.length === 0 ? (
            <div className="pricing-empty">No rules here yet.</div>
          ) : (
            <div className="pricing-rule-list">
              {rules.map((rule, index) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  properties={properties}
                  groups={groups}
                  allRules={allRules}
                  report={reports.get(rule.id)}
                  onSave={onSaveRule}
                  onDelete={onDeleteRule}
                  onMove={(ruleId, direction) => onMoveRule(group.id, ruleId, direction)}
                  sortable={!isAutoOrdered(group.behaviour)}
                  orderDecidesPrice={ORDER_DECIDES.has(group.behaviour)}
                  isFirst={index === 0}
                  isLast={index === rules.length - 1}
                />
              ))}
            </div>
          )}

          {showAddForm && (
            <div className="pricing-add-rule">
              {addError && <p className="pricing-error">{addError}</p>}
              <RuleForm
                value={newRule}
                onChange={setNewRule}
                properties={properties}
                groups={groups}
                allRules={allRules}
                startOnPicker={askIntent}
              />
              <div className="pricing-form-actions standalone">
                <button className="btn btn-sm btn-primary" onClick={handleAddRule} disabled={savingAdd}>
                  {savingAdd ? 'Saving…' : 'Save rule'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => setShowAddForm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
