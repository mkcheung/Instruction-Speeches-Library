import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CaptionEditor } from '@/components/caption/CaptionEditor'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/** `fetchBaseQuery` calls `fetch` with a pre-built `Request` for
 * state-changing requests, not the `(url, init)` two-arg form. */
function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

async function bodyOf(input: RequestInfo | URL): Promise<Record<string, unknown>> {
  if (!(input instanceof Request)) return {}
  try {
    return (await input.clone().json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nToast masters'

describe('CaptionEditor', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('renders the parsed cue list once captions are ready', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/captions')) {
        return jsonResponse({ captions: { status: 'ready', vtt: VTT, failure_code: null, updated_at: null , asset_id: null } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<CaptionEditor speechId={1} onSeek={vi.fn()} />)

    expect(await screen.findByText('Toast masters')).toBeInTheDocument()
  })

  it('clicking a line edits it, and clicking the timecode seeks instead', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/captions')) {
        return jsonResponse({ captions: { status: 'ready', vtt: VTT, failure_code: null, updated_at: null , asset_id: null } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const onSeek = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<CaptionEditor speechId={1} onSeek={onSeek} />)

    await screen.findByText('Toast masters')

    await user.click(screen.getByRole('button', { name: /seek to/i }))
    expect(onSeek).toHaveBeenCalledWith(1)

    await user.click(screen.getByTestId('caption-cue-cue-0'))
    expect(screen.getByTestId('caption-cue-input-cue-0')).toBeInTheDocument()
  })

  it('editing a line and blurring saves the fix via a PUT and shows a one-word autosave state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/captions') && methodOf(input, init) === 'PUT') {
        const body = await bodyOf(input)
        expect(body.vtt).toContain('Toastmasters')
        return jsonResponse({ captions: { status: 'ready', vtt: body.vtt, failure_code: null, updated_at: null , asset_id: null } })
      }
      if (url.endsWith('/captions')) {
        return jsonResponse({ captions: { status: 'ready', vtt: VTT, failure_code: null, updated_at: null , asset_id: null } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<CaptionEditor speechId={1} onSeek={vi.fn()} />)

    await screen.findByText('Toast masters')
    await user.click(screen.getByTestId('caption-cue-cue-0'))

    const input = screen.getByTestId('caption-cue-input-cue-0')
    await user.clear(input)
    await user.type(input, 'Toastmasters')
    await user.tab() // blur

    // The mock's PUT branch above already asserts the sent body contains
    // the fix ("Toastmasters") — reaching `saved` proves that branch ran
    // (a thrown assertion inside the mock would surface as a rejected
    // fetch, landing on `offline` instead).
    await waitFor(() => expect(screen.getByTestId('caption-autosave-state')).toHaveTextContent('saved'))
  })

  it('shows the honest empty state when no captions asset exists yet', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/captions')) {
        return jsonResponse({ captions: { status: 'unavailable', vtt: null, failure_code: null, updated_at: null , asset_id: null } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<CaptionEditor speechId={1} onSeek={vi.fn()} />)

    expect(await screen.findByText(/no captions have been generated/i)).toBeInTheDocument()
  })

  it('retrying a failed caption job calls the retry endpoint, not just a refetch', async () => {
    let getCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/assets/42/retry') && methodOf(input, init) === 'POST') {
        return jsonResponse({ asset: { id: 42, kind: 'captions', status: 'processing' } })
      }
      if (url.endsWith('/captions')) {
        getCount += 1
        // First load: failed with a retryable asset_id. After the retry
        // POST fires (and the subsequent refetch), it's processing.
        const status = getCount === 1 ? 'failed' : 'processing'
        return jsonResponse({
          captions: {
            status,
            vtt: null,
            failure_code: status === 'failed' ? 'transcription_failed' : null,
            updated_at: null,
            asset_id: 42,
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<CaptionEditor speechId={1} onSeek={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/caption generation failed/i)
    await user.click(screen.getByRole('button', { name: /retry/i }))

    // Proves the real retry endpoint was hit (not just a refetch of the
    // same permanently-failed row) — this is the reconciliation-audit
    // finding: `data.status` moves off 'failed' only if the POST fired.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => urlOf(input).endsWith('/assets/42/retry') && methodOf(input, init) === 'POST',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
