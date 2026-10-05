import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import Onboarding from '@/routes/Onboarding'
import { createTestStore, renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    email: 'mars@example.com',
    first_name: null,
    last_name: null,
    username: null,
    email_verified: true,
    roles: ['member'],
    onboarding_completed: false,
    onboarding_step: 1,
    ...overrides,
  }
}

/**
 * §6.5's resumability requirement: onboarding writes to the backend on
 * every step, and the route asks "which step am I on" (`GET
 * /api/onboarding`, `App\Support\Onboarding::currentStep`) rather than
 * always starting at step 1. This proves the frontend half of that
 * contract — given a status response reporting step 1 already complete,
 * it renders step 2's form (bio/pronouns/location), not step 1's
 * (name/username).
 */
describe('Onboarding resumability', () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resumes at step 2 when the backend reports step 1 already complete', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/onboarding')) {
        return jsonResponse({
          step: 2,
          user: baseUser({
            first_name: 'Mars',
            last_name: 'Cheung',
            username: 'marscheung',
            onboarding_step: 2,
          }),
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<Onboarding />, { route: '/onboarding' })

    expect(await screen.findByText('About you')).toBeInTheDocument()
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/bio/i)).toBeInTheDocument()
  })

  it('starts at step 1 for a brand new, empty profile', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/onboarding')) {
        return jsonResponse({ step: 1, user: baseUser() })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<Onboarding />, { route: '/onboarding' })

    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
  })

  /**
   * An established profile has nothing to do on this screen, so step 4
   * redirects instead of rendering a "You're all set" card.
   *
   * Hand-rolls a router rather than using `renderWithProviders`: that
   * helper mounts `ui` under a single catch-all `path: '*'`, so
   * `<Navigate to="/dashboard">` would re-match the catch-all, render
   * `Onboarding` again, and redirect forever. A real `/dashboard` route is
   * what makes the redirect observable.
   */
  it('redirects to the dashboard once step 4 (done) is reached, with no "all set" screen', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/onboarding')) {
        return jsonResponse({
          step: 4,
          user: baseUser({
            first_name: 'Mars',
            last_name: 'Cheung',
            username: 'marscheung',
            onboarding_completed: true,
            onboarding_step: 4,
          }),
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const router = createMemoryRouter(
      [
        { path: '/onboarding', element: <Onboarding /> },
        { path: '/dashboard', element: <h1>My reviews</h1> },
      ],
      { initialEntries: ['/onboarding'] },
    )
    render(
      <Provider store={createTestStore()}>
        <RouterProvider router={router} />
      </Provider>,
    )

    expect(await screen.findByRole('heading', { name: 'My reviews' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(screen.queryByText("You're all set")).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /view your profile/i })).not.toBeInTheDocument()
  })

  /** The verification banner has to survive the redirect: post-verify
   * lands on `/login?verified=1`, which forwards an onboarded user
   * through here. Dropping the param would make verifying look like a
   * no-op. */
  it('carries ?verified=1 through to the dashboard', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/onboarding')) {
        return jsonResponse({
          step: 4,
          user: baseUser({ username: 'marscheung', onboarding_completed: true, onboarding_step: 4 }),
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const router = createMemoryRouter(
      [
        { path: '/onboarding', element: <Onboarding /> },
        { path: '/dashboard', element: <h1>My reviews</h1> },
      ],
      { initialEntries: ['/onboarding?verified=1'] },
    )
    render(
      <Provider store={createTestStore()}>
        <RouterProvider router={router} />
      </Provider>,
    )

    expect(await screen.findByRole('heading', { name: 'My reviews' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?verified=1')
  })
})
