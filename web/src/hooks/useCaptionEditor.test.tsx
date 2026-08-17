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
        return jsonResponse({ captions: { status: 'ready', vtt: body.vtt, failure_code: null, updated_at: null , asset_id: null } })
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
        return jsonResponse({ captions: { status: 'ready', vtt: VTT, failure_code: null, updated_at: null , asset_id: null } })
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
})
