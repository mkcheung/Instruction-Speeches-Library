import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { useExportJob, latestExportOfKind } from '@/hooks/useExportJob'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

function exportRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    kind: 'account',
    status: 'processing',
    byte_size: null,
    expires_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * STEP-11-FROZEN-CONTRACT.md §10: `useExportJob` copies
 * `useCaptionsJob.ts`'s render-time-adjusted polling pattern — keep
 * polling at 4s while any row is `'processing'`, stop once every row is
 * terminal.
 */
describe('useExportJob polling', () => {
  beforeEach(() => clearCookies())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps polling every 4s while a row is "processing"', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/privacy/exports')) {
        callCount += 1
        return jsonResponse({ exports: [exportRow({ status: 'processing' })] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useExportJob(), { wrapper })
    await waitFor(() => expect(result.current.exports).toHaveLength(1))
    expect(callCount).toBe(1)

    await waitFor(() => expect(callCount).toBe(2), { timeout: 6000 })
  }, 8000)

  it('stops polling once every row is terminal ("ready")', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/privacy/exports')) {
        callCount += 1
        return jsonResponse({ exports: [exportRow({ status: 'ready' })] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useExportJob(), { wrapper })
    await waitFor(() => expect(result.current.exports[0]?.status).toBe('ready'))
    expect(callCount).toBe(1)

    await new Promise((resolve) => setTimeout(resolve, 4500))
    expect(callCount).toBe(1)
  }, 8000)
})

describe('latestExportOfKind', () => {
  it('picks the highest id among rows of the requested kind', () => {
    const rows = [
      exportRow({ id: 1, kind: 'account', status: 'ready' }),
      exportRow({ id: 3, kind: 'account', status: 'processing' }),
      exportRow({ id: 2, kind: 'reviewer_annotations', status: 'ready' }),
    ] as never
    expect(latestExportOfKind(rows, 'account')?.id).toBe(3)
    expect(latestExportOfKind(rows, 'reviewer_annotations')?.id).toBe(2)
  })

  it('returns undefined when no row of that kind exists', () => {
    expect(latestExportOfKind([], 'account')).toBeUndefined()
  })
})
