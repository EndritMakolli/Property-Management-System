import { Building2, ImageUp, Save } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  fetchCompanyProfile,
  saveCompanyProfileWithLogo,
  type CompanyProfilePayload,
  type CompanyProfileRecord,
} from '../../api/company'

const MapPicker = lazy(() => import('../../components/shared/MapPicker'))

const emptyForm: CompanyProfilePayload = {
  name: '',
  address: '',
  city: '',
  country: 'Kosovo',
  taxId: '',
  vatId: '',
  email: '',
  phone: '',
  website: '',
  bankName: '',
  iban: '',
  swift: '',
  bankName2: '',
  iban2: '',
  swift2: '',
  latitude: '',
  longitude: '',
  defaultTaxRate: '18.00',
}

function isProfileEmpty(profile: CompanyProfileRecord) {
  return !profile.name && !profile.address && !profile.taxId && !profile.email
}

// Unsaved edits survive navigation: every keystroke is kept in this browser
// until "Save company profile" stores it on the server.
const DRAFT_KEY = 'pms.company.draft'

function loadDraft(): CompanyProfilePayload | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as CompanyProfilePayload) : null
  } catch {
    return null
  }
}

// One-time convenience: the old localStorage-only invoice tool stored a company
// profile in this browser; offer it as a starting point.
function legacyLocalCompany(): CompanyProfilePayload | null {
  try {
    const raw = window.localStorage.getItem('pms.inv2.company')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.name) return null
    return {
      name: parsed.name ?? '',
      address: parsed.address ?? '',
      city: parsed.city ?? '',
      country: parsed.country ?? 'Kosovo',
      taxId: parsed.taxId ?? '',
      vatId: parsed.vatId ?? '',
      email: parsed.email ?? '',
      phone: parsed.phone ?? '',
      website: parsed.website ?? '',
      bankName: parsed.bankName ?? '',
      iban: parsed.iban ?? '',
      swift: parsed.swift ?? '',
      bankName2: parsed.bankName2 ?? '',
      iban2: parsed.iban2 ?? '',
      swift2: parsed.swift2 ?? '',
    }
  } catch {
    return null
  }
}

