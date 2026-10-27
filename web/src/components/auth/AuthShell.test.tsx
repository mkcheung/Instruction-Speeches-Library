import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { RequireAuth, RequireGuest } from '@/components/auth/AuthShell'
import { AppHeader } from '@/components/layout/AppHeader'
import { authApi } from '@/features/auth/authApi'
import { authSessionActions } from '@/features/auth/authSession'
import type { CurrentUser } from '@/features/auth/types'
import { act } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
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

describe('RequireAuth identity gate', () => {
  const viewer: CurrentUser = {
    id: 'a', username: 'alex', roles: [], email: 'a@test.local', first_name: 'A', last_name: null, display_name: 'Alex',
    email_verified: true, onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 0, quota_bytes: 1, uploads_in_flight: 0,
  }
  function Draft() {
    const [text, setText] = useState('')
    return <textarea aria-label="draft" value={text} onChange={(event) => setText(event.target.value)} />
  }
  beforeEach(() => {
    clearCookies()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: viewer }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })
  afterEach(() => vi.unstubAllGlobals())

  function mount() {
    const store = createTestStore({ viewer })
    const router = createMemoryRouter([{ path: '/', element: <RequireAuth><Draft /></RequireAuth> }])
    render(<Provider store={store}><RouterProvider router={router} /></Provider>)
    return store
  }

  it('hides private content while proof is withdrawn WITHOUT unmounting it, and restores the same draft', async () => {
    const store = mount()
    const draft = await screen.findByLabelText('draft')
    await act(async () => { draft.focus(); (draft as HTMLTextAreaElement).value = 'unsaved' })
    await act(async () => { await store.dispatch(authApi.endpoints.getMe.initiate()) })
    expect(draft).toBeVisible()

    act(() => { store.dispatch(authSessionActions.externalChange()) })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(draft).not.toBeVisible()
    expect(screen.getByLabelText('draft', { selector: 'textarea' })).toBe(draft) // same node: not remounted
    await waitFor(() => expect(draft).toBeVisible())
  })

  it('offers a Retry instead of a permanent spinner when the session is uncertain', async () => {
    const store = mount()
    const draft = await screen.findByLabelText('draft')
    await act(async () => { await store.dispatch(authApi.endpoints.getMe.initiate()) })
    act(() => {
      store.dispatch(authSessionActions.quarantined())
      store.dispatch(authSessionActions.probeUncertain({ status: 500 }))
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't verify your session")
    expect(draft).not.toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(draft).toBeVisible())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders nothing private once the document is terminal', async () => {
    const store = mount()
    await screen.findByLabelText('draft')
    act(() => { store.dispatch(authSessionActions.attemptSucceeded()) })
    expect(screen.queryByLabelText('draft')).not.toBeInTheDocument()
  })

  it('suppresses private header content unless the viewer is the accepted identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify((input instanceof Request ? input.url : input.toString()).endsWith('/api/me') ? { user: viewer } : { message: 'Forbidden' }),
      { status: (input instanceof Request ? input.url : input.toString()).endsWith('/api/me') ? 200 : 403, headers: { 'Content-Type': 'application/json' } })))
    const store = createTestStore()
    const router = createMemoryRouter([{ path: '/', element: <AppHeader /> }])
    render(<Provider store={store}><RouterProvider router={router} /></Provider>)
    expect(screen.queryByRole('button', { name: /alex/i })).not.toBeInTheDocument()
    await act(async () => { await store.dispatch(authApi.endpoints.getMe.initiate()) })
    expect(await screen.findByRole('button', { name: /alex/i })).toBeInTheDocument()
    act(() => { store.dispatch(authSessionActions.pageHidden()) })
    expect(screen.queryByRole('button', { name: /alex/i })).not.toBeInTheDocument()
  })
})
