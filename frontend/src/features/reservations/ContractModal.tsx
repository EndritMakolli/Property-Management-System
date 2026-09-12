// The signed agreement for one reservation, laid out like the paper form.
//
// Modelled on the operator's own template: a centred letterhead, then black
// section bars over bordered label/value tables, then the terms in a box, then
// a signature line. The car diagram is a placeholder to mark damage on at
// handover — the paper form has one and staff draw on it.
//
// The terms come from the editable template; everything around them is laid
// out from structured data, so changing a clause never means retyping the
// company's address or the chassis number.

import { AlertTriangle, Pencil, Printer, RotateCcw, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatApiError } from '../../api/client'
import {
  fetchReservationContract,
  resetReservationContract,
  saveReservationContract,
  type RenderedContract,
} from '../../api/contracts'
import { CopyButton } from '../../components/shared/CopyButton'
import { CarDiagram } from './CarDiagram'
import { fmtDate } from '../invoices/invoiceModel'
import type { ReservationRecord } from '../../types/domain'

type ContractModalProps = {
  reservation: ReservationRecord
  onClose: () => void
}

const COPY = {
  en: {
    vehicleTitle: 'Contract for renting or leasing a car',
    apartmentTitle: 'Contract for renting an apartment',
    brand: 'Brand',
    type: 'Type',
    chassis: 'Chassis number',
    plates: 'Licence Plates',
    pickUp: 'Pick-up time',
    ret: 'Return time',
    date: 'Date',
    time: 'Time',
    drivenIn: 'Can be driven in',
    apartment: 'Apartment',
    address: 'Address',
    arrival: 'Arrival',
    departure: 'Departure',
    guests: 'Guests',
    nights: 'Nights',
    total: 'Total',
    secondDriver: "Second Driver's Information",
    occupants: 'Guest Information',
    name: 'Name',
    surname: 'Surname',
    idNumber: 'ID number',
    passport: 'Passport number',
    licence: 'Driving licence number',
    issuedBy: 'Issued by',
    addressRow: 'Address',
    contact: 'Contact number',
    signature: 'Signature',
    terms: 'Terms and Conditions',
  },
  sq: {
    vehicleTitle: 'Kontratë për qira të automjetit',
    apartmentTitle: 'Kontratë për qira të banesës',
    brand: 'Marka',
    type: 'Tipi',
    chassis: 'Numri i shasisë',
    plates: 'Targat',
    pickUp: 'Koha e marrjes',
    ret: 'Koha e kthimit',
    date: 'Data',
    time: 'Ora',
    drivenIn: 'Mund të vozitet në',
    apartment: 'Banesa',
    address: 'Adresa',
    arrival: 'Ardhja',
    departure: 'Largimi',
    guests: 'Persona',
    nights: 'Netë',
    total: 'Totali',
    secondDriver: 'Të dhënat e shoferit të dytë',
    occupants: 'Të dhënat e mysafirit',
    name: 'Emri',
    surname: 'Mbiemri',
    idNumber: 'Nr. i letërnjoftimit',
    passport: 'Nr. i pasaportës',
    licence: 'Nr. i patentë shoferit',
    issuedBy: 'Lëshuar nga',
    addressRow: 'Adresa',
    contact: 'Numri i kontaktit',
    signature: 'Nënshkrimi',
    terms: 'Kushtet e kontratës',
  },
}

/** Split a full name into first and surname for the two-column form. */
function splitName(full: string): [string, string] {
  const parts = (full || '').trim().split(/\s+/)
  if (parts.length <= 1) return [parts[0] ?? '', '']
  return [parts[0], parts.slice(1).join(' ')]
}

