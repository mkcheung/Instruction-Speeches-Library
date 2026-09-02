import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionRequestsBell } from '@/components/layout/ConnectionRequestsBell'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/**
 * STEP-13 reconciliation audit: this component is the fix for "there was
 * no reachable UI path for a connection-request recipient at all" — these
 * tests pin the one behavior that fix depends on: the pending list renders
 * and Accept actually calls the mutation.
 */
describe('ConnectionRequestsBell', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('shows a pending request and accepts it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/api/connections?state=pending')) {
        return jsonResponse({
          connections: [
            {
              id: 42,
              state: 'pending',
              initiated_by_id: 7,
              note: null,
              requested_at: '2026-01-01T00:00:00Z',
              responded_at: null,
              connected_at: null,
              peer: { id: 7, username: 'jordan', name: 'Jordan Ellis', avatar_url: null },
              metric: 'Wants to connect',
            },
          ],
          meta: { next_cursor: null },
        })
      }
      if (url.endsWith('/api/connections/42/accept') && init?.method === 'POST') {
        return jsonResponse({
          connection: {
            id: 42,
            state: 'accepted',
            initiated_by_id: 7,
            note: null,
            requested_at: '2026-01-01T00:00:00Z',
            responded_at: '2026-01-02T00:00:00Z',
            connected_at: '2026-01-02T00:00:00Z',
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<ConnectionRequestsBell />)

    await user.click(screen.getByRole('button', { name: /connection requests/i }))
    expect(await screen.findByText('Jordan Ellis')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /accept/i }))

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/connections/42/accept'))).toBe(true)
    })
  })

  it('renders an empty state with no pending requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/api/connections?state=pending')) {
        return jsonResponse({ connections: [], meta: { next_cursor: null } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<ConnectionRequestsBell />)

    await user.click(screen.getByRole('button', { name: /connection requests/i }))
    expect(await screen.findByText(/no pending requests/i)).toBeInTheDocument()
  })
})
