import type { ClientProperty } from '../../pages/client/clientData'
import styles from './PropertyCard.module.css'

interface Props {
  property: ClientProperty
}

// Visual-only placeholder card. Clicking does nothing yet.
export default function PropertyCard({ property }: Props) {
  return (
    <div className={styles.card} role="button" tabIndex={0}>
      <div className={styles.imgWrap}>
        <div className={styles.imgPlaceholder}>
          <span>{property.emoji}</span>
        </div>
        {property.discountPct ? (
          <span className={styles.discountBadge}>{property.discountPct}% off</span>
        ) : null}
      </div>

      <div className={styles.body}>
        <h3 className={styles.name}>{property.name}</h3>
        <p className={styles.meta}>
          {property.bedrooms} {property.bedrooms === 1 ? 'bedroom' : 'bedrooms'} · up to {property.maxGuests} guests
        </p>

        <div className={styles.footer}>
          <div className={styles.priceBlock}>
            <span className={styles.price}>€{property.pricePerNight}</span>
            <span className={styles.priceSub}> / night</span>
          </div>
          <span className={styles.bookLabel}>View →</span>
        </div>
      </div>
    </div>
  )
}
