import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Login from '@/routes/Login'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import { ADMIN_PANEL_ITEM } from '@/lib/roles'

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §7.4: "No vitest test anywhere currently
 * renders `Login` or asserts a post-login destination." This is the
 * first one — site 1's call shape (`getPostLoginDestination` plus a
 * branch between `navigate()` and a real cross-origin navigation).
 */

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/** Matches `DeleteAccountDialog.test.tsx`'s pattern — jsdom's
 * `window.location.replace` is non-configurable, so `vi.spyOn` cannot
 * redefine it directly. */
function stubLocationReplace() {
  const replace = vi.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, replace },
  })
  return {
    replace,
    restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }),
  }
}

function stubLoginResponse(user: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
    if (url.includes('/login')) {
      return jsonResponse({ user }, 200)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function submitLoginForm() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/^email$/i), 'admin@example.com')
  await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery')
  await user.click(screen.getByRole('button', { name: /log in/i }))
}

describe('Login', () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a member with no `from` to /dashboard', async () => {
    stubLoginResponse({ roles: ['member'], onboarding_completed: true })
    const { router } = renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
  })

  it('sends a roleless user with incomplete onboarding to /onboarding', async () => {
    stubLoginResponse({ roles: [], onboarding_completed: false })
    const { router } = renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding')
    })
  })

  it('escorts an admin with no `from` to the panel via a real cross-origin navigation, not navigate()', async () => {
    stubLoginResponse({ roles: ['admin'], onboarding_completed: true })
    const location = stubLocationReplace()

    const { router } = renderWithProviders(<Login />, { route: '/login' })

    await submitLoginForm()

    await waitFor(() => {
      expect(location.replace).toHaveBeenCalledWith(ADMIN_PANEL_ITEM.to)
    })
    // The SPA's own router never moves — `navigate()` was deliberately
    // not the call made for this case.
    expect(router.state.location.pathname).toBe('/login')

    location.restore()
  })

  /**
   * The shared-link rule (the resolved Q2): an admin who followed a link
   * into the SPA, was bounced to `/login` by `RequireAuth`, and signs in
   * lands back on that link — not the panel. A role check ordered ahead
   * of the `from` lookup would silently eat it.
   */
  it('sends an admin WITH a `from` state back to that location — NOT the panel', async () => {
    stubLoginResponse({ roles: ['admin'], onboarding_completed: true })
    const location = stubLocationReplace()

    const { router } = renderWithProviders(<Login />, {
      route: { pathname: '/login', state: { from: { pathname: '/speeches/123' } } },
    })

    await submitLoginForm()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/speeches/123')
    })
    expect(location.replace).not.toHaveBeenCalled()

    location.restore()
  })
})
