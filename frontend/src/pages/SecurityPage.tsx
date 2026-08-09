import { SecurityCard } from '../features/company/SecurityCard'

// Every signed-in user can manage their own second factor here, whatever
// their role — account security is not an admin-only concern.
export function SecurityPage() {
  return (
    <section className="admin-panel-page">
      <div className="admin-panel-header">
        <div>
          <p className="eyebrow">Account</p>
          <h2>My security</h2>
        </div>
      </div>
      <SecurityCard />
    </section>
  )
}
