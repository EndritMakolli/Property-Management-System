import { Link } from 'react-router-dom'
import styles from './ClientFooter.module.css'

// Footer links are dead placeholders for now (except Home + Staff Login).
export default function ClientFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <div className={styles.brandLogo}>
              AirStay<span className={styles.brandDot}>com</span>
            </div>
            <p className={styles.brandTagline}>
              Premium apartments for short and long stays — book directly for the best rates.
            </p>
            <div className={styles.socials}>
              {['f', 'tw', 'ig'].map((s) => (
                <a key={s} href="#" className={styles.socialIcon}>{s}</a>
              ))}
            </div>
          </div>

          <div className={styles.col}>
            <h4>Explore</h4>
            <div className={styles.links}>
              <Link className={styles.link} to="/">Home</Link>
              <button className={styles.link}>Browse apartments</button>
              <button className={styles.link}>Check availability</button>
            </div>
          </div>

          <div className={styles.col}>
            <h4>Support</h4>
            <div className={styles.links}>
              <button className={styles.link}>Contact us</button>
              <button className={styles.link}>Cancellation policy</button>
              <button className={styles.link}>House rules</button>
              <button className={styles.link}>FAQ</button>
            </div>
          </div>

          <div className={styles.col}>
            <h4>Staff</h4>
            <div className={styles.links}>
              <Link className={styles.link} to="/login">Staff Login</Link>
              <button className={styles.link}>Help center</button>
              <button className={styles.link}>Report an issue</button>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <span>© {year} AirStay. All rights reserved.</span>
          <span>Best rates guaranteed when you book directly with us.</span>
        </div>
      </div>
    </footer>
  )
}
