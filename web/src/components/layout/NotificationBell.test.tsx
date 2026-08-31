import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/**
 * STEP-12-FROZEN-CONTRACT.md §9: `coach_application.approved`/`.rejected`
 * — `describe()` is a deliberately enumerated `switch`, not
 * generic-fallback-safe (its `default` renders just the bare speech
 * title), so each of these two new types needs its own explicit case,
 * asserted directly here rather than trusting the `default` to be safe.
 */
describe('NotificationBell', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  function stubNotifications(type: string) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/notifications')) {
        return jsonResponse({
          notifications: [
            {
              id: 'n1',
              type,
              data: { type },
              read_at: null,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          unread_count: 1,
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  it('describes coach_application.approved with its own copy, not the bare-fallback default', async () => {
    stubNotifications('coach_application.approved')
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)

    await user.click(screen.getByRole('button', { name: /notifications/i }))

    expect(await screen.findByText(/coach application was approved/i)).toBeInTheDocument()
  })

  it('describes coach_application.rejected with its own copy, not the bare-fallback default', async () => {
    stubNotifications('coach_application.rejected')
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)

    await user.click(screen.getByRole('button', { name: /notifications/i }))

    expect(await screen.findByText(/coach application was not approved/i)).toBeInTheDocument()
  })
})
