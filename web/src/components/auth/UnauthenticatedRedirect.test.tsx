import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { createTestStore } from '@/test/renderWithProviders'
import { UnauthenticatedRedirect } from '@/components/auth/UnauthenticatedRedirect'
import { hardNavigation } from '@/lib/hardNavigation'
import { RETURN_PATH_KEY } from '@/features/auth/returnPath'
import { selectAuthSession } from '@/features/auth/authSession'
import { privacyApi } from '@/features/privacy/privacyApi'
import type { CurrentUser } from '@/features/auth/types'
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
 * 401s for every anonymous visitor
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

const me = (id = '1', username = 'alex') => ({ user: { id, username, email: `${username}@example.test`, roles: ['member'], first_name: username, last_name: 'Smith', display_name: username, email_verified: true, onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 0, quota_bytes: 1000, uploads_in_flight: 0 } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const urlOf = (input: RequestInfo | URL) => input instanceof Request ? input.url : input.toString()
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const alex = (): CurrentUser => ({ ...me().user, onboarding_step: 4 })

describe('UnauthenticatedRedirect with the real store', () => {
  let replace: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    clearCookies(); document.cookie = 'XSRF-TOKEN=test; path=/'
    window.sessionStorage.clear()
    replace = vi.spyOn(hardNavigation, 'replace').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  /** An authenticated document whose next private request 401s and whose follow-up /me is `probe`. */
  async function expire(path: string, probe: () => Response | Promise<Response>) {
    let expired = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/me')) return expired ? probe() : json(me())
      if (url.includes('/api/privacy/exports')) return json({}, 401)
      if (url.includes('/api/friends?')) return json({}, 401)
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate()).unwrap()
    const router = renderAt(path, store)
    expired = true
    return { store, router, fetchMock }
  }
  const trigger = (store: ReturnType<typeof createTestStore>) => act(async () => {
    await store.dispatch(privacyApi.endpoints.getExports.initiate(undefined, { subscribe: false }))
  })

  it.each(['/', '/verify', '/u/alex', '/u/alex/about', '/u/alex/friendsomething', '/login', '/register', '/forgot-password'])(
    'never navigates an initially anonymous document at %s on its expected 401s', async (path) => {
      const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => json({}, 401))
      vi.stubGlobal('fetch', fetchMock)
      const store = createTestStore()
      const router = renderAt(path, store)
      await act(async () => { await store.dispatch(authApi.endpoints.getMe.initiate()) })
      await trigger(store)
      await trigger(store)
      expect(router.state.location.pathname).toBe(path)
      expect(replace).not.toHaveBeenCalled()
      expect(selectAuthSession(store.getState()).status).toBe('anonymous')
      expect(fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/api/me'))).toHaveLength(1)
    })

  it.each(['/dashboard', '/weird'])('hard-replaces /login with a stored safe return path once the session is confirmed gone from %s', async (path) => {
    const { store } = await expire(`${path}?token=secret#frag`, () => json({}, 401))
    await trigger(store)
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBe(path) // pathname only: no query, hash or secret
    expect(selectAuthSession(store.getState()).status).toBe('lost')
  })

  it.each(['/u/alex/friends', '/u/alex/friends/', '/u/alex/friends/requests', '/U/alex/FRIENDS/all/'])('treats %s as private: stored path, hard /login', async (path) => {
    const { store } = await expire(`${path}?search=lee#requests`, () => json({}, 401))
    await act(async () => { await store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'incoming' })) })
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBe(path)
    expect(Object.keys(store.getState().connectionApi.queries)).toHaveLength(0)
  })

  it.each([['/', '/'], ['/u/alex', '/u/alex'], ['/verify', '/verify'], ['/login', '/login']])('reloads a previously authenticated %s once instead of storing a return path', async (path, expected) => {
    const { store } = await expire(`${path}?x=1`, () => json({}, 401))
    await trigger(store)
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(`${expected}?x=1`))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull()
  })

  it('hard-reloads the current route when the fresh probe names another account, never exposing it to the old store', async () => {
    const { store, router } = await expire('/dashboard?tab=1', () => json(me('2', 'blair')))
    await trigger(store)
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard?tab=1'))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(selectAuthSession(store.getState()).viewer).toBeNull()
    expect(selectAuthSession(store.getState()).status).toBe('replaced')
  })

  it('does not navigate when the fresh probe confirms the same account', async () => {
    const { store, fetchMock } = await expire('/dashboard', () => json(me()))
    await trigger(store)
    await vi.waitFor(() => expect(selectAuthSession(store.getState()).status).toBe('accepted'))
    expect(replace).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/api/me'))).toHaveLength(2)
  })

  it('coalesces concurrent 401s into one fresh /me', async () => {
    const probe = deferred<Response>()
    const { store, fetchMock } = await expire('/dashboard', () => probe.promise)
    await act(async () => {
      await Promise.all([1, 2, 3].map(() => store.dispatch(privacyApi.endpoints.getExports.initiate(undefined, { subscribe: false, forceRefetch: true }))))
    })
    expect(fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/api/me'))).toHaveLength(2)
    expect(replace).not.toHaveBeenCalled() // a 401 alone proves nothing
    await act(async () => probe.resolve(json({}, 401)))
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
  })

  it('an anonymous visitor on a private Friends route is sent to /login softly, keeping router state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)))
    const store = createTestStore()
    const router = renderAt('/u/alex/friends/requests?search=lee#requests', store)
    await act(async () => { await store.dispatch(authApi.endpoints.getMe.initiate()) })
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.state.from).toMatchObject({ pathname: '/u/alex/friends/requests', search: '?search=lee', hash: '#requests' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('keeps account B signed out of A\'s late Friends 401: B is never adopted in place', async () => {
    const oldRequest = deferred<Response>()
    let account = me()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/me')) return json(account)
      if (url.endsWith('/login')) { account = me('2', 'blair'); return json(account) }
      if (url.includes('/api/friends?')) return oldRequest.promise
      throw new Error(`Unexpected fetch: ${url}`)
    }))
    const store = createTestStore({ viewer: alex() })
    const router = renderAt('/u/alex/friends/requests', store)
    const request = store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'incoming' }))
    await act(async () => { await store.dispatch(authApi.endpoints.login.initiate({ email: 'blair@example.test', password: 'password' })).unwrap() })
    expect(selectAuthSession(store.getState()).status).toBe('navigating')
    const probes = vi.mocked(fetch).mock.calls.filter(([input]) => urlOf(input).endsWith('/api/me')).length
    await act(async () => { oldRequest.resolve(json({}, 401)); await request })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(selectAuthSession(store.getState()).status).toBe('navigating')
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => urlOf(input).endsWith('/api/me')).length).toBe(probes)
    expect(router.state.location.pathname).toBe('/u/alex/friends/requests')
    expect(screen.queryByRole('heading', { name: 'Private friends' })).not.toBeInTheDocument()
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
    expect(replace).not.toHaveBeenCalled()
    fail = false
    await act(async () => { screen.getByRole('button', { name: 'Retry session' }).click() })
    expect(await screen.findByRole('heading', { name: 'Private friends' })).toBeInTheDocument()
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
    expect(replace).not.toHaveBeenCalled()
  })
})
