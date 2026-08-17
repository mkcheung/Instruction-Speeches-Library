import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { useGetTranscriptQuery, useSearchSpeechesQuery } from '@/features/transcript/transcriptApi'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

describe('transcriptApi', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('getTranscript unwraps the { transcript: ... } envelope', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/1/transcript')) {
        return jsonResponse({
          transcript: {
            body: 'Hello world.',
            segments: [{ start: 0, end: 1.2, text: 'Hello world.' }],
            word_count: 2,
            words_per_minute: 120,
            language: 'en',
            model: 'whisper-base',
            source: 'whisper',
            updated_at: '2026-01-01T00:00:00Z',
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useGetTranscriptQuery({ speechId: 1 }), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data?.segments).toEqual([{ start: 0, end: 1.2, text: 'Hello world.' }])
    expect(result.current.data?.source).toBe('whisper')
  })

  it('searchSpeeches unwraps { results: ... } and encodes the query string', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/api/speeches/search')) {
        expect(url).toContain('q=district%20final')
        return jsonResponse({
          results: [
            {
              id: 7,
              ulid: '01XYZ',
              title: 'Districts speech',
              description: null,
              delivered_on: null,
              change_note: null,
              created_at: '2026-01-01T00:00:00Z',
              captions_enabled: true,
              primary_video: null,
            },
          ],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSearchSpeechesQuery({ q: 'district final' }), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].title).toBe('Districts speech')
  })
})
