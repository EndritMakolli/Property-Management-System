// The account page's footer, built from the main site's own palette so the two
// read as one product.
//
// Deliberately NOT mounted in ClientLayout: that shell is the home page's too,
// and the home page is left exactly as it is. This is used by the account page
// alone.
//
// Only real destinations here. A footer full of links that go nowhere is the
// same problem the dead header buttons were.

import { Link, useNavigate } from 'react-router-dom'
import { useGuestAuth } from '../../auth/GuestAuthContext'
import { useBuildingLocation } from './useBuildingLocation'
import styles from './ClientFooter.module.css'

export default function ClientFooter() {
  const navigate = useNavigate()
  const { account } = useGuestAuth()
  const building = useBuildingLocation()

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brandCol}>
          <Link className={styles.brand} to="/">
            AirStay<span className={styles.dot}>com</span>
          </Link>
          {building.label && <p className={styles.where}>{building.label}</p>}
        </div>

        <nav className={styles.links}>
          <Link to="/">Home</Link>
          <Link to="/map">Map</Link>
          <button
            type="button"
            onClick={() => navigate(account.isAuthenticated ? '/account' : '/login')}
          >
            {account.isAuthenticated ? 'My account' : 'Login'}
          </button>
          <button type="button" onClick={() => navigate('/staff-login')}>
            Staff
          </button>
        </nav>
      </div>

      <p className={styles.legal}>© {new Date().getFullYear()} AirStay</p>
    </footer>
  )
}
