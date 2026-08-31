import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import {
  useGetMyCoachApplicationQuery,
  useSubmitCoachApplicationMutation,
  useUploadCoachApplicationDocumentsMutation,
} from '@/features/coachApplication/coachApplicationApi'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

async function jsonBodyOf(input: RequestInfo | URL): Promise<Record<string, unknown>> {
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

const COACH_APPLICATION = {
  id: 42,
  status: 'draft',
  statement: 'I want to help others.',
  decision_reason: null,
  submitted_at: null,
  decided_at: null,
  documents: [],
}

describe('coachApplicationApi', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('getMyCoachApplication unwraps the { coachApplication: ... } envelope, not the bare resource', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/coach-applications/me')) {
        return jsonResponse({ coachApplication: COACH_APPLICATION })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useGetMyCoachApplicationQuery(), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())

    // Unwrapped: `data.id` directly, not `data.coachApplication.id` — the
    // exact bug class the frozen contract calls out (STEP-08's real bug
    // was a missed `transformResponse` instance).
    expect(result.current.data).toEqual(COACH_APPLICATION)
  })

  it('submitCoachApplication POSTs { statement } and unwraps the response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/coach-applications') && methodOf(input, init) === 'POST') {
        const body = await jsonBodyOf(input)
        expect(body).toEqual({ statement: 'I want to help others.' })
        return jsonResponse({ coachApplication: COACH_APPLICATION })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSubmitCoachApplicationMutation(), { wrapper })

    const [submit] = result.current
    let returned: { id: number; status: string } | undefined
    await act(async () => {
      returned = await submit({ statement: 'I want to help others.' }).unwrap()
    })

    expect(returned?.id).toBe(42)
    expect(returned?.status).toBe('draft')
  })

  it('uploadCoachApplicationDocuments POSTs multipart form data to the application-scoped route and unwraps the response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/coach-applications/42/documents') && methodOf(input, init) === 'POST') {
        return jsonResponse({
          coachApplication: {
            ...COACH_APPLICATION,
            documents: [{ id: 1, original_filename: 'cert.pdf', status: 'pending_scan', created_at: '2026-01-01T00:00:00Z' }],
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useUploadCoachApplicationDocumentsMutation(), { wrapper })

    const formData = new FormData()
    formData.append('documents[]', new Blob(['%PDF-'], { type: 'application/pdf' }), 'cert.pdf')

    const [upload] = result.current
    let returned: { documents: unknown[] } | undefined
    await act(async () => {
      returned = await upload({ id: 42, formData }).unwrap()
    })

    expect(returned?.documents).toHaveLength(1)
  })
})
