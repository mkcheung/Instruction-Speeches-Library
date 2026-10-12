import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { createTestStore } from '@/test/renderWithProviders'
import { UnauthenticatedRedirect } from '@/components/auth/UnauthenticatedRedirect'
import { UNAUTHENTICATED_EVENT } from '@/lib/baseQuery'

/** `UnauthenticatedRedirect` renders `null` — it's a listener, not layout
 * — so, matching `App.tsx`'s real `RootLayout`, the parent route needs an
 * explicit `<Outlet />` or the child routes below never render at all. */
function RootLayout() {
  return (
    <>
      <UnauthenticatedRedirect />
      <Outlet />
    </>
  )
}

/**
 * `/` (§7.9's landing page) fires `useGetMeQuery()` unconditionally, which
 * 401s and dispatches `UNAUTHENTICATED_EVENT` for every anonymous visitor
 * — found in review: that 401 used to bounce every logged-out visitor on
 * `/` straight to `/login` before they ever saw the page, because `/`
 * matched neither `GUEST_PATHS` nor `PUBLIC_PATHS`. `Home.test.tsx` mounts
 * `Home` alone, with no `UnauthenticatedRedirect` in the tree, so that
 * interaction was invisible to it — this file exercises the two together.
 */
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <RootLayout />,
        children: [
          { path: '/', element: <h1>Landing</h1> },
          { path: '/dashboard', element: <h1>My reviews</h1> },
          { path: '/weird', element: <h1>Weird</h1> },
          { path: '/login', element: <h1>Sign in</h1> },
          { path: '/verify', element: <h1>Verify your email</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(
    <Provider store={createTestStore()}>
      <RouterProvider router={router} />
    </Provider>,
  )
  return router
}

describe('UnauthenticatedRedirect', () => {
  it('does not redirect away from / on a 401 probe', async () => {
    const router = renderAt('/')

    act(() => window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT)))

    expect(await screen.findByRole('heading', { name: 'Landing' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  /**
   * code-review finding: `/verify` has the identical shape of bug `/`
   * had — `VerifyEmail.tsx` fires `useGetMeQuery()` unconditionally and
   * has a real, designed branch for an anonymous cross-device visitor
   * ("you're not logged in on this device... it works cross-device"),
   * which was unreachable because this listener bounced to `/login`
   * before that branch ever rendered.
   */
  it('does not redirect away from /verify on a 401 probe', async () => {
    const router = renderAt('/verify')

    act(() => window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT)))

    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/verify')
  })

  it('still redirects a genuinely protected route to /login on a 401', async () => {
    const router = renderAt('/dashboard')

    act(() => window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT)))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  /**
   * Pins the exact-match implementation choice, not just its outcome:
   * `EXACT_PUBLIC_PATHS` is checked with `.includes()`, never `.startsWith()`
   * like the other two allowlists — `'/weird'.startsWith('/')` would be
   * true for every route in the app, which would have silently disabled
   * this component's entire redirect if `/` had been added as a prefix
   * instead of an exact match.
   */
  it('still redirects an unrelated route that merely starts with "/" to /login', async () => {
    const router = renderAt('/weird')

    act(() => window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT)))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
