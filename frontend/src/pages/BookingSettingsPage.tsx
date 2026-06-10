import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import {
  createAmenity,
  createHouseRule,
  deleteAmenity,
  deleteHouseRule,
  fetchAmenities,
  fetchHouseRules,
  fetchPmsBookingSettings,
  updateAmenity,
  updateHouseRule,
  updatePmsBookingSettings,
} from '../api/pmsApi'
import type { AmenityRecord, BookingSiteSettingsRecord, HouseRuleRecord } from '../types/domain'
import '../styles/booking-settings.css'

type Tab = 'general' | 'amenities' | 'house_rules' | 'booking_rules'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'amenities', label: 'Amenities' },
  { id: 'house_rules', label: 'House Rules' },
  { id: 'booking_rules', label: 'Booking Rules' },
]

const EMPTY_SETTINGS: BookingSiteSettingsRecord = {
  whatsappNumber: '',
  buildingAddress: '',
  buildingName: '',
  sameDayBookingEnabled: true,
  sameDayBookingCutoffHour: 18,
  advanceBookingLimitMonths: 12,
  nonRefundableDiscountPct: '10.00',
}

export function BookingSettingsPage() {
  const [tab, setTab] = useState<Tab>('general')
  const [settingsDraft, setSettingsDraft] = useState<BookingSiteSettingsRecord>(EMPTY_SETTINGS)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  const [amenities, setAmenities] = useState<AmenityRecord[]>([])
  const [houseRules, setHouseRules] = useState<HouseRuleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [newAmenityName, setNewAmenityName] = useState('')
  const [newAmenityIcon, setNewAmenityIcon] = useState('')
  const [savingAmenity, setSavingAmenity] = useState(false)

  const [newRuleText, setNewRuleText] = useState('')
  const [savingRule, setSavingRule] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [s, a, h] = await Promise.all([
        fetchPmsBookingSettings(),
        fetchAmenities(),
        fetchHouseRules(),
      ])
      setSettingsDraft(s)
      setAmenities(a)
      setHouseRules(h)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load booking settings.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault()
    setSavingSettings(true)
    try {
      const updated = await updatePmsBookingSettings(settingsDraft)
      setSettingsDraft(updated)
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleAddAmenity(e: FormEvent) {
    e.preventDefault()
    if (!newAmenityName.trim()) return
    setSavingAmenity(true)
    try {
      const a = await createAmenity({
        name: newAmenityName.trim(),
        icon: newAmenityIcon.trim(),
        sortOrder: amenities.length,
      })
      setAmenities((prev) => [...prev, a])
      setNewAmenityName('')
      setNewAmenityIcon('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add amenity.')
    } finally {
      setSavingAmenity(false)
    }
  }

  async function handleDeleteAmenity(id: string) {
    try {
      await deleteAmenity(id)
      setAmenities((prev) => prev.filter((a) => a.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete amenity.')
    }
  }

  async function handleAddRule(e: FormEvent) {
    e.preventDefault()
    if (!newRuleText.trim()) return
    setSavingRule(true)
    try {
      const r = await createHouseRule({
        text: newRuleText.trim(),
        sortOrder: houseRules.length,
        active: true,
      })
      setHouseRules((prev) => [...prev, r])
      setNewRuleText('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add house rule.')
    } finally {
      setSavingRule(false)
    }
  }

  async function toggleRuleActive(id: string, active: boolean) {
    try {
      await updateHouseRule(id, { active })
      setHouseRules((prev) => prev.map((r) => (r.id === id ? { ...r, active } : r)))
    } catch {
      /* silent */
    }
  }

  async function handleDeleteRule(id: string) {
    try {
      await deleteHouseRule(id)
      setHouseRules((prev) => prev.filter((r) => r.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete house rule.')
    }
  }

  async function handleUpdateAmenityIcon(id: string, icon: string) {
    try {
      await updateAmenity(id, { icon })
      setAmenities((prev) => prev.map((a) => (a.id === id ? { ...a, icon } : a)))
    } catch {
      /* silent */
    }
  }

  return (
    <div className="booking-settings-page">
      <h2>Booking Settings</h2>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <div className="bs-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`bs-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="bs-panel">
          <div className="bs-panel-header">
            <h3>General Info</h3>
          </div>
          <form onSubmit={handleSaveSettings} className="bs-form">
            <div className="bs-form-group">
              <label>Building name</label>
              <input
                type="text"
                value={settingsDraft.buildingName}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, buildingName: e.target.value }))}
                placeholder="AirStay Residences"
              />
            </div>
            <div className="bs-form-group">
              <label>WhatsApp number</label>
              <input
                type="text"
                value={settingsDraft.whatsappNumber}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, whatsappNumber: e.target.value }))}
                placeholder="+38344000000"
              />
            </div>
            <div className="bs-form-group bs-form-full">
              <label>Building address</label>
              <textarea
                value={settingsDraft.buildingAddress}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, buildingAddress: e.target.value }))}
                placeholder="Rr. Dëshmorët e Kombit, Prishtinë 10000"
              />
            </div>
            <div className="bs-form-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingSettings}>
                {savingSettings ? 'Saving…' : settingsSaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === 'amenities' && (
        <div className="bs-panel">
          <div className="bs-panel-header">
            <h3>Amenities</h3>
          </div>
          {loading ? (
            <div className="bs-empty">Loading…</div>
          ) : amenities.length === 0 ? (
            <div className="bs-empty">No amenities yet. Add some below.</div>
          ) : (
            <div className="bs-list">
              {amenities.map((a) => (
                <div key={a.id} className="bs-list-row">
                  <GripVertical size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                  <div className="row-main">
                    <strong>{a.name}</strong>
                    {a.icon && <span className="row-sub" style={{ marginLeft: 8 }}>icon: {a.icon}</span>}
                  </div>
                  <input
                    type="text"
                    placeholder="icon name"
                    value={a.icon}
                    onChange={(e) => handleUpdateAmenityIcon(a.id, e.target.value)}
                    style={{ width: 120, height: 30, border: '1px solid var(--border)', borderRadius: 4, padding: '0 6px', fontSize: '0.82rem', background: 'var(--bg-panel)', color: 'var(--text-primary)' }}
                  />
                  <button className="btn btn-sm btn-outline" onClick={() => handleDeleteAmenity(a.id)} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleAddAmenity} className="bs-add-form">
            <input
              type="text"
              placeholder="Amenity name"
              value={newAmenityName}
              onChange={(e) => setNewAmenityName(e.target.value)}
              style={{ flex: 1, minWidth: 140 }}
            />
            <input
              type="text"
              placeholder="Lucide icon (optional)"
              value={newAmenityIcon}
              onChange={(e) => setNewAmenityIcon(e.target.value)}
              style={{ width: 160 }}
            />
            <button type="submit" className="btn btn-sm btn-primary" disabled={savingAmenity || !newAmenityName.trim()}>
              <Plus size={13} /> Add
            </button>
          </form>
        </div>
      )}

      {tab === 'house_rules' && (
        <div className="bs-panel">
          <div className="bs-panel-header">
            <h3>House Rules</h3>
          </div>
          {loading ? (
            <div className="bs-empty">Loading…</div>
          ) : houseRules.length === 0 ? (
            <div className="bs-empty">No house rules yet.</div>
          ) : (
            <div className="bs-list">
              {houseRules.map((rule) => (
                <div key={rule.id} className="bs-list-row">
                  <GripVertical size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                  <div className="row-main">{rule.text}</div>
                  <label className="bs-active-toggle">
                    <input
                      type="checkbox"
                      checked={rule.active}
                      onChange={(e) => toggleRuleActive(rule.id, e.target.checked)}
                    />
                    Active
                  </label>
                  <button className="btn btn-sm btn-outline" onClick={() => handleDeleteRule(rule.id)} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleAddRule} className="bs-add-form">
            <input
              type="text"
              placeholder="Rule text"
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            <button type="submit" className="btn btn-sm btn-primary" disabled={savingRule || !newRuleText.trim()}>
              <Plus size={13} /> Add rule
            </button>
          </form>
        </div>
      )}

      {tab === 'booking_rules' && (
        <div className="bs-panel">
          <div className="bs-panel-header">
            <h3>Booking Rules</h3>
          </div>
          <form onSubmit={handleSaveSettings} className="bs-form">
            <div className="bs-form-group bs-form-full">
              <label className="bs-check-row">
                <input
                  type="checkbox"
                  checked={settingsDraft.sameDayBookingEnabled}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, sameDayBookingEnabled: e.target.checked }))}
                />
                Allow same-day bookings
              </label>
            </div>
            {settingsDraft.sameDayBookingEnabled && (
              <div className="bs-form-group">
                <label>Same-day cutoff hour (0–23)</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={settingsDraft.sameDayBookingCutoffHour}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, sameDayBookingCutoffHour: Number(e.target.value) }))}
                />
              </div>
            )}
            <div className="bs-form-group">
              <label>Advance booking limit (months)</label>
              <input
                type="number"
                min={1}
                max={36}
                value={settingsDraft.advanceBookingLimitMonths}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, advanceBookingLimitMonths: Number(e.target.value) }))}
              />
            </div>
            <div className="bs-form-group">
              <label>Non-refundable discount (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={settingsDraft.nonRefundableDiscountPct}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, nonRefundableDiscountPct: e.target.value }))}
              />
            </div>
            <div className="bs-form-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingSettings}>
                {savingSettings ? 'Saving…' : settingsSaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