export function CompanyProfileCard() {
  const [form, setForm] = useState<CompanyProfilePayload>(emptyForm)
  const [logoUrl, setLogoUrl] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')
  const [removeLogo, setRemoveLogo] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [legacyOffer, setLegacyOffer] = useState<CompanyProfilePayload | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let ignore = false
    fetchCompanyProfile()
      .then((profile) => {
        if (ignore) return
        const draft = loadDraft()
        setForm({
          ...emptyForm,
          ...profile,
          latitude: profile.latitude,
          longitude: profile.longitude,
          ...(draft ?? {}),
        })
        setDraftRestored(Boolean(draft))
        setLogoUrl(profile.logoUrl)
        setMapOpen(Boolean(draft?.latitude ?? profile.latitude) && Boolean(draft?.longitude ?? profile.longitude))
        if (isProfileEmpty(profile) && !draft) {
          setLegacyOffer(legacyLocalCompany())
        }
        setStatus('ready')
      })
      .catch(() => {
        if (!ignore) setStatus('error')
      })
    return () => {
      ignore = true
    }
  }, [])

  function update(patch: CompanyProfilePayload) {
    setForm((current) => {
      const next = { ...current, ...patch }
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next))
      } catch {
        /* draft persistence is best-effort */
      }
      return next
    })
  }

  async function discardDraft() {
    window.localStorage.removeItem(DRAFT_KEY)
    setDraftRestored(false)
    try {
      const profile = await fetchCompanyProfile()
      setForm({ ...emptyForm, ...profile })
      setLogoUrl(profile.logoUrl)
      setMapOpen(Boolean(profile.latitude && profile.longitude))
    } catch {
      /* keep current values if the reload fails */
    }
  }

  function handleLogoChange() {
    const file = logoInputRef.current?.files?.[0]
    if (file) {
      setLogoFile(file)
      setRemoveLogo(false)
      setLogoPreview(URL.createObjectURL(file))
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setNote('')
    setError('')
    try {
      const saved = await saveCompanyProfileWithLogo(form, logoFile, removeLogo)
      setForm({ ...emptyForm, ...saved })
      setLogoUrl(saved.logoUrl)
      setLogoFile(null)
      setLogoPreview('')
      setRemoveLogo(false)
      window.localStorage.removeItem(DRAFT_KEY)
      setDraftRestored(false)
      setNote('Company profile saved.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the company profile.')
    } finally {
      setSaving(false)
    }
  }

  const shownLogo = removeLogo ? '' : logoPreview || logoUrl

  return (
    <article className="panel admin-company-card">
      <h3>
        <Building2 size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Company profile
      </h3>
      <p className="admin-backup-desc">
        Shown on your invoices (name, tax numbers, bank accounts, logo) and — name and location only — on the
        public booking site.
      </p>

      {status === 'loading' && <p className="listings-message">Loading company profile…</p>}
      {status === 'error' && <p className="form-error">Could not load the company profile.</p>}
      {note && <p className="admin-panel-message">{note}</p>}
      {error && <p className="form-error">{error}</p>}

      {draftRestored && (
        <p className="form-success-note">
          Restored what you wrote last time (not saved to the server yet — press “Save company profile” to keep
          it).{' '}
          <button className="pill-button" type="button" onClick={discardDraft}>
            Discard draft
          </button>
        </p>
      )}

      {legacyOffer && (
        <p className="form-success-note">
          Found company details saved in this browser by the old invoice tool.{' '}
          <button
            className="pill-button"
            type="button"
            onClick={() => {
              update(legacyOffer)
              setLegacyOffer(null)
            }}
          >
            Load them
          </button>
        </p>
      )}

      {status === 'ready' && (
        <form className="form-modal admin-company-form" onSubmit={save} style={{ boxShadow: 'none', width: '100%' }}>
          <div className="form-section">
            <p className="form-section-title">Logo</p>
            <label className="dropzone" style={{ padding: 16 }}>
              {shownLogo ? (
                <span className="dropzone-preview">
                  <img src={shownLogo} alt="Company logo" />
                </span>
              ) : (
                <>
                  <ImageUp size={20} />
                  <span>Click to upload your logo (shown on invoices)</span>
                </>
              )}
              <input accept="image/*" ref={logoInputRef} type="file" onChange={handleLogoChange} />
            </label>
            {(logoUrl || logoPreview) && !removeLogo && (
              <button className="pill-button" style={{ marginTop: 8 }} type="button" onClick={() => setRemoveLogo(true)}>
                Remove logo
              </button>
            )}
            {removeLogo && <p className="form-field-hint">Logo will be removed when you save.</p>}
          </div>

          <div className="form-section">
            <p className="form-section-title">Identity</p>
            <div className="form-grid">
              <label className="form-field wide">
                Company name
                <input type="text" value={form.name ?? ''} onChange={(e) => update({ name: e.target.value })} />
              </label>
              <label className="form-field">
                Business no. (NUI)
                <input type="text" value={form.taxId ?? ''} onChange={(e) => update({ taxId: e.target.value })} />
              </label>
              <label className="form-field">
                VAT no.
                <input type="text" value={form.vatId ?? ''} onChange={(e) => update({ vatId: e.target.value })} />
              </label>
              <label className="form-field">
                Default VAT rate (%)
                <input
                  min="0"
                  max="100"
                  step="0.01"
                  type="number"
                  value={form.defaultTaxRate ?? ''}
                  onChange={(e) => update({ defaultTaxRate: e.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Contact</p>
            <div className="form-grid">
              <label className="form-field">
                Email
                <input type="email" value={form.email ?? ''} onChange={(e) => update({ email: e.target.value })} />
              </label>
              <label className="form-field">
                Phone
                <input type="tel" value={form.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} />
              </label>
              <label className="form-field wide">
                Website
                <input
                  type="text"
                  placeholder="https://…"
                  value={form.website ?? ''}
                  onChange={(e) => update({ website: e.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <p className="form-section-title">Address & location</p>
            <div className="form-grid">
              <label className="form-field wide">
                Address
                <input type="text" value={form.address ?? ''} onChange={(e) => update({ address: e.target.value })} />
              </label>
              <label className="form-field">
                City
                <input type="text" value={form.city ?? ''} onChange={(e) => update({ city: e.target.value })} />
              </label>
              <label className="form-field">
                Country
                <input type="text" value={form.country ?? ''} onChange={(e) => update({ country: e.target.value })} />
              </label>
            </div>
            <div className="pill-toggle-group" style={{ marginTop: 10 }}>
              <button
                className={`pill-button${mapOpen ? ' accent' : ''}`}
                type="button"
                onClick={() => setMapOpen((current) => !current)}
              >
                {mapOpen ? 'Hide map' : 'Pin location on map'}
              </button>
              {form.latitude && form.longitude && (
                <span className="returning-badge">
                  📍 {Number(form.latitude).toFixed(4)}, {Number(form.longitude).toFixed(4)}
                </span>
              )}
            </div>
            {mapOpen && (
              <div style={{ marginTop: 10 }}>
                <Suspense fallback={<p className="listings-message">Loading map…</p>}>
                  <MapPicker
                    latitude={form.latitude ?? ''}
                    longitude={form.longitude ?? ''}
                    onChange={(lat, lng) => update({ latitude: lat, longitude: lng })}
                  />
                </Suspense>
              </div>
            )}
          </div>

          <div className="form-section">
            <p className="form-section-title">Bank accounts</p>
            <div className="form-grid">
              <label className="form-field">
                Bank 1 name
                <input type="text" value={form.bankName ?? ''} onChange={(e) => update({ bankName: e.target.value })} />
              </label>
              <label className="form-field">
                IBAN 1
                <input type="text" value={form.iban ?? ''} onChange={(e) => update({ iban: e.target.value })} />
              </label>
              <label className="form-field">
                SWIFT 1
                <input type="text" value={form.swift ?? ''} onChange={(e) => update({ swift: e.target.value })} />
              </label>
              <label className="form-field">
                Bank 2 name
                <input
                  type="text"
                  value={form.bankName2 ?? ''}
                  onChange={(e) => update({ bankName2: e.target.value })}
                />
              </label>
              <label className="form-field">
                IBAN 2
                <input type="text" value={form.iban2 ?? ''} onChange={(e) => update({ iban2: e.target.value })} />
              </label>
              <label className="form-field">
                SWIFT 2
                <input type="text" value={form.swift2 ?? ''} onChange={(e) => update({ swift2: e.target.value })} />
              </label>
            </div>
          </div>

          <button className="pill-button accent" disabled={saving} type="submit">
            <Save size={15} /> {saving ? 'Saving…' : 'Save company profile'}
          </button>
        </form>
      )}
    </article>
  )
}
