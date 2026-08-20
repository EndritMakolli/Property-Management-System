import { apiGet, apiSend } from './client'

export type MessageScenario =
  | 'available'
  | 'split_stay'
  | 'alternative_dates'
  | 'no_availability'

export type MessageTemplateRecord = {
  scenario: MessageScenario
  label: string
  bodySq: string
  bodyEn: string
}

export type DraftLanguage = 'sq' | 'en'

/** What the availability page already worked out on screen.
 *
 *  The page owns the availability walk — it computes free apartments, the
 *  split-stay plan and the next free window to render them — so the draft is
 *  built from those same facts rather than a second implementation of them.
 *  The backend decides which scenario wins and owns all the money. */
export type DraftRequest = {
  checkIn: string
  checkOut: string
  guests?: number
  language: DraftLanguage
  /** Bedroom counts free for the whole stay. */
  freeTypes: number[]
  /** Whether a split-stay plan covers the requested dates. */
  splitCovers: boolean
  /** Earliest later date something is free, or '' if nothing is. */
  nextFree: string
  /** The dates a split stay moves the guest, in order. Empty when there is
   *  no move. A plan may have more than one, so this is a list. */
  changeDate?: string[]
  /** Bedroom counts of the apartments in the split plan. The reply is quoted
   *  at the cheapest of them — any nights in a larger apartment are a free
   *  upgrade rather than a surcharge to explain. */
  splitTypes?: number[]
  /** Set only when staff pick a scenario by hand. */
  scenario?: MessageScenario
  guestName?: string
}

export type DraftResponse = {
  scenario: MessageScenario
  /** What the search implied, before any manual override. */
  detected: MessageScenario
  language: DraftLanguage
  body: string
  /** Placeholders left visible because nothing filled them. */
  unresolved: string[]
  /** No template written for this scenario in this language yet. */
  empty: boolean
}

export async function fetchMessageTemplates() {
  const data = await apiGet<{ messageTemplates: MessageTemplateRecord[] }>(
    '/api/message-templates/',
  )
  return data.messageTemplates
}

export async function updateMessageTemplate(
  scenario: MessageScenario,
  payload: { bodySq?: string; bodyEn?: string },
) {
  const data = await apiSend<{ messageTemplate: MessageTemplateRecord }>(
    `/api/message-templates/${scenario}/`,
    'PATCH',
    payload,
  )
  return data.messageTemplate
}

export async function fetchMessageDraft(request: DraftRequest) {
  return apiSend<DraftResponse>('/api/message-drafts/', 'POST', request)
}
