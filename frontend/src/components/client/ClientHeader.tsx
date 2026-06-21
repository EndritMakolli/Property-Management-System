import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import styles from './ClientHeader.module.css'

// Dead-placeholder nav links + a working "Staff Login" that enters the PMS.
export default function ClientHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  const isHome = useLocation().pathname === '/'

  return (
    <header className={isHome ? styles.header : styles.headerSolid}>
      <div className={styles.inner}>
        <Link to="/" className={styles.logo}>
          AirStay<span className={styles.logoDot}>com</span>
        </Link>

        <nav className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`}>
          <button className={styles.navLink} onClick={() => setMenuOpen(false)}>
            Browse apartments
          </button>
          <button className={styles.navLink} onClick={() => setMenuOpen(false)}>
            Support
          </button>
          <button className={styles.navLink} onClick={() => setMenuOpen(false)}>
            My reservation
          </button>
          <button
            className={styles.navLogin}
            onClick={() => { navigate('/login'); setMenuOpen(false) }}
          >
            Staff Login
          </button>
        </nav>

        <button className={styles.cta} onClick={() => navigate('/login')}>
          Staff Login →
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
