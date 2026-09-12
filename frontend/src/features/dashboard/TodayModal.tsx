// Today's arrivals and departures, over the dashboard.
//
// It began as its own page and did not earn one: it is the first thing looked
// at in the morning and nothing else, so it opens over the dashboard and
// closes again. Guests already mid-stay are not here - nobody greets them and
// nobody cleans for them.
//
// The cards are the reservation cards, photo and all, because staff already
// know how to read those. The two things done with the answer - ring the
// guest, and send them their arrival details - are one tap each.

import { CalendarCheck, CalendarX, ChevronLeft, ChevronRight, Phone, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchDoorCodes } from '../../api/codes'
import { fetchProperties } from '../../api/pmsApi'
import { fetchReservations } from '../../api/reservations'
import { CopyButton } from '../../components/shared/CopyButton'
import type { DoorCodeRecord, PropertyListing, ReservationRecord } from '../../types/domain'
import { formatDisplayDate, toDateInputValue } from '../../utils/date'
import { buildArrivalMessage, buildDepartureMessage, splitDay } from './dailyOverview'
import './todayModal.css'

function shiftDay(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toDateInputValue(date)
}

export function TodayModal({ onClose }: { onClose: () => void }) {
  const today = toDateInputValue(new Date())
  const [day, setDay] = useState(today)
  const [rows, setRows] = useState<ReservationRecord[]>([])
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [codes, setCodes] = useState<DoorCodeRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  // The apartment photo and the door codes come from elsewhere, so they are
  // fetched once rather than per day change.
  useEffect(() => {
    Promise.all([fetchProperties(), fetchDoorCodes()])
      .then(([props, doorCodes]) => {
        setProperties(props)
        setCodes(doorCodes)
      })
      .catch(() => {
        // A missing photo or code is a poorer card, not a broken page.
      })
  }, [])

  useEffect(() => {
    let ignore = false
    setStatus('loading')
    fetchReservations({ day })
      .then((data) => {
        if (ignore) return
        setRows(data)
        setStatus('ready')
      })
      .catch((caught: unknown) => {
        if (ignore) return
        setError(caught instanceof Error ? caught.message : 'Could not load the day.')
        setStatus('error')
      })
    return () => {
      ignore = true
    }
  }, [day])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { arrivals, departures } = useMemo(() => splitDay(rows, day), [rows, day])

  const photoFor = (propertyId: string) =>
    properties.find((property) => property.id === propertyId)?.photoUrl ?? ''
  const codeFor = (propertyId: string) =>
    codes.find((code) => code.propertyId === propertyId)

  const groups = [
    { key: 'arrivals' as const, title: 'Arriving', icon: CalendarCheck, rows: arrivals },
    { key: 'departures' as const, title: 'Leaving', icon: CalendarX, rows: departures },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        aria-modal="true"
        className="modal form-modal form-modal--wide today-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="form-modal-head">
          <div>
            <h3>{day === today ? 'Today' : formatDisplayDate(day)}</h3>
            <p>
              {arrivals.length} arriving · {departures.length} leaving
            </p>
          </div>
          <button aria-label="Close" className="form-modal-close" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="today-nav">
          <button
            aria-label="Previous day"
            className="btn btn-sm btn-outline"
            type="button"
            onClick={() => setDay((current) => shiftDay(current, -1))}
          >
            <ChevronLeft size={15} />
          </button>
          <input
            aria-label="Day"
            type="date"
            value={day}
            onChange={(event) => event.target.value && setDay(event.target.value)}
          />
          <button
            aria-label="Next day"
            className="btn btn-sm btn-outline"
            type="button"
            onClick={() => setDay((current) => shiftDay(current, 1))}
          >
            <ChevronRight size={15} />
          </button>
          {day !== today && (
            <button className="btn btn-sm btn-outline" type="button" onClick={() => setDay(today)}>
              Today
            </button>
          )}
        </div>

        {status === 'loading' && <p className="list-empty">Loading the day…</p>}
        {status === 'error' && <p className="form-error">{error}</p>}

        {status === 'ready' && (
          <div className="today-groups">
            {groups.map(({ key, title, icon: Icon, rows: groupRows }) => (
              <section className={`today-group today-group--${key}`} key={key}>
                <header>
                  <Icon size={16} />
                  <h4>{title}</h4>
                  <span className="today-count">{groupRows.length}</span>
                </header>

                {groupRows.length === 0 ? (
                  <p className="today-empty">
                    {key === 'arrivals' ? 'Nobody arriving.' : 'Nobody leaving.'}
                  </p>
                ) : (
                  <div className="search-res-card-list">
                    {groupRows.map((row) => {
                      const photo = photoFor(row.propertyId)
                      return (
                        <div className="search-res-card" key={row.id}>
                          {photo ? (
                            <img alt="" className="search-res-card-photo" src={photo} />
                          ) : (
                            <span className="search-res-card-photo search-res-card-photo-placeholder" />
                          )}

                          <div className="search-res-card-main">
                            <strong className="search-res-card-guest">
                              {row.guestName || row.guestPhone || 'Guest'}
                            </strong>
                            {row.guestPhone && (
                              <span className="search-res-card-phone">{row.guestPhone}</span>
                            )}
                            <span className="search-res-card-apt">{row.apartment}</span>
                          </div>

                          <div className="search-res-card-dates">
                            <span>{formatDisplayDate(row.checkIn)}</span>
                            <span className="today-card-arrow">→</span>
                            <span>{formatDisplayDate(row.checkOut)}</span>
                            {row.guestsCount ? (
                              <small className="today-card-guests">
                                <Users size={11} /> {row.guestsCount}
                              </small>
                            ) : null}
                          </div>

                          <div className="today-card-actions">
                            {row.guestPhone ? (
                              <>
                                <a
                                  className="btn btn-sm btn-outline"
                                  href={`tel:${row.guestPhone.replace(/\s/g, '')}`}
                                >
                                  <Phone size={13} />
                                  Call
                                </a>
                                <CopyButton
                                  label="Phone"
                                  title={`Copy ${row.guestPhone}`}
                                  value={row.guestPhone}
                                />
                              </>
                            ) : (
                              <small className="today-no-phone">No phone on file</small>
                            )}
                            <CopyButton
                              label="Message"
                              title={
                                key === 'arrivals'
                                  ? 'Copy the arrival message, with the door code and wifi'
                                  : 'Copy a check-out message'
                              }
                              value={
                                key === 'arrivals'
                                  ? buildArrivalMessage(row, codeFor(row.propertyId))
                                  : buildDepartureMessage(row)
                              }
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
