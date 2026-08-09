import { ShieldCheck, Save } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { fetchMySecurity, updateMySecurity, type UserSecurity } from '../../api/pmsApi'
import { useAuth } from '../../auth/AuthContext'

// Lets the signed-in user manage their own two-step verification, so each
// account controls where its login codes are delivered.
export function SecurityCard() {
  const { user } = useAuth()
  const [security, setSecurity] = useState<UserSecurity | null>(null)
  const [email, setEmail] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')

  // Turning 2FA off, or moving it to a different inbox, weakens the account —
  // the backend requires the password for those, so ask for it up front.
  const weakening =
    !!security?.twoFactorActive && (!enabled || email.trim() !== security.twoFactorEmail)

  useEffect(() => {
    let ignore = false
    fetchMySecurity()
      .then((data) => {
        if (ignore) return
        setSecurity(data)
        setEmail(data.twoFactorEmail)
        setEnabled(data.twoFactorEnabled)
        setStatus('ready')
      })
      .catch((caught) => {
        if (ignore) return
        setStatus('error')
        setError(caught instanceof Error ? caught.message : 'Could not load security settings.')
      })
    return () => { ignore = true }
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const saved = await updateMySecurity({
        twoFactorEmail: email.trim(),
        twoFactorEnabled: enabled,
        ...(weakening ? { currentPassword } : {}),
      })
      setSecurity(saved)
      setEmail(saved.twoFactorEmail)
      setEnabled(saved.twoFactorEnabled)
      setCurrentPassword('')
      setMessage(
        saved.twoFactorActive
          ? 'Two-step verification is on. Your next sign-in will ask for an emailed code.'
          : 'Two-step verification is off.',
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save security settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="panel">
      <h3>
        <ShieldCheck size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Two-step verification
      </h3>
      <p className="admin-backup-desc">
        Protect <strong>{user.username}</strong> with a second factor. When it is on, signing in
        needs your password <em>and</em> a 6-digit code emailed to the address below. The code
        expires in 10 minutes and can be used once.
      </p>

      {status === 'loading' && <p className="list-empty">Loading…</p>}
      {error && <p className="form-error">{error}</p>}
      {message && <p className="admin-panel-message">{message}</p>}

      {status !== 'loading' && (
        <form onSubmit={save}>
          <div className="form-grid">
            <label className="form-field wide">
              Verification email
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </div>
          <label className="form-checkbox-row" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Require an emailed code when I sign in
          </label>
          {security?.twoFactorActive && (
            <p className="client-doc-hint">
              Currently sending codes to {security.emailHint}.
            </p>
          )}
          {weakening && (
            <div className="form-grid" style={{ marginTop: 10 }}>
              <label className="form-field wide">
                Confirm your password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Your current password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <small className="client-doc-hint">
                  Required because this change reduces your account&apos;s protection.
                </small>
              </label>
            </div>
          )}
          <div className="admin-backup-actions" style={{ marginTop: 12 }}>
            <button className="primary-button" type="submit" disabled={saving}>
              <Save size={16} />
              {saving ? 'Saving…' : 'Save security settings'}
            </button>
          </div>
        </form>
      )}
    </article>
  )
}
