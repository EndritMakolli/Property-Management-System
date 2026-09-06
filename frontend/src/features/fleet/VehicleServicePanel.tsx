// The fleet: what each vehicle is, and when it next needs attention.
//
// Two jobs on one page, deliberately. The identity fields — brand, type,
// chassis, plates — exist because the hire agreement has to name *this* car
// rather than a model, and they are edited in the same place as the service
// record so a new vehicle is set up in one sitting.
//
// The alerts beside each card come from the server's `vehicle_alerts`, the same
// function the notifications bell calls, so the two can never disagree about
// whether a car is overdue.

import { AlertTriangle, CalendarClock, Car, Check, ChevronDown, Gauge, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  fetchVehicleService,
  updateVehicleService,
  type VehicleServiceRecord,
} from '../../api/fleet'
import { DateInput } from '../../components/shared/DateInput'
import { formatDisplayDate } from '../../utils/date'

export function VehicleServicePanel() {
  const [vehicles, setVehicles] = useState<VehicleServiceRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    fetchVehicleService()
      .then((rows) => {
        setVehicles(rows)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  const counts = useMemo(() => {
    let overdue = 0
    let soon = 0
    let unset = 0
    for (const vehicle of vehicles) {
      const worst = vehicle.alerts[0]?.severity
      if (worst === 'overdue') overdue += 1
      else if (worst === 'soon') soon += 1
      else if (worst === 'info') unset += 1
    }
    return { overdue, soon, unset, ok: vehicles.length - overdue - soon - unset }
  }, [vehicles])

  if (status === 'loading') return <p className="list-empty">Loading vehicles…</p>
  if (status === 'error') return <p className="form-error">Could not load the vehicles.</p>

  return (
    <>
      <div className="fleet-summary">
        <SummaryTile label="Vehicles" value={vehicles.length} tone="plain" />
        <SummaryTile label="Overdue" value={counts.overdue} tone="overdue" />
        <SummaryTile label="Due soon" value={counts.soon} tone="soon" />
        <SummaryTile label="Up to date" value={counts.ok} tone="ok" />
        {counts.unset > 0 && <SummaryTile label="Not set up" value={counts.unset} tone="plain" />}
      </div>

      <div className="fleet-grid">
        {vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            onSaved={(saved) =>
              setVehicles((current) => current.map((v) => (v.id === saved.id ? saved : v)))
            }
          />
        ))}
      </div>
    </>
  )
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'plain' | 'overdue' | 'soon' | 'ok'
}) {
  return (
    <div className={`fleet-tile fleet-tile--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function VehicleCard({
  vehicle,
  onSaved,
}: {
  vehicle: VehicleServiceRecord
  onSaved: (saved: VehicleServiceRecord) => void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    brand: vehicle.brand,
    model: vehicle.model,
    chassisNumber: vehicle.chassisNumber,
    licencePlate: vehicle.licencePlate,
    allowedCountries: vehicle.allowedCountries,
    lastServiceDate: vehicle.lastServiceDate,
    lastServiceKm: vehicle.lastServiceKm?.toString() ?? '',
    currentKm: vehicle.currentKm?.toString() ?? '',
    serviceIntervalKm: vehicle.serviceIntervalKm?.toString() ?? '',
    serviceIntervalMonths: vehicle.serviceIntervalMonths?.toString() ?? '',
    serviceWarningDays: vehicle.serviceWarningDays?.toString() ?? '',
    serviceWarningKm: vehicle.serviceWarningKm?.toString() ?? '',
    registrationWarningDays: vehicle.registrationWarningDays?.toString() ?? '',
    registrationDate: vehicle.registrationDate,
    registrationExpiry: vehicle.registrationExpiry,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function update(patch: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...patch }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const asNumber = (value: string) => (value.trim() === '' ? null : Number(value))
      onSaved(
        await updateVehicleService(vehicle.id, {
          ...form,
          lastServiceKm: asNumber(form.lastServiceKm),
          currentKm: asNumber(form.currentKm),
          serviceIntervalKm: asNumber(form.serviceIntervalKm),
          serviceIntervalMonths: asNumber(form.serviceIntervalMonths),
          serviceWarningDays: asNumber(form.serviceWarningDays),
          serviceWarningKm: asNumber(form.serviceWarningKm),
          registrationWarningDays: asNumber(form.registrationWarningDays),
        }),
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the vehicle.')
    } finally {
      setSaving(false)
    }
  }

  const worst = vehicle.alerts.find((alert) => alert.severity !== 'info')
  const driven =
    vehicle.currentKm != null && vehicle.lastServiceKm != null
      ? vehicle.currentKm - vehicle.lastServiceKm
      : null
  // How much of the service interval has been used up, for the bar.
  const usedPct =
    driven != null && vehicle.serviceIntervalKm
      ? Math.min(100, Math.round((driven / vehicle.serviceIntervalKm) * 100))
      : null

  return (
    <section className={`panel fleet-card${worst ? ` fleet-card--${worst.severity}` : ''}`}>
      <button className="fleet-card-head" type="button" onClick={() => setOpen((o) => !o)}>
        {vehicle.photoUrl ? (
          <img alt="" className="fleet-card-photo" src={vehicle.photoUrl} />
        ) : (
          <span className="fleet-card-photo fleet-card-photo--empty">
            <Car size={20} />
          </span>
        )}

        <span className="fleet-card-identity">
          <strong>{vehicle.name}</strong>
          <span>
            {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'No brand recorded'}
            {vehicle.licencePlate ? ` · ${vehicle.licencePlate}` : ''}
          </span>
        </span>

        <span className="fleet-card-facts">
          <span title="Registration expiry">
            <CalendarClock size={13} />
            {vehicle.registrationExpiry ? formatDisplayDate(vehicle.registrationExpiry) : '—'}
          </span>
          <span title="Odometer">
            <Gauge size={13} />
            {vehicle.currentKm != null ? `${vehicle.currentKm.toLocaleString()} km` : '—'}
          </span>
        </span>

        <ChevronDown className={`fleet-card-chevron${open ? ' open' : ''}`} size={18} />
      </button>

      {usedPct != null && (
        <div className="fleet-progress" title={`${driven?.toLocaleString()} km since the last service`}>
          <div
            className={`fleet-progress-fill${usedPct >= 100 ? ' over' : ''}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      )}

      {vehicle.alerts
        .filter((alert) => alert.severity !== 'info')
        .map((alert) => (
          <p className={`vehicle-alert vehicle-alert--${alert.severity}`} key={alert.kind}>
            {alert.kind.startsWith('registration') ? (
              <CalendarClock size={14} />
            ) : (
              <AlertTriangle size={14} />
            )}
            {alert.message}
          </p>
        ))}

      {open && (
        <div className="fleet-card-body form-surface">
          {error && <p className="form-error">{error}</p>}

          <p className="form-section-title">Vehicle details</p>
          <p className="fleet-hint">These print on the hire agreement, so they name this car.</p>
          <div className="form-grid">
            <label className="form-field">
              Brand
              <input
                placeholder="Kia"
                type="text"
                value={form.brand}
                onChange={(event) => update({ brand: event.target.value })}
              />
            </label>
            <label className="form-field">
              Type
              <input
                placeholder="Stonic"
                type="text"
                value={form.model}
                onChange={(event) => update({ model: event.target.value })}
              />
            </label>
            <label className="form-field">
              Chassis number
              <input
                placeholder="KNADA814BRT920569"
                type="text"
                value={form.chassisNumber}
                onChange={(event) => update({ chassisNumber: event.target.value })}
              />
            </label>
            <label className="form-field">
              Licence plates
              <input
                placeholder="01-695-CZ"
                type="text"
                value={form.licencePlate}
                onChange={(event) => update({ licencePlate: event.target.value })}
              />
            </label>
            <label className="form-field wide">
              Can be driven in
              <input
                placeholder="Kosovo, Albania, Montenegro, Macedonia"
                type="text"
                value={form.allowedCountries}
                onChange={(event) => update({ allowedCountries: event.target.value })}
              />
            </label>
          </div>

          <p className="form-section-title">Service</p>
          <div className="form-grid">
            <label className="form-field">
              Last service
              <DateInput
                value={form.lastServiceDate}
                onChange={(value) => update({ lastServiceDate: value })}
              />
            </label>
            <label className="form-field">
              Kilometres then
              <span className="input-with-unit">
                <input
                  inputMode="numeric"
                  placeholder="0"
                  type="text"
                  value={form.lastServiceKm}
                  onChange={(event) => update({ lastServiceKm: event.target.value })}
                />
                <em>km</em>
              </span>
            </label>
            <label className="form-field">
              Kilometres now
              <span className="input-with-unit">
                <input
                  inputMode="numeric"
                  placeholder="0"
                  type="text"
                  value={form.currentKm}
                  onChange={(event) => update({ currentKm: event.target.value })}
                />
                <em>km</em>
              </span>
            </label>
            <label className="form-field">
              Service interval
              <span className="input-with-unit">
                <input
                  inputMode="numeric"
                  placeholder="10000"
                  type="text"
                  value={form.serviceIntervalKm}
                  onChange={(event) => update({ serviceIntervalKm: event.target.value })}
                />
                <em>km</em>
              </span>
            </label>
            <label className="form-field">
              Service interval
              <span className="input-with-unit">
                <input
                  inputMode="numeric"
                  placeholder="12"
                  type="text"
                  value={form.serviceIntervalMonths}
                  onChange={(event) => update({ serviceIntervalMonths: event.target.value })}
                />
                <em>months</em>
              </span>
            </label>
          </div>

          <p className="fleet-hint fleet-hint--spaced">
            Warn me before a service is due — by days, by kilometres, or both.
            Zero means tell me only once it is overdue.
          </p>
          <div className="form-grid">
            <label className="form-field">
              Warn me
              <span className="input-with-unit input-with-unit--wide">
                <input
                  inputMode="numeric"
                  placeholder="30"
                  type="text"
                  value={form.serviceWarningDays}
                  onChange={(event) => update({ serviceWarningDays: event.target.value })}
                />
                <em>days before</em>
              </span>
            </label>
            <label className="form-field">
              Warn me
              <span className="input-with-unit input-with-unit--wide">
                <input
                  inputMode="numeric"
                  placeholder="800"
                  type="text"
                  value={form.serviceWarningKm}
                  onChange={(event) => update({ serviceWarningKm: event.target.value })}
                />
                <em>km before</em>
              </span>
            </label>
          </div>

          <p className="form-section-title">Registration</p>
          <div className="form-grid">
            <label className="form-field">
              Registered on
              <DateInput
                value={form.registrationDate}
                onChange={(value) => update({ registrationDate: value })}
              />
            </label>
            <label className="form-field">
              Expires
              <DateInput
                value={form.registrationExpiry}
                onChange={(value) => update({ registrationExpiry: value })}
              />
            </label>
            <label className="form-field">
              Warn me
              <span className="input-with-unit input-with-unit--wide">
                <input
                  inputMode="numeric"
                  placeholder="30"
                  type="text"
                  value={form.registrationWarningDays}
                  onChange={(event) => update({ registrationWarningDays: event.target.value })}
                />
                <em>days before</em>
              </span>
            </label>
          </div>

          <div className="fleet-card-actions">
            <button className="primary-button" disabled={saving} type="button" onClick={save}>
              {saved ? <Check size={15} /> : <Save size={15} />}
              {saved ? 'Saved' : saving ? 'Saving…' : 'Save vehicle'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
