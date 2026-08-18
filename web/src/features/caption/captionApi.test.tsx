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
            asset_id: 7,
            revision: 'rev-abc123',
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
      asset_id: 7,
      revision: 'rev-abc123',
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
          captions: {
            status: 'ready',
            vtt: 'WEBVTT\n\nfixed',
            failure_code: null,
            updated_at: '2026-01-02T00:00:00Z',
            asset_id: null,
            revision: 'rev-fixed',
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => ({ update: useUpdateCaptionsMutation() }), { wrapper })

    const [updateCaptions] = result.current.update
    let returned: { vtt: string | null; revision: string | null } | undefined
    await act(async () => {
      returned = await updateCaptions({ speechId: 1, body: { vtt: 'WEBVTT\n\nfixed' } }).unwrap()
    })
    expect(returned?.vtt).toBe('WEBVTT\n\nfixed')
    // The new §4.1 read-only field the PUT UI's convergence poll keys off
    // of — proves it survives `transformResponse`'s envelope unwrap intact.
    expect(returned?.revision).toBe('rev-fixed')
  })

  // §4.1 "Projection convergence token": `updateCaptions` deliberately does
  // NOT invalidate `transcriptApi`'s `Transcript`/`Search` tags itself
  // anymore — an earlier version did exactly that immediately on
  // `queryFulfilled`, which was the premature-invalidation bug this plan
  // section replaces. The revision-convergence poll that now gates that
  // invalidation lives in `useCaptionEditor.ts` (see its own test file),
  // since only the caller's component can render the "still updating"
  // state a fire-and-forget cache-layer effect cannot.
  it('updateCaptions alone does not invalidate transcriptApi caches — that is the caller PUT UI\'s job', async () => {
    let transcriptCallCount = 0
    let searchCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
        return jsonResponse({
          captions: {
            status: 'ready',
            vtt: 'WEBVTT\n\nedited',
            failure_code: null,
            updated_at: null,
            asset_id: null,
            revision: 'rev-edited',
          },
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
            caption_revision: null,
          },
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
      () => ({
        transcript: useGetTranscriptQuery({ speechId: 1 }),
        search: useSearchSpeechesQuery({ q: 'liberty' }),
        update: useUpdateCaptionsMutation(),
      }),
      { wrapper: localWrapper },
    )

    await waitFor(() => expect(result.current.transcript.data).toBeDefined())
    await waitFor(() => expect(result.current.search.data).toBeDefined())
    expect(transcriptCallCount).toBe(1)
    expect(searchCallCount).toBe(1)

    const [updateCaptions] = result.current.update
    await act(async () => {
      await updateCaptions({ speechId: 1, body: { vtt: 'WEBVTT\n\nedited' } }).unwrap()
    })

    // No poll orchestration lives at this layer, so no follow-up refetch
    // happens on either cache purely from calling the mutation.
    expect(transcriptCallCount).toBe(1)
    expect(searchCallCount).toBe(1)
  })
})
