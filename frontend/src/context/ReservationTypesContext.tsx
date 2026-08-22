// The reservation types, loaded once and published to CSS.
//
// Colour used to be hard-coded in seven places — the calendar stylesheet, three
// separate badge families, the dashboard, the reports palette, and a dict in
// Python — which disagreed with each other. Now one table owns it: this
// provider fetches the types and writes each one's shades onto `:root` as
// custom properties, so every existing selector keeps its name and only its
// values move. Recolouring a type in the Admin Panel repaints the whole app.
//
// Staff-only. The public booking site never draws a reservation type, so the
// fetch waits for a session rather than firing a guaranteed 401 at every guest.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchReservationTypes } from '../api/reservationTypes'
import { useAuth } from '../auth/AuthContext'
import type { ReservationTypeRecord } from '../types/domain'
import { paletteVariables, typeStylesheet } from '../utils/reservationTypeColors'

type ReservationTypesValue = {
  types: ReservationTypeRecord[]
  loading: boolean
  /** Re-fetch from the server — call after an edit in the Admin Panel. */
  reload: () => Promise<void>
  /** Publish an edited list immediately, so a colour change is instant. */
  publish: (rows: ReservationTypeRecord[]) => void
  /** Label for a stored `reservationType` value, falling back to the raw code. */
  labelFor: (code: string) => string
}

const ReservationTypesContext = createContext<ReservationTypesValue | null>(null)

const STYLE_ELEMENT_ID = 'reservation-type-colors'

function applyToRoot(rows: ReservationTypeRecord[]) {
  // Custom properties, for anything that wants to reference a type's colour
  // directly (charts, inline swatches).
  const root = document.documentElement
  for (const row of rows) {
    for (const [name, value] of Object.entries(paletteVariables(row.code, row.color))) {
      root.style.setProperty(name, value)
    }
  }

  // …and the rules themselves. These have to be generated: a type an admin
  // invented has a class name no checked-in stylesheet could contain.
  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ELEMENT_ID
    document.head.append(style)
  }
  style.textContent = typeStylesheet(rows)
}

export function ReservationTypesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [types, setTypes] = useState<ReservationTypeRecord[]>([])
  const [loading, setLoading] = useState(false)

  const publish = useCallback((rows: ReservationTypeRecord[]) => {
    setTypes(rows)
    applyToRoot(rows)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      publish(await fetchReservationTypes())
    } catch {
      // The stylesheets carry sane defaults, so a failed load leaves the app
      // looking like it always did rather than unstyled.
    } finally {
      setLoading(false)
    }
  }, [publish])

  useEffect(() => {
    if (!user.isAuthenticated) return
    reload()
  }, [user.isAuthenticated, reload])

  const value = useMemo<ReservationTypesValue>(
    () => ({
      types,
      loading,
      reload,
      publish,
      labelFor: (code) => types.find((row) => row.code === code)?.label ?? code,
    }),
    [types, loading, reload, publish],
  )

  return (
    <ReservationTypesContext.Provider value={value}>{children}</ReservationTypesContext.Provider>
  )
}

export function useReservationTypes() {
  const value = useContext(ReservationTypesContext)
  if (!value) {
    throw new Error('useReservationTypes must be used inside a ReservationTypesProvider')
  }
  return value
}
