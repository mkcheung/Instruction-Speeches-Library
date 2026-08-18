import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { useGetCaptionsQuery, useUpdateCaptionsMutation } from '@/features/caption/captionApi'
import { useGetTranscriptQuery, useSearchSpeechesQuery } from '@/features/transcript/transcriptApi'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/** `fetchBaseQuery` calls `fetch` with a pre-built `Request` (method/body
 * already on it) for state-changing requests, not the `(url, init)` two-arg
 * form — matching `AnnotationList.test.tsx`'s own tolerant helper. */
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

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

describe('captionApi', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('getCaptions unwraps the { captions: ... } envelope, not the bare resource', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions')) {
        return jsonResponse({
          captions: {
            status: 'ready',
            vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi',
            failure_code: null,
            updated_at: '2026-01-01T00:00:00Z',
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useGetCaptionsQuery({ speechId: 1 }), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())

    // Unwrapped: `data.status` directly, not `data.captions.status` — the
    // whole point of `transformResponse`, and exactly the class of bug
    // (consuming the enveloped shape unwrapped, or vice versa) the frozen
    // contract calls out.
    expect(result.current.data).toEqual({
      status: 'ready',
      vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi',
      failure_code: null,
      updated_at: '2026-01-01T00:00:00Z',
    })
  })

  it('updateCaptions sends a PUT with only { vtt } (no lock_version) and unwraps the response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
        const body = await bodyOf(input)
        expect(body).toEqual({ vtt: 'WEBVTT\n\nfixed' })
        return jsonResponse({
          captions: { status: 'ready', vtt: 'WEBVTT\n\nfixed', failure_code: null, updated_at: '2026-01-02T00:00:00Z' , asset_id: null },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => ({ update: useUpdateCaptionsMutation() }), { wrapper })

    const [updateCaptions] = result.current.update
    let returned: { vtt: string | null } | undefined
    await act(async () => {
      returned = await updateCaptions({ speechId: 1, body: { vtt: 'WEBVTT\n\nfixed' } }).unwrap()
    })
    expect(returned?.vtt).toBe('WEBVTT\n\nfixed')
  })

  it("a successful updateCaptions invalidates transcriptApi's own cache for the same speech", async () => {
    let transcriptCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
        return jsonResponse({
          captions: { status: 'ready', vtt: 'WEBVTT\n\nedited', failure_code: null, updated_at: null , asset_id: null },
        })
      }
      if (url.endsWith('/api/speeches/1/transcript')) {
        transcriptCallCount += 1
        return jsonResponse({
          transcript: {
            body: 'x',
            segments: [],
            word_count: 1,
            words_per_minute: null,
            language: null,
            model: null,
            source: 'whisper',
            updated_at: null,
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = createTestStore()
    const localWrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>

    const { result } = renderHook(
      () => ({ transcript: useGetTranscriptQuery({ speechId: 1 }), update: useUpdateCaptionsMutation() }),
      { wrapper: localWrapper },
    )

    await waitFor(() => expect(result.current.transcript.data).toBeDefined())
    expect(transcriptCallCount).toBe(1)

    const [updateCaptions] = result.current.update
    await act(async () => {
      await updateCaptions({ speechId: 1, body: { vtt: 'WEBVTT\n\nedited' } }).unwrap()
    })

    // §6.12/§8: editing a caption line re-derives the transcript —
    // captionApi's `onQueryStarted` dispatches transcriptApi's own
    // invalidation, which should trigger a refetch of the still-subscribed
    // transcript query.
    await waitFor(() => expect(transcriptCallCount).toBe(2))
  })

  it("a successful updateCaptions also invalidates transcriptApi's Search tag, refetching a subscribed search query", async () => {
    let searchCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
        return jsonResponse({
          captions: { status: 'ready', vtt: 'WEBVTT\n\nedited', failure_code: null, updated_at: null, asset_id: null },
        })
      }
      if (url.includes('/api/speeches/search')) {
        searchCallCount += 1
        return jsonResponse({ results: [] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = createTestStore()
    const localWrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>

    const { result } = renderHook(
      () => ({ search: useSearchSpeechesQuery({ q: 'liberty' }), update: useUpdateCaptionsMutation() }),
      { wrapper: localWrapper },
    )

    await waitFor(() => expect(result.current.search.data).toBeDefined())
    expect(searchCallCount).toBe(1)

    const [updateCaptions] = result.current.update
    await act(async () => {
      await updateCaptions({ speechId: 1, body: { vtt: 'WEBVTT\n\nedited' } }).unwrap()
    })

    // A caption edit re-derives `speech_transcripts.body`, which
    // `searchSpeeches`'s tsvector match reads — a pre-warmed Search cache
    // must refetch, not go stale forever.
    await waitFor(() => expect(searchCallCount).toBe(2))
  })
})
