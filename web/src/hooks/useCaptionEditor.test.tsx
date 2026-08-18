import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { useCaptionEditor } from '@/hooks/useCaptionEditor'

const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello wrold'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/** `fetchBaseQuery` calls `fetch` with a pre-built `Request` (method/body
 * already on it) for state-changing requests, not the `(url, init)` two-arg
 * form — matching `AnnotationList.test.tsx`'s own tolerant helper, which
 * checks both shapes. */
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

describe('useCaptionEditor', () => {
  beforeEach(() => clearCookies())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('parses the initial VTT into cues and starts idle', () => {
    const { result } = renderHook(() => useCaptionEditor({ speechId: 1, vtt: VTT }), { wrapper })
    expect(result.current.cues).toEqual([{ id: 'cue-0', start: 0, end: 2, text: 'Hello wrold' }])
    expect(result.current.autosaveState).toBe('idle')
  })

  it('debounces an edit at 750ms, then PUTs the re-serialized VTT and reports one-word state', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
        const body = await bodyOf(input)
        expect(body.vtt).toContain('Hello world')
        return jsonResponse({
          captions: { status: 'ready', vtt: body.vtt, failure_code: null, updated_at: null, asset_id: null, revision: 'rev-1' },
        })
      }
      if (url.endsWith('/api/speeches/1/transcript')) {
        return jsonResponse({
          transcript: {
            body: 'Hello world',
            segments: [],
            word_count: 2,
            words_per_minute: null,
            language: null,
            model: null,
            source: 'edited',
            updated_at: null,
            caption_revision: 'rev-1',
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCaptionEditor({ speechId: 1, vtt: VTT }), { wrapper })

    act(() => result.current.editCueText('cue-0', 'Hello world'))
    expect(result.current.autosaveState).toBe('dirty')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/captions'))).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/captions'))).toBe(true)
    expect(result.current.autosaveState).toBe('saved')
  })

  it('flushNow saves immediately without waiting out the debounce', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
        return jsonResponse({
          captions: { status: 'ready', vtt: VTT, failure_code: null, updated_at: null, asset_id: null, revision: 'rev-2' },
        })
      }
      if (url.endsWith('/api/speeches/1/transcript')) {
        return jsonResponse({
          transcript: {
            body: 'x',
            segments: [],
            word_count: 1,
            words_per_minute: null,
            language: null,
            model: null,
            source: 'edited',
            updated_at: null,
            caption_revision: 'rev-2',
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCaptionEditor({ speechId: 1, vtt: VTT }), { wrapper })

    act(() => result.current.editCueText('cue-0', 'Edited immediately'))
    act(() => result.current.flushNow())

    await waitFor(() => expect(result.current.autosaveState).toBe('saved'))
  })

  it('reports "offline" on a failed save without discarding the local edit', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
        return jsonResponse({ message: 'Server error' }, 500)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCaptionEditor({ speechId: 1, vtt: VTT }), { wrapper })

    act(() => result.current.editCueText('cue-0', 'Still here'))
    act(() => result.current.flushNow())

    await waitFor(() => expect(result.current.autosaveState).toBe('offline'))
    expect(result.current.cues[0].text).toBe('Still here')
  })

  // STEP-09-VERIFICATION-PLAN.md §4.1/§4.2 point 2: the PUT response is not
  // proof the transcript projection is current — these two tests own the
  // condition-poll seam that `captionApi.test.tsx` deliberately no longer
  // covers (that file only proves the mutation itself stays silent).
  describe('transcript revision convergence poll', () => {
    it('polls the transcript endpoint until caption_revision matches, then reports "synced"', async () => {
      vi.useFakeTimers()
      let transcriptCallCount = 0
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
          return jsonResponse({
            captions: { status: 'ready', vtt: VTT, failure_code: null, updated_at: null, asset_id: null, revision: 'rev-target' },
          })
        }
        if (url.endsWith('/api/speeches/1/transcript')) {
          transcriptCallCount += 1
          // Not yet re-derived on the first two polls; the third lands.
          const caption_revision = transcriptCallCount >= 3 ? 'rev-target' : 'rev-stale'
          return jsonResponse({
            transcript: {
              body: 'x',
              segments: [],
              word_count: 1,
              words_per_minute: null,
              language: null,
              model: null,
              source: transcriptCallCount >= 3 ? 'edited' : 'whisper',
              updated_at: null,
              caption_revision,
            },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { result } = renderHook(() => useCaptionEditor({ speechId: 1, vtt: VTT }), { wrapper })

      act(() => result.current.editCueText('cue-0', 'Edited text'))
      act(() => result.current.flushNow())

      // Fires flushNow's 0ms schedule, the PUT, and the poll's first
      // (immediate) attempt — no `waitFor`, since its internal polling
      // would use the same faked `setTimeout` and never resolve on its own
      // (matching the existing debounce test's explicit-advance idiom).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.autosaveState).toBe('saved')
      expect(result.current.transcriptSyncState).toBe('polling')
      expect(transcriptCallCount).toBe(1)

      // Two more polls at the 1s interval before the third (matching) one.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(transcriptCallCount).toBe(2)
      expect(result.current.transcriptSyncState).toBe('polling')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(transcriptCallCount).toBe(3)
      expect(result.current.transcriptSyncState).toBe('synced')
    })

    it('times out after the bounded attempt budget and lets a manual retry resume polling', async () => {
      vi.useFakeTimers()
      let transcriptCallCount = 0
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.endsWith('/api/speeches/1/captions') && methodOf(input, init) === 'PUT') {
          return jsonResponse({
            captions: { status: 'ready', vtt: VTT, failure_code: null, updated_at: null, asset_id: null, revision: 'rev-never' },
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
              caption_revision: 'rev-stale',
            },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { result } = renderHook(() => useCaptionEditor({ speechId: 1, vtt: VTT }), { wrapper })

      act(() => result.current.editCueText('cue-0', 'Edited text'))
      act(() => result.current.flushNow())

      // Attempt 1 fires as part of this first advance (same reasoning as
      // the convergence test above).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.autosaveState).toBe('saved')
      expect(transcriptCallCount).toBe(1)

      // 10 attempts total — advance past the remaining nine 1s intervals to
      // exhaust the bound.
      for (let i = 0; i < 9; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000)
        })
      }

      expect(result.current.transcriptSyncState).toBe('timeout')
      const callsAtTimeout = transcriptCallCount
      expect(callsAtTimeout).toBe(10)

      // Manual retry (§4.1: "a timeout leaves an honest state with
      // retry/refetch") restarts the same bounded poll rather than being a
      // dead end.
      act(() => result.current.retryTranscriptSync())
      expect(result.current.transcriptSyncState).toBe('polling')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(transcriptCallCount).toBe(callsAtTimeout + 1)
    })
  })
})
