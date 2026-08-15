import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { AnnotationList } from '@/components/annotation/AnnotationList'
import { ToastProvider, Toaster } from '@/components/ui/toast'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import type { Annotation } from '@/features/annotation/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

async function bodyOf(input: RequestInfo | URL): Promise<Record<string, unknown>> {
  if (!(input instanceof Request)) return {}
  try {
    return (await input.clone().json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: '7',
    start_seconds: 30,
    duration_seconds: 6,
    kind: 'observation',
    topic: null,
    body: 'a note worth keeping',
    lock_version: 1,
    client_uuid: 'client-uuid-7',
    ...overrides,
  }
}

function renderList(annotations: Annotation[]) {
  return render(
    <Provider store={createTestStore()}>
      <ToastProvider>
        <AnnotationList
          annotations={annotations}
          speechId={1}
          reviewId={9}
          videoEl={null}
          autoPause={false}
          currentId={null}
          onSeek={() => {}}
          onLiveChange={() => {}}
          onLiveRemove={() => {}}
        />
        <Toaster />
      </ToastProvider>
    </Provider>,
  )
}

/**
 * STEP-07-write-commentary.md acceptance list: "Delete-then-Undo restores
 * it, and re-creating with the same `client_uuid` does not collide."
 * Delete fires immediately (contract item 3); Undo re-POSTs via
 * `createAnnotation` with the SAME `client_uuid` (contract item 1's
 * idempotency), which is asserted directly against the request body here.
 */
describe('AnnotationList — delete then Undo', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('deletes immediately, then Undo re-creates with the identical client_uuid', async () => {
    const deleteCalls: string[] = []
    const createCalls: Record<string, unknown>[] = []

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/annotations/7') && method === 'DELETE') {
        deleteCalls.push(url)
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/annotations') && method === 'POST') {
        const sentBody = await bodyOf(input)
        createCalls.push(sentBody)
        return jsonResponse({ annotation: { ...annotation(), lock_version: 1 } })
      }
      throw new Error(`unexpected fetch: ${url} ${method}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderList([annotation()])

    await user.click(screen.getByRole('button', { name: /delete annotation/i }))

    // Delete fires right away — NOT deferred until the toast expires.
    await waitFor(() => expect(deleteCalls).toHaveLength(1))

    const undoButton = await screen.findByRole('button', { name: /undo/i })
    await user.click(undoButton)

    await waitFor(() => expect(createCalls).toHaveLength(1))
    expect(createCalls[0]).toMatchObject({
      client_uuid: 'client-uuid-7',
      body: 'a note worth keeping',
      start_seconds: 30,
      duration_seconds: 6,
    })
  })

  it('lets a failed Undo be retried, rather than latching it permanently unrecoverable', async () => {
    let createAttempts = 0

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/annotations/7') && method === 'DELETE') return new Response(null, { status: 204 })
      if (url.endsWith('/annotations') && method === 'POST') {
        createAttempts += 1
        if (createAttempts === 1) return new Response(null, { status: 500 })
        return jsonResponse({ annotation: { ...annotation(), lock_version: 1 } })
      }
      throw new Error(`unexpected fetch: ${url} ${method}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderList([annotation()])

    await user.click(screen.getByRole('button', { name: /delete annotation/i }))
    await waitFor(() => expect(createAttempts).toBe(0))

    const undoButton = await screen.findByRole('button', { name: /undo/i })

    // First attempt fails (network/server error) — must not be silently
    // dropped with no way to retry.
    await user.click(undoButton)
    await waitFor(() => expect(createAttempts).toBe(1))
    await screen.findByText(/could not undo/i)

    // The SAME toast's Undo button is still clickable and succeeds.
    await user.click(undoButton)
    await waitFor(() => expect(createAttempts).toBe(2))
  })
})
