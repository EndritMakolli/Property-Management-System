// Shared HTTP client for every API module.
//
// All requests go through apiFetch so two cross-cutting concerns are handled
// in exactly one place:
//   1. `credentials: 'include'` - session cookies survive a cross-origin
//      deployment (separate API domain), not just the dev proxy.
//   2. Django CSRF - unsafe methods automatically send the `X-CSRFToken`
//      header read from the `csrftoken` cookie (set by /api/auth/me/).

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

// On a cross-domain deployment the browser won't expose the backend's csrftoken
// cookie to this page's JS, so the backend returns the token in auth responses
// and we cache it here to send as the X-CSRFToken header. Falls back to the
// cookie for same-origin (local dev).
let csrfToken = ''
export function setCsrfToken(token: string) {
  csrfToken = token || ''
}

function apiUrl(input: string): string {
  if (!API_BASE_URL || /^https?:\/\//i.test(input)) {
    return input
  }

  return `${API_BASE_URL}${input.startsWith('/') ? input : `/${input}`}`
}

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

export function activePlatform(): string {
  return localStorage.getItem('pms.platform') || 'airstay'
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (UNSAFE_METHODS.has(method)) {
    const token = csrfToken || readCookie('csrftoken')
    if (token) headers.set('X-CSRFToken', token)
  }
  return fetch(apiUrl(input), { ...init, headers, credentials: 'include' })
}

export function formatApiError(error: unknown) {
  if (!error) {
    return 'The request could not be completed.'
  }
  if (typeof error === 'string') {
    return error
  }
  if (Array.isArray(error)) {
    return error.join(' ')
  }
  if (typeof error === 'object') {
    return Object.values(error)
      .flat()
      .join(' ')
  }

  return 'The request could not be completed.'
}

export async function readJson<T>(response: Response): Promise<T> {
  const rawBody = await response.text()
  const data = rawBody ? (JSON.parse(rawBody) as T) : ({} as T)

  if (!response.ok) {
    throw new Error(formatApiError((data as { error?: unknown }).error || response.statusText))
  }

  return data
}

export async function apiGet<T>(url: string): Promise<T> {
  return readJson<T>(await apiFetch(url))
}

export async function apiSend<T>(url: string, method: 'POST' | 'PATCH' | 'PUT', body?: unknown): Promise<T> {
  return readJson<T>(
    await apiFetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
}

export async function apiForm<T>(url: string, method: 'POST' | 'PATCH', form: FormData): Promise<T> {
  return readJson<T>(await apiFetch(url, { method, body: form }))
}

export async function apiDelete(url: string, errorMessage: string): Promise<void> {
  const response = await apiFetch(url, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(errorMessage)
  }
}
