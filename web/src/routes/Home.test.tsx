import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import Home from '@/routes/Home'
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

/** A `GET /api/me` success body, trimmed to the fields `getPostLoginDestination`
 * and role checks read — modeled on `Dashboard.test.tsx`'s `meResponse` helper. */
function meResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: {
      id: '1',
      email: 'mars@example.com',
      first_name: 'Mars',
      last_name: 'Cheung',
      username: 'marscheung',
      display_name: 'Mars Cheung',
      email_verified: true,
      roles: [],
      onboarding_completed: true,
      onboarding_step: 4,
      ...overrides,
    },
  }
}

/**
 * Home.tsx has no sibling test file yet (it's being built by a parallel
 * agent). Modeled on two existing conventions rather than inventing a new
 * one:
 *
 * - The logged-out case uses `renderWithProviders`
 *   (`src/test/renderWithProviders.tsx`), which mounts `Home` at a single
 *   catch-all route — fine here because nothing navigates away.
 * - The authenticated case hand-rolls a `createMemoryRouter` with a real
 *   `/dashboard` route, exactly like `Onboarding.test.tsx`'s "redirects to
 *   the dashboard" test: `renderWithProviders`'s catch-all would re-match
 *   `<Navigate to="/dashboard">` and just render `Home` again, which would
 *   make the test pass even if the redirect never actually fired. A
 *   distinct `/dashboard` route is what makes the redirect observable via
 *   `router.state.location.pathname`.
 */
describe('Home', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  describe('logged out', () => {
    // The landing art is a lazy chunk. Let it settle before Testing
    // Library's cleanup (registered at the outer scope, so it runs after
    // this) unmounts the tree; otherwise a Suspense boundary can resolve
    // after the test has already ended.
    afterEach(async () => {
      await screen.findByRole('img', { name: /same speaker, now confident/i })
    })

    function stubLoggedOut() {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/api/me')) {
          return jsonResponse({ message: 'Unauthenticated.' }, 401)
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)
    }

    it('describes the product and the privacy rule', async () => {
      stubLoggedOut()
      renderWithProviders(<Home />, { route: '/' })

      // Tolerant of exact phrasing: proves the IDEA (nobody sees your
      // speech unless you personally invited them) is present without
      // locking the implementing agent into one exact sentence.
      const privacyMatches = await screen.findAllByText(/unless you.*invited/i)
      expect(privacyMatches.length).toBeGreaterThan(0)
    })

    it('mentions the timestamp/fade-in behavior of reviewer notes', async () => {
      stubLoggedOut()
      renderWithProviders(<Home />, { route: '/' })

      await screen.findByText(/unless you.*invited/i)
      expect(screen.getByText(/fade/i)).toBeInTheDocument()
    })

    it('links to Register at /register', async () => {
      stubLoggedOut()
      renderWithProviders(<Home />, { route: '/' })

      const link = await screen.findByRole('link', { name: /register/i })
      expect(link).toHaveAttribute('href', '/register')
    })

    it('links to Log in at /login', async () => {
      stubLoggedOut()
      renderWithProviders(<Home />, { route: '/' })

      const link = await screen.findByRole('link', { name: /log in/i })
      expect(link).toHaveAttribute('href', '/login')
    })

    it('loads both illustrated scenes with their accessible names', async () => {
      stubLoggedOut()
      renderWithProviders(<Home />, { route: '/' })

      expect(await screen.findByRole('img', { name: /nervous speaker shakes behind a lectern/i })).toBeInTheDocument()
      expect(await screen.findByRole('img', { name: /same speaker, now confident/i })).toBeInTheDocument()
    })

    // The art is lazy-loaded, so the single-occurrence guarantees above are
    // only meaningful once it's actually on the page: its balloons, SFX and
    // SVG <title>s are text Testing Library also reads.
    it('keeps the privacy rule and the fade sentence to one element each once the art has loaded', async () => {
      stubLoggedOut()
      renderWithProviders(<Home />, { route: '/' })

      await screen.findByRole('img', { name: /same speaker, now confident/i })
      expect(screen.getAllByText(/unless you.*invited/i)).toHaveLength(1)
      expect(screen.getAllByText(/fade/i)).toHaveLength(1)
    })
  })

  describe('authenticated, non-admin, onboarded', () => {
    it('redirects to /dashboard instead of showing landing copy', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/api/me')) return jsonResponse(meResponse())
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const router = createMemoryRouter(
        [
          { path: '/', element: <Home /> },
          { path: '/dashboard', element: <h1>My reviews</h1> },
        ],
        { initialEntries: ['/'] },
      )
      render(
        <Provider store={createTestStore()}>
          <RouterProvider router={router} />
        </Provider>,
      )

      expect(await screen.findByRole('heading', { name: 'My reviews' })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/dashboard')
      expect(screen.queryByRole('link', { name: /register/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /log in/i })).not.toBeInTheDocument()
    })
  })
})
