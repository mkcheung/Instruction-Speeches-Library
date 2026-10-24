import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { createTestStore } from '@/test/renderWithProviders'
import { UnauthenticatedRedirect } from '@/components/auth/UnauthenticatedRedirect'
import { UNAUTHENTICATED_EVENT } from '@/lib/baseQuery'
import { authApi } from '@/features/auth/authApi'
import { connectionApi } from '@/features/connection/connectionApi'
import { revalidateConnectionSession, useConnectionSession } from '@/features/connection/connectionSession'
import { useDispatch } from 'react-redux'
import { clearCookies } from '@/test/renderWithProviders'

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
function PrivateFriends() {
  const session = useConnectionSession()
  const dispatch = useDispatch()
  if (session.status === 'error') return <div role="alert">Session unavailable<button onClick={() => dispatch(revalidateConnectionSession())}>Retry session</button></div>
  if (session.status !== 'ready') return <p>Checking session</p>
  return <h1>Private friends</h1>
}

function renderAt(path: string, store = createTestStore()) {
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
          { path: '/register', element: <h1>Register</h1> },
          { path: '/forgot-password', element: <h1>Forgot password</h1> },
          { path: '/u/:username/friends/*', element: <PrivateFriends /> },
          { path: '/u/:username/*', element: <h1>Public profile</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  render(
    <Provider store={store}>
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

const me = (id = '1', username = 'alex') => ({ user: { id, username, email: `${username}@example.test`, roles: ['member'], first_name: username, last_name: 'Smith', display_name: username, email_verified: true, onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 0, quota_bytes: 1000, uploads_in_flight: 0 } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const urlOf = (input: RequestInfo | URL) => input instanceof Request ? input.url : input.toString()
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }

describe('private Friends 401 verification with the real store', () => {
  beforeEach(() => { clearCookies(); document.cookie = 'XSRF-TOKEN=test; path=/' })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it.each(['/u/alex/friends', '/u/alex/friends/', '/u/alex/friends/requests', '/U/alex/FRIENDS/all/'])('quarantines %s until a current anonymous response confirms the redirect', async (path) => {
    let expired = false
    const probe = deferred<Response>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/me')) return expired ? probe.promise : json(me())
      if (url.includes('/api/friends?')) return json({}, 401)
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate()).unwrap()
    const router = renderAt(`${path}?search=lee#requests`, store)
    expired = true
    await act(async () => { await store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'incoming' })) })
    expect(router.state.location.pathname).toBe(path)
    expect(screen.queryByRole('heading', { name: 'Private friends' })).not.toBeInTheDocument()
    expect(Object.keys(store.getState().connectionApi.queries)).toHaveLength(0)
    await act(async () => probe.resolve(json({}, 401)))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.state.from).toMatchObject({ pathname: path, search: '?search=lee', hash: '#requests' })
    expect(fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/api/me'))).toHaveLength(2)
    expect(store.getState().connectionSession.status).toBe('anonymous')
  })

  it('keeps account B signed in after account A returns a late 401', async () => {
    let account = me()
    const oldRequest = deferred<Response>()
    let probes = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/me')) { probes++; return json(account) }
      if (url.endsWith('/login')) { account = me('2', 'blair'); return json(account) }
      if (url.includes('/api/friends?')) return oldRequest.promise
      throw new Error(`Unexpected fetch: ${url}`)
    }))
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate()).unwrap()
    const router = renderAt('/u/blair/friends/requests', store)
    const request = store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'incoming' }))
    await act(async () => { await store.dispatch(authApi.endpoints.login.initiate({ email: 'blair@example.test', password: 'password' })).unwrap() })
    await vi.waitFor(() => expect(store.getState().connectionSession.viewer?.id).toBe('2'))
    await act(async () => { oldRequest.resolve(json({}, 401)); await request })
    await vi.waitFor(() => expect(store.getState().connectionSession.status).toBe('ready'))
    expect(store.getState().connectionSession.viewer?.id).toBe('2')
    expect(authApi.endpoints.getMe.select()(store.getState()).data?.user.id).toBe('2')
    expect(router.state.location.pathname).toBe('/u/blair/friends/requests')
    expect(screen.getByRole('heading', { name: 'Private friends' })).toBeInTheDocument()
    expect(probes).toBeGreaterThanOrEqual(3)
  })

  it('hides private content on a failed probe and keeps a retryable session error', async () => {
    let fail = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/me')) return fail ? json({}, 500) : json(me())
      if (url.includes('/api/friends?')) return json({}, 401)
      throw new Error(`Unexpected fetch: ${url}`)
    }))
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate()).unwrap()
    const router = renderAt('/u/alex/friends/all', store)
    fail = true
    await act(async () => { await store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'accepted' })) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Session unavailable')
    expect(screen.getByRole('button', { name: 'Retry session' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Private friends' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/u/alex/friends/all')
  })

  it.each(['/u/alex', '/u/alex/about', '/u/alex/reviews', '/u/alex/friendsomething', '/u/alex/friendsomething/all'])('keeps public route %s open on a real /me 401', async (path) => {
    const fetchMock = vi.fn(async () => json({}, 401))
    vi.stubGlobal('fetch', fetchMock)
    const store = createTestStore()
    const router = renderAt(path, store)
    await act(async () => { await store.dispatch(authApi.endpoints.getMe.initiate()) })
    expect(router.state.location.pathname).toBe(path)
    expect(screen.getByRole('heading', { name: 'Public profile' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['/login', '/register', '/forgot-password'])('avoids guest probe reset loops at %s', async (path) => {
    const fetchMock = vi.fn(async () => json({}, 401))
    vi.stubGlobal('fetch', fetchMock)
    const store = createTestStore()
    const router = renderAt(path, store)
    await act(async () => { await store.dispatch(authApi.endpoints.getMe.initiate()) })
    expect(router.state.location.pathname).toBe(path)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(authApi.endpoints.getMe.select()(store.getState()).status).toBe('rejected')
  })

  it.each([403, 500, 419])('preserves private navigation and CSRF handling for status %s', async (status) => {
    let listCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/me')) return json(me())
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/api/friends?')) { listCalls++; return json({}, status) }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate()).unwrap()
    const router = renderAt('/u/alex/friends/all', store)
    await act(async () => { await store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'accepted' })) })
    expect(router.state.location.pathname).toBe('/u/alex/friends/all')
    expect(store.getState().connectionSession.status).toBe('ready')
    expect(listCalls).toBe(status === 419 ? 2 : 1)
    expect(fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/api/me'))).toHaveLength(1)
  })
})
