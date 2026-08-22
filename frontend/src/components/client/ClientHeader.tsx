import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import styles from './ClientHeader.module.css'
import { useGuestAuth } from '../../auth/GuestAuthContext'

// A Map link and a Login that opens the guest portal — or the account page
// when someone is already signed in. Staff reach their own sign-in from a link
// on the guest page.
export default function ClientHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { account } = useGuestAuth()
  const navigate = useNavigate()
  const isHome = useLocation().pathname === '/'

  return (
    <header className={isHome ? styles.header : styles.headerSolid}>
      <div className={styles.inner}>
        <Link to="/" className={styles.logo}>
          AirStay<span className={styles.logoDot}>com</span>
        </Link>

        <nav className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`}>
          <button
            className={styles.navLink}
            onClick={() => { navigate('/map'); setMenuOpen(false) }}
          >
            Map
          </button>
          <button
            className={styles.navLogin}
            onClick={() => { navigate(account.isAuthenticated ? '/account' : '/login'); setMenuOpen(false) }}
          >
            {account.isAuthenticated ? 'My account' : 'Login'}
          </button>
        </nav>

        <button
          className={styles.cta}
          onClick={() => navigate(account.isAuthenticated ? '/account' : '/login')}
        >
          {account.isAuthenticated ? 'My account' : 'Login'} →
        </button>

        <button
          className={styles.menuToggle}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <span /><span /><span />
        </button>
      </div>
    </header>
  )
}
