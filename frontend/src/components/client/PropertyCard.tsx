import type { PublicProperty } from '../../api/bookingApi'
import styles from './PropertyCard.module.css'

interface Props {
  property: PublicProperty
}

export default function PropertyCard({ property }: Props) {
  const photo = property.photos[0]
  return (
    <div className={styles.card} role="button" tabIndex={0}>
      <div className={styles.imgWrap}>
        {photo ? (
          <img src={photo} alt={property.name} className={styles.img} loading="lazy" />
        ) : (
          <div className={styles.imgPlaceholder}>
            <span>🏠</span>
          </div>
        )}
      </div>

      <div className={styles.body}>
        <h3 className={styles.name}>{property.name}</h3>
        <p className={styles.meta}>
          {property.apartmentType}
          {property.maxGuests ? ` · up to ${property.maxGuests} guests` : ''}
        </p>

        <div className={styles.footer}>
          <div className={styles.priceBlock}>
            <span className={styles.price}>€{Math.round(Number(property.basePriceEur))}</span>
            <span className={styles.priceSub}> / night</span>
          </div>
          <span className={styles.bookLabel}>View →</span>
        </div>
      </div>
    </div>
  )
}
