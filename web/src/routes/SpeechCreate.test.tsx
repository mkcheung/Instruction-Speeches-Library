import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SpeechCreate from '@/routes/SpeechCreate'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

const EXISTING_SPEECH = {
  id: 7,
  ulid: '01OLD',
  title: 'Attempt 1',
  description: null,
  delivered_on: null,
  change_note: null,
  created_at: '2026-01-01T00:00:00Z',
  primary_video: { id: 1, kind: 'video', status: 'ready', failure_code: null, duration_seconds: '10.0' },
}

describe('SpeechCreate', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/api/speeches') && !url.match(/\/\d/)) {
        // GET /api/speeches (list, for the supersedes picker) — matching on
        // "no numeric PATH SEGMENT" rather than "no digit anywhere" is not
        // a style nit: the default API_URL (src/lib/api.ts, used whenever
        // VITE_API_URL isn't set — e.g. in CI, which has no .env file)
        // falls back to http://localhost:8000, and "8000" itself contains
        // digits. A bare /\d/ check misfires against the origin, not just
        // a would-be /api/speeches/7 path, and only "worked" locally
        // because .env sets a digit-free VITE_API_URL that masked it.
        return jsonResponse({ speeches: [EXISTING_SPEECH], meta: { current_page: 1, last_page: 1, total: 1 } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('blocks submission client-side when supersedes is picked but change_note is left blank', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderWithProviders(<SpeechCreate />, { route: '/speeches/new' })

    await user.type(screen.getByLabelText(/title/i), 'Attempt 2')

    await waitFor(() => expect(screen.getByLabelText(/replaces an earlier attempt/i)).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText(/replaces an earlier attempt/i), '7')

    await user.click(screen.getByRole('button', { name: /continue to upload/i }))

    expect(await screen.findByText(/say what changed/i)).toBeInTheDocument()
  })

  it('does not require a supersedes picker or change_note for a first attempt', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/api/speeches') && !url.match(/\/\d/)) {
        return jsonResponse({ speeches: [], meta: { current_page: 1, last_page: 1, total: 0 } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<SpeechCreate />, { route: '/speeches/new' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByLabelText(/replaces an earlier attempt/i)).not.toBeInTheDocument()
  })
})
