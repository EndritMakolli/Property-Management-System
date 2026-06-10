import { useState, type FormEvent } from 'react'
import styles from './SearchForm.module.css'

interface Props {
  inline?: boolean
}

// Visual-only placeholder. Submitting does nothing yet — wiring comes later.
export default function SearchForm({ inline = false }: Props) {
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [guests, setGuests] = useState(2)

  const today = new Date().toISOString().split('T')[0]

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Dead placeholder — no navigation yet.
  }

  const cls = inline ? styles.formInline : styles.form

  return (
    <form className={cls} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label}>Check-in</label>
        <input
          type="date"
          className={styles.input}
          value={checkIn}
          min={today}
          onChange={(e) => setCheckIn(e.target.value)}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.field}>
        <label className={styles.label}>Check-out</label>
        <input
          type="date"
          className={styles.input}
          value={checkOut}
          min={checkIn || today}
          onChange={(e) => setCheckOut(e.target.value)}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.field}>
        <label className={styles.label}>Guests</label>
        <select
          className={styles.input}
          value={guests}
          onChange={(e) => setGuests(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>
          ))}
        </select>
      </div>

      <button type="submit" className={styles.searchBtn}>
        Search
      </button>
    </form>
  )
}
