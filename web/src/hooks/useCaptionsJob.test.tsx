import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { useCaptionsJob } from '@/hooks/useCaptionsJob'
import type { Captions } from '@/features/caption/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function captionsPayload(status: Captions['status']) {
  return {
    captions: { status, vtt: status === 'ready' ? 'WEBVTT' : null, failure_code: null, updated_at: null, asset_id: null },
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

/**
 * §33/`useCaptionsJob.ts`: `desiredPollingInterval` must treat every
 * terminal `Captions['status']` — `'ready'`, `'failed'`, AND
 * `'unavailable'` (synthesized by `CaptionController::show` when no
 * captions asset row exists at all) — as a reason to stop polling.
 * `'unavailable'` was previously missing, which polled a speech with
 * captions disabled forever.
 */
describe('useCaptionsJob polling termination', () => {
  beforeEach(() => clearCookies())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stops polling once status is "unavailable", same as "ready"/"failed"', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions')) {
        callCount += 1
        return jsonResponse(captionsPayload('unavailable'))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    // Real timers throughout: RTK Query's own internal polling timer is
    // created (via `setInterval`) while `renderHook` runs under whatever
    // timer implementation is active at that moment, and switching to fake
    // timers afterwards does not retroactively convert an already-running
    // real interval — so this proves the negative (no second fetch) by
    // waiting past 4s on the real clock instead.
    const { result } = renderHook(() => useCaptionsJob(1, true), { wrapper })
    await waitFor(() => expect(result.current.captions?.status).toBe('unavailable'))
    expect(callCount).toBe(1)

    await new Promise((resolve) => setTimeout(resolve, 4500))
    expect(callCount).toBe(1)
  }, 8000)

  it('keeps polling every 4s while status is "processing"', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/captions')) {
        callCount += 1
        return jsonResponse(captionsPayload('processing'))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCaptionsJob(1, true), { wrapper })
    await waitFor(() => expect(result.current.captions?.status).toBe('processing'))
    expect(callCount).toBe(1)

    await waitFor(() => expect(callCount).toBe(2), { timeout: 6000 })
  }, 8000)
})