export function ContractModal({ reservation, onClose }: ContractModalProps) {
  const [language, setLanguage] = useState<'sq' | 'en'>('en')
  const [contract, setContract] = useState<RenderedContract | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  // What is being typed. Held apart from `contract` and written back only on
  // Save, so closing the modal by accident cannot overwrite a contract that
  // was already agreed.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [licenceNumber, setLicenceNumber] = useState('')
  const [deposit, setDeposit] = useState('')
  const [saving, setSaving] = useState(false)

  function adopt(rendered: RenderedContract) {
    setContract(rendered)
    setDraft(rendered.body)
    setIdNumber(rendered.client.idNumber ?? '')
    setLicenceNumber(rendered.fields?.licenceNumber ?? '')
    setDeposit(rendered.fields?.deposit ?? '')
  }

  useEffect(() => {
    let ignore = false
    setStatus('loading')
    setEditing(false)
    fetchReservationContract(reservation.id, language)
      .then((rendered) => {
        if (ignore) return
        adopt(rendered)
        setStatus('ready')
      })
      .catch((caught: unknown) => {
        if (ignore) return
        setError(caught instanceof Error ? caught.message : 'Could not build the contract.')
        setStatus('error')
      })
    return () => {
      ignore = true
    }
  }, [reservation.id, language])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      adopt(
        await saveReservationContract(reservation.id, language, {
          body: draft,
          clientIdNumber: idNumber,
          licenceNumber,
          deposit,
        }),
      )
      setEditing(false)
    } catch (caught) {
      setError(formatApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    // The one action here that typing again cannot undo, so it asks first.
    if (!window.confirm('Discard this edited contract and go back to the template?')) return
    setSaving(true)
    setError('')
    try {
      await resetReservationContract(reservation.id, language)
      adopt(await fetchReservationContract(reservation.id, language))
      setEditing(false)
    } catch (caught) {
      setError(formatApiError(caught))
    } finally {
      setSaving(false)
    }
  }

  const t = COPY[contract?.language ?? language]
  const isVehicle = contract?.subject.isVehicle ?? false
  const [firstName, surname] = splitName(contract?.client.name ?? '')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal form-modal form-modal--wide contract-modal"
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="form-modal-head contract-chrome">
          <div>
            <h3>Contract — {reservation.guestName || 'Guest'}</h3>
            <p>
              {reservation.apartment} · {reservation.checkIn} → {reservation.checkOut}
            </p>
          </div>
          <button className="form-modal-close" aria-label="Close" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="contract-toolbar contract-chrome">
          <div className="contract-lang">
            <button
              className={`view-tab${language === 'en' ? ' active' : ''}`}
              type="button"
              onClick={() => setLanguage('en')}
            >
              English
            </button>
            <button
              className={`view-tab${language === 'sq' ? ' active' : ''}`}
              type="button"
              onClick={() => setLanguage('sq')}
            >
              Shqip
            </button>
          </div>
          <CopyButton label="Copy terms" value={contract?.body ?? ''} title="Copy the contract terms" />
          {editing ? (
            <>
              <button className="pill-button" disabled={saving} type="button" onClick={handleSave}>
                <Save size={14} /> {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button
                className="pill-button"
                disabled={saving}
                type="button"
                onClick={() => {
                  setDraft(contract?.body ?? '')
                  setEditing(false)
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="pill-button"
              disabled={!contract}
              type="button"
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          {contract?.isDraft && !editing && (
            <button className="pill-button" disabled={saving} type="button" onClick={handleReset}>
              <RotateCcw size={14} /> Reset to template
            </button>
          )}
          <button
            className="pill-button"
            disabled={!contract || editing}
            type="button"
            onClick={() => window.print()}
          >
            <Printer size={14} /> Print / Save PDF
          </button>
        </div>

        {contract?.isDraft && (
          <p className="contract-draft-note contract-chrome">
            Edited contract{contract.updatedBy ? ` — last saved by ${contract.updatedBy}` : ''}. The
            template is no longer applied to it.
          </p>
        )}

        {status === 'loading' && <p className="list-empty contract-chrome">Building the contract…</p>}
        {status === 'error' && <p className="form-error contract-chrome">{error}</p>}

        {contract && (
          <>
            {contract.unresolved.length > 0 && (
              <p className="contract-unresolved contract-chrome">
                <AlertTriangle size={14} /> Fill in by hand before signing:{' '}
                <strong>{contract.unresolved.join(', ')}</strong>
              </p>
            )}

            <article className="contract-doc">
              {/* Letterhead */}
              <header className="cdoc-head">
                {contract.company.logoUrl && (
                  <img alt="" className="cdoc-logo" src={contract.company.logoUrl} />
                )}
                <div className="cdoc-head-text">
                  <h1>{contract.company.name || 'Company name'}</h1>
                  <p>Apartment &amp; Car Rental Company</p>
                  {contract.company.phone && <p>{contract.company.phone}</p>}
                </div>
              </header>

              {/* What is being let */}
              <div className="cdoc-block">
                <div className="cdoc-bar">{isVehicle ? t.vehicleTitle : t.apartmentTitle}</div>
                <div className={`cdoc-subject${isVehicle ? ' with-diagram' : ''}`}>
                  {isVehicle && (
                    <div className="cdoc-diagram">
                      <CarDiagram />
                      <small>Mark any existing damage</small>
                    </div>
                  )}
                  <table className="cdoc-table">
                    <tbody>
                      {isVehicle ? (
                        <>
                          <tr>
                            <th>{t.brand}</th>
                            <td colSpan={2}>{contract.subject.brand || '—'}</td>
                          </tr>
                          <tr>
                            <th>{t.type}</th>
                            <td colSpan={2}>{contract.subject.model || contract.subject.name}</td>
                          </tr>
                          <tr>
                            <th>{t.chassis}</th>
                            <td colSpan={2}>{contract.subject.chassisNumber || '—'}</td>
                          </tr>
                          <tr>
                            <th>{t.plates}</th>
                            <td colSpan={2}>{contract.subject.licencePlate || '—'}</td>
                          </tr>
                          <tr>
                            <th rowSpan={2}>{t.pickUp}</th>
                            <td className="cdoc-sub">{t.date}</td>
                            <td className="cdoc-sub">{t.time}</td>
                          </tr>
                          <tr>
                            <td>{fmtDate(contract.subject.checkIn)}</td>
                            <td className="cdoc-fill" />
                          </tr>
                          <tr>
                            <th rowSpan={2}>{t.ret}</th>
                            <td className="cdoc-sub">{t.date}</td>
                            <td className="cdoc-sub">{t.time}</td>
                          </tr>
                          <tr>
                            <td>{fmtDate(contract.subject.checkOut)}</td>
                            <td className="cdoc-fill" />
                          </tr>
                          <tr>
                            <th>{t.drivenIn}</th>
                            <td colSpan={2}>{contract.subject.allowedCountries || '—'}</td>
                          </tr>
                          <tr>
                            <th>{t.total}</th>
                            <td colSpan={2}>EUR {contract.subject.totalPriceEur}</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <th>{t.apartment}</th>
                            <td>{contract.subject.name}</td>
                          </tr>
                          <tr>
                            <th>{t.address}</th>
                            <td>{contract.subject.address || '—'}</td>
                          </tr>
                          <tr>
                            <th>{t.arrival}</th>
                            <td>{fmtDate(contract.subject.checkIn)}</td>
                          </tr>
                          <tr>
                            <th>{t.departure}</th>
                            <td>{fmtDate(contract.subject.checkOut)}</td>
                          </tr>
                          <tr>
                            <th>{t.nights}</th>
                            <td>{contract.subject.nights}</td>
                          </tr>
                          <tr>
                            <th>{t.guests}</th>
                            <td>{contract.subject.guests}</td>
                          </tr>
                          <tr>
                            <th>{t.total}</th>
                            <td>EUR {contract.subject.totalPriceEur}</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* The people. Column one is filled in from the reservation;
                  column two is blank for a second driver or guest to complete
                  by hand at the desk. */}
              <div className="cdoc-block">
                <div className="cdoc-bar">{isVehicle ? t.secondDriver : t.occupants}</div>
                <table className="cdoc-table cdoc-people">
                  <tbody>
                    <tr>
                      <th>{t.name}</th>
                      <td>{firstName}</td>
                      <th>{t.name}</th>
                      <td className="cdoc-fill" />
                    </tr>
                    <tr>
                      <th>{t.surname}</th>
                      <td>{surname}</td>
                      <th>{t.surname}</th>
                      <td className="cdoc-fill" />
                    </tr>
                    <tr>
                      <th>{t.idNumber}</th>
                      <td>{contract.client.idNumber || ''}</td>
                      <th>{t.passport}</th>
                      <td className="cdoc-fill" />
                    </tr>
                    {isVehicle && (
                      <tr>
                        <th>{t.licence}</th>
                        <td className="cdoc-fill" />
                        <th>{t.licence}</th>
                        <td className="cdoc-fill" />
                      </tr>
                    )}
                    <tr>
                      <th>{t.issuedBy}</th>
                      <td className="cdoc-fill" />
                      <th>{t.issuedBy}</th>
                      <td className="cdoc-fill" />
                    </tr>
                    <tr>
                      <th>{t.addressRow}</th>
                      <td className="cdoc-fill" />
                      <th>{t.addressRow}</th>
                      <td className="cdoc-fill" />
                    </tr>
                    <tr>
                      <th>{t.contact}</th>
                      <td>{contract.client.phone || ''}</td>
                      <th>{t.contact}</th>
                      <td className="cdoc-fill" />
                    </tr>
                    <tr>
                      <th>{t.signature}</th>
                      <td className="cdoc-fill cdoc-sign" />
                      <th>{t.signature}</th>
                      <td className="cdoc-fill cdoc-sign" />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* The terms. Read as a document, edited in the same box — so
                  what is typed is exactly what prints. */}
              <div className="cdoc-block">
                <div className="cdoc-bar">{t.terms}</div>
                {editing ? (
                  <textarea
                    aria-label={t.terms}
                    className="cdoc-terms cdoc-terms-edit"
                    rows={18}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                ) : (
                  <div className="cdoc-terms">{contract.body}</div>
                )}
              </div>

              {editing && (
                <div className="cdoc-block cdoc-handfill">
                  <div className="cdoc-bar">Filled in at the desk</div>
                  <div className="cdoc-handfill-grid">
                    <label>
                      {t.idNumber}
                      <input
                        type="text"
                        value={idNumber}
                        onChange={(event) => setIdNumber(event.target.value)}
                      />
                    </label>
                    <label>
                      {t.licence}
                      <input
                        type="text"
                        value={licenceNumber}
                        onChange={(event) => setLicenceNumber(event.target.value)}
                      />
                    </label>
                    <label>
                      Deposit
                      <input
                        type="text"
                        value={deposit}
                        onChange={(event) => setDeposit(event.target.value)}
                      />
                    </label>
                  </div>
                </div>
              )}

              <p className="cdoc-signature">
                {t.signature} <span className="cdoc-signature-line" />
              </p>
            </article>
          </>
        )}
      </section>
    </div>
  )
}
