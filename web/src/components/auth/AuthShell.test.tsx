import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { RequireGuest } from '@/components/auth/AuthShell'
import { ADMIN_LOGIN_CONTINUATION } from '@/lib/roles'
import { clearCookies, createTestStore } from '@/test/renderWithProviders'

describe('RequireGuest', () => {
  const originalLocation = window.location

  beforeEach(() => clearCookies())
  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  function mountGuestRoute(user?: { roles: string[]; onboarding_completed: boolean }, route = '/login') {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (!url.includes('/api/me')) throw new Error(`unexpected fetch: ${url}`)
      return new Response(JSON.stringify(user ? { user } : { message: 'Unauthenticated.' }), {
        status: user ? 200 : 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
    const router = createMemoryRouter([
      { path: '/login', element: <RequireGuest><h1>Shared login</h1></RequireGuest> },
      { path: '/dashboard', element: <h1>Dashboard</h1> },
      { path: '/onboarding', element: <h1>Onboarding</h1> },
    ], { initialEntries: [route] })
    render(<Provider store={createTestStore()}><RouterProvider router={router} /></Provider>)
    return router
  }

  it.each(['admin', 'super_admin'])('uses real external continuation for an authenticated %s', async (role) => {
    const replace = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, replace },
    })
    const router = mountGuestRoute({ roles: [role], onboarding_completed: true })

    await waitFor(() => expect(replace).toHaveBeenCalledWith(ADMIN_LOGIN_CONTINUATION))
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.queryByRole('heading', { name: 'Shared login' })).not.toBeInTheDocument()
  })

  it.each(['member', 'coach'])('preserves the %s dashboard and verification notice', async (role) => {
    const router = mountGuestRoute({ roles: [role], onboarding_completed: true }, '/login?verified=1')

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(router.state.location.search).toBe('?verified=1')
  })

  it('preserves incomplete onboarding', async () => {
    const router = mountGuestRoute({ roles: [], onboarding_completed: false })

    expect(await screen.findByRole('heading', { name: 'Onboarding' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding')
  })

  it('shows the shared login to a guest', async () => {
    const router = mountGuestRoute()

    expect(await screen.findByRole('heading', { name: 'Shared login' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
