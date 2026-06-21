import { Building2, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { BLANK_COMPANY, COMPANY_FIELDS, type CompanyProfile } from './invoiceModel'

type CompanyProfilePanelProps = {
  company: CompanyProfile
  onSave: (profile: CompanyProfile) => void
}

export function CompanyProfilePanel({ company, onSave }: CompanyProfilePanelProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CompanyProfile>(BLANK_COMPANY)

  return (
    <div className="inv-company-panel panel">
      <button
        className="inv-company-toggle"
        type="button"
        onClick={() => { setDraft({ ...company }); setOpen(o => !o) }}
      >
        <Building2 size={16} />
        <span>My Company Profile</span>
        {company.name
          ? <span className="inv-company-name-tag">{company.name}</span>
          : <span className="inv-company-hint">Not configured — add your details to appear on invoices</span>}
        {open ? <ChevronUp size={15} className="inv-company-chevron" /> : <ChevronDown size={15} className="inv-company-chevron" />}
      </button>

      {open && (
        <div className="inv-company-body">
          <p className="inv-section-label">Company Details</p>
          <div className="inv-grid-4">
            {COMPANY_FIELDS.map(([field, label, wide]) => (
              <label key={field} className={wide ? 'inv-span-2' : ''}>
                {label}
                <input
                  value={draft[field]}
                  placeholder={label}
                  onChange={e => setDraft(p => ({ ...p, [field]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <p className="inv-section-label inv-mt">Bank Account 1</p>
          <div className="inv-grid-3">
            {([ ['bankName','Bank Name'], ['iban','IBAN'], ['swift','SWIFT / BIC'] ] as [keyof CompanyProfile, string][]).map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  value={draft[field]}
                  placeholder={label}
                  onChange={e => setDraft(p => ({ ...p, [field]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <p className="inv-section-label inv-mt">
            Bank Account 2 <span className="inv-optional">(optional)</span>
          </p>
          <div className="inv-grid-3">
            {([ ['bankName2','Bank Name'], ['iban2','IBAN'], ['swift2','SWIFT / BIC'] ] as [keyof CompanyProfile, string][]).map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  value={draft[field]}
                  placeholder={label}
                  onChange={e => setDraft(p => ({ ...p, [field]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <div className="inv-company-actions">
            <button className="btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" type="button" onClick={() => { onSave(draft); setOpen(false) }}>
              <Check size={15} /> Save Profile
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
