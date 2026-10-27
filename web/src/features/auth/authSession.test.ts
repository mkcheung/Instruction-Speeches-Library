import { createElement } from 'react'
import { Provider } from 'react-redux'
import { renderHook } from '@testing-library/react'
import { useGetExportsQuery } from '@/features/privacy/privacyApi'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '@/features/auth/authApi'
import { privacyApi } from '@/features/privacy/privacyApi'
import { speechApi } from '@/features/speech/speechApi'
import { connectionApi } from '@/features/connection/connectionApi'
import { selectEligibleConnectionViewer, selectConnectionSession } from '@/features/connection/connectionSession'
import { createAppStore } from '@/app/createAppStore'
import { clearCookies, createTestStore } from '@/test/renderWithProviders'
import {
  acceptedAuthSessionState,
  captureWriteProof,
  isWriteProofCurrent,
  selectAcceptedViewer,
  selectAuthSession,
} from './authSession'
import { AUTH_CHANGE_STORAGE_KEY, installAuthSessionBrowserListeners } from './authSessionBrowser'
import type { CurrentUser } from './types'

/**
 * R1 acceptance: the REAL composed store (every reducer, the identity
 * middleware, connection and commentary adapters, the real baseQuery) with
 * only HTTP mocked. Fake-hook tests cannot prove cache partitioning.
 */
const user = (id: string, over: Partial<CurrentUser> = {}): CurrentUser => ({
  id, username: `person-${id}`, roles: [], email: `${id}@test.local`, first_name: id, last_name: null,
  display_name: id, email_verified: true, onboarding_completed: true, onboarding_step: 4,
  storage_bytes_used: 0, quota_bytes: 100, uploads_in_flight: 0, ...over,
})
const meOf = (u: CurrentUser) => ({ user: u })
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function deferred<T = Response>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const pathOf = (input: RequestInfo | URL) => new URL(input instanceof Request ? input.url : input.toString()).pathname

type Handler = (call: number) => Response | Promise<Response>
function mockHttp(routes: Record<string, Handler>) {
  const calls: Record<string, number> = {}
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = pathOf(input)
    calls[path] = (calls[path] ?? 0) + 1
    if (path === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    const handler = routes[path]
    if (!handler) throw new Error(`unexpected fetch: ${path}`)
    return handler(calls[path])
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

const exportRow = { id: 7, kind: 'full', status: 'ready' }
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const A = user('a')
const B = user('b')
const status = (store: ReturnType<typeof createTestStore>) => selectAuthSession(store.getState()).status

async function seedPrivateCaches(store: ReturnType<typeof createTestStore>) {
  await store.dispatch(privacyApi.util.upsertQueryData('getExports', undefined, [exportRow as never]))
  await store.dispatch(privacyApi.util.upsertQueryData('getExportDownloadUrl', 7, { url: 'https://signed.example/a-export', requestStartedAtMonotonicMs: 0, requestSeq: 1 }))
  await store.dispatch(connectionApi.util.upsertQueryData('getFriends', { viewerId: 'a', view: 'accepted' },
    { friends: [], meta: { total: 3, next_cursor: null } }))
}
const exportList = (store: ReturnType<typeof createTestStore>) => privacyApi.endpoints.getExports.select()(store.getState()).data
const exportUrl = (store: ReturnType<typeof createTestStore>) => privacyApi.endpoints.getExportDownloadUrl.select(7)(store.getState()).data?.url

beforeEach(() => { clearCookies(); document.cookie = 'XSRF-TOKEN=test; path=/' })
const uninstallers: Array<() => void> = []
/** Listeners live on `window`: always removed, even when an assertion fails first. */
function listen(store: Parameters<typeof installAuthSessionBrowserListeners>[0], options?: Parameters<typeof installAuthSessionBrowserListeners>[1]) {
  uninstallers.push(installAuthSessionBrowserListeners(store, options))
}
afterEach(() => { uninstallers.splice(0).forEach((uninstall) => uninstall()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('initial document identity', () => {
  it.each([
    ['member', user('m')],
    ['admin', user('ad', { roles: ['admin'] })],
    ['super_admin', user('sa', { roles: ['super_admin'] })],
    ['roleless without username (incomplete onboarding)', user('n', { username: null, onboarding_completed: false, onboarding_step: 1 })],
  ])('binds the document to a %s identity', async (_label, u) => {
    mockHttp({ '/api/me': () => json(meOf(u)) })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    expect(selectAcceptedViewer(store.getState())?.id).toBe(u.id)
    expect(selectAuthSession(store.getState()).documentUserId).toBe(u.id)
    // Friends eligibility is a narrower derivation: admins and username-less users are authenticated, not anonymous.
    const eligible = selectEligibleConnectionViewer(store.getState())
    if (u.roles.length || !u.username) expect(eligible).toBeNull()
    else expect(eligible?.id).toBe(u.id)
    expect(selectConnectionSession(store.getState()).status).toBe('ready')
  })

  it('treats a 401 probe as anonymous and a 5xx probe as unknown, never anonymous', async () => {
    let code = 401
    mockHttp({ '/api/me': () => json({}, code) })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    expect(status(store)).toBe('anonymous')
    const second = createTestStore()
    code = 503
    await second.dispatch(authApi.endpoints.getMe.initiate())
    expect(status(second)).toBe('unresolved')
    expect(selectAuthSession(second.getState()).error).toEqual({ status: 503 })
    expect(selectAcceptedViewer(second.getState())).toBeNull()
  })

  it('accepts only the latest probe: an older answer cannot bind the document', async () => {
    const first = deferred()
    let n = 0
    mockHttp({ '/api/me': () => (++n === 1 ? first.promise : json(meOf(B))) })
    const store = createTestStore()
    const old = store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false }))
    await vi.waitFor(() => expect(n).toBe(1))
    store.dispatch(authApi.util.upsertQueryData('getMe', undefined, meOf(B)))
    await vi.waitFor(() => expect(selectAuthSession(store.getState()).documentUserId).toBe('b'))
    first.resolve(json(meOf(A)))
    await old
    await settle()
    expect(selectAuthSession(store.getState()).documentUserId).toBe('b')
    expect(selectAcceptedViewer(store.getState())?.id).toBe('b')
  })
})

describe('A -> session expiry -> B in one document', () => {
  it('withdraws proof on a private 401, then quarantines A and drops every private cache when /me names B', async () => {
    const probe = deferred()
    let me = 0
    const { calls } = mockHttp({
      '/api/me': () => (++me === 1 ? json(meOf(A)) : probe.promise),
      '/api/speeches': () => json({ message: 'Unauthenticated.' }, 401),
    })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    await seedPrivateCaches(store)
    expect(exportUrl(store)).toContain('a-export')

    await store.dispatch(speechApi.endpoints.listSpeeches.initiate({} as never, { subscribe: false }))
    // 401 alone proves nothing: private UI is hidden and a single fresh /me is pending.
    expect(status(store)).toBe('quarantined')
    expect(selectAcceptedViewer(store.getState())).toBeNull()
    expect(selectEligibleConnectionViewer(store.getState())).toBeNull()
    expect(exportList(store)).toBeDefined() // not dropped until the probe decides
    expect(calls['/api/me']).toBe(2)

    probe.resolve(json(meOf(B)))
    await vi.waitFor(() => expect(status(store)).toBe('replaced'))
    expect(selectAcceptedViewer(store.getState())).toBeNull()
    expect(exportList(store)).toBeUndefined()
    expect(exportUrl(store)).toBeUndefined()
    expect(connectionApi.endpoints.getFriends.select({ viewerId: 'a', view: 'accepted' })(store.getState()).data).toBeUndefined()
    // A's identity is never re-published: B was never accepted by this document.
    expect(selectAuthSession(store.getState()).documentUserId).toBe('a')
    expect(selectAuthSession(store.getState()).viewer).toBeNull()
  })

  it.each([
    ['success', () => json({ exports: [{ ...exportRow, id: 99 }] })],
    ['401', () => json({}, 401)],
    ['500', () => json({}, 500)],
  ])('ignores a late A %s that settles after B was established', async (_label, late) => {
    const old = deferred()
    let me = 0
    const { calls } = mockHttp({
      '/api/me': () => (++me === 1 ? json(meOf(A)) : json(meOf(B))),
      '/api/privacy/exports': () => old.promise,
    })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    const request = store.dispatch(privacyApi.endpoints.getExports.initiate(undefined, { subscribe: false }))
    await vi.waitFor(() => expect(calls['/api/privacy/exports']).toBe(1))
    await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true, subscribe: false }))
    expect(status(store)).toBe('replaced')
    const generation = selectAuthSession(store.getState()).generation
    const meCalls = calls['/api/me']

    old.resolve(late())
    await request
    await settle()
    expect(exportList(store)).toBeUndefined()
    expect(status(store)).toBe('replaced')
    expect(selectAuthSession(store.getState()).generation).toBe(generation)
    expect(calls['/api/me']).toBe(meCalls) // the obsolete 401 did not start another probe
  })

  it('confirms an ended session: A -> anonymous makes the document lost and drops private caches', async () => {
    let me = 0
    mockHttp({
      '/api/me': () => (++me === 1 ? json(meOf(A)) : json({}, 401)),
      '/api/speeches': () => json({}, 401),
    })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    await seedPrivateCaches(store)
    await store.dispatch(speechApi.endpoints.listSpeeches.initiate({} as never, { subscribe: false }))
    await vi.waitFor(() => expect(status(store)).toBe('lost'))
    expect(exportList(store)).toBeUndefined()
    expect(exportUrl(store)).toBeUndefined()
    // Terminal documents refuse private transport instead of repopulating.
    const before = vi.mocked(fetch).mock.calls.length
    const again = await store.dispatch(privacyApi.endpoints.getExports.initiate(undefined, { subscribe: false }))
    expect(again.error).toMatchObject({ error: 'SESSION_CHANGED' })
    expect(vi.mocked(fetch).mock.calls.length).toBe(before)
  })

  it('resumes the same user after a 401 without resetting every domain', async () => {
    const { calls } = mockHttp({
      '/api/me': () => json(meOf(A)),
      '/api/speeches': () => json({}, 401),
    })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    await seedPrivateCaches(store)
    const me = calls['/api/me']
    await store.dispatch(speechApi.endpoints.listSpeeches.initiate({} as never, { subscribe: false }))
    await vi.waitFor(() => expect(status(store)).toBe('accepted'))
    expect(calls['/api/me']).toBe(me + 1)
    expect(exportList(store)).toBeDefined()
    expect(exportUrl(store)).toContain('a-export')
    expect(selectAcceptedViewer(store.getState())?.id).toBe('a')
  })

  it('treats a 5xx during re-proof as uncertainty and recovers on restoration', async () => {
    let code = 200
    mockHttp({
      '/api/me': () => (code === 200 ? json(meOf(A)) : json({}, code)),
      '/api/speeches': () => json({}, 401),
    })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    code = 503
    await store.dispatch(speechApi.endpoints.listSpeeches.initiate({} as never, { subscribe: false }))
    await vi.waitFor(() => expect(status(store)).toBe('uncertain'))
    expect(selectAcceptedViewer(store.getState())).toBeNull()
    expect(selectConnectionSession(store.getState()).status).toBe('error')
    code = 200
    listen(store, { refocusThrottleMs: 0 })
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(status(store)).toBe('accepted'))
  })
})

describe('guest and public documents', () => {
  it('does not probe, reload or change identity for the expected 401s of an anonymous document', async () => {
    const { calls } = mockHttp({ '/api/me': () => json({}, 401), '/api/friends': () => json({}, 401) })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    expect(status(store)).toBe('anonymous')
    const generation = selectAuthSession(store.getState()).generation
    for (let i = 0; i < 3; i++) {
      await store.dispatch(connectionApi.endpoints.getProfileTimeline.initiate({ username: 'alice', tab: 'left' } as never, { forceRefetch: true, subscribe: false }))
    }
    await settle()
    expect(status(store)).toBe('anonymous')
    expect(selectAuthSession(store.getState()).generation).toBe(generation)
    expect(calls['/api/me']).toBe(1)
  })

  it('a cross-tab login seen by an anonymous document is a different identity: replaced', async () => {
    let signedIn = false
    mockHttp({ '/api/me': () => (signedIn ? json(meOf(B)) : json({}, 401)) })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    signedIn = true
    listen(store)
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CHANGE_STORAGE_KEY, newValue: 'n-1' }))
    await vi.waitFor(() => expect(status(store)).toBe('replaced'))
  })
})

describe('login, register and logout attempts', () => {
  it('excludes a probe that raced the changing cookie and never publishes the new account in the old document', async () => {
    const login = deferred()
    const broadcast = vi.fn()
    const store = createAppStore({ authSession: acceptedAuthSessionState(A), autoBatch: false, broadcast })
    const { calls } = mockHttp({
      '/login': () => login.promise,
      '/api/me': () => json(meOf(A)), // still the previous cookie
    })
    const attempt = store.dispatch(authApi.endpoints.login.initiate({ email: 'b@test.local', password: 'secretpass' }))
    expect(status(store as never)).toBe('quarantined')
    expect(selectAcceptedViewer(store.getState())).toBeNull()
    await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true, subscribe: false }))
    expect(status(store as never)).toBe('quarantined')
    expect(selectAcceptedViewer(store.getState())).toBeNull()

    login.resolve(json(meOf(B)))
    await attempt
    expect(status(store as never)).toBe('navigating')
    expect(selectAcceptedViewer(store.getState())).toBeNull()
    expect(selectAuthSession(store.getState()).viewer).toBeNull()
    expect(broadcast).toHaveBeenCalledOnce()
    const meAfter = calls['/api/me']
    await settle()
    expect(status(store as never)).toBe('navigating') // a late probe cannot revive A or adopt B
    expect(calls['/api/me']).toBe(meAfter)
  })

  it.each(['login', 'register'] as const)('a failed %s keeps the form error and makes exactly one fresh probe', async (kind) => {
    const { calls } = mockHttp({
      '/login': () => json({ message: 'bad', errors: {} }, 422),
      '/register': () => json({ message: 'bad', errors: {} }, 422),
      '/api/me': () => json({}, 401),
    })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    const before = calls['/api/me']
    const payload = kind === 'login'
      ? authApi.endpoints.login.initiate({ email: 'a@test.local', password: 'secretpass' })
      : authApi.endpoints.register.initiate({ email: 'a@test.local', password: 'secretpass', password_confirmation: 'secretpass' })
    const result = await store.dispatch(payload as never) as { error?: unknown }
    expect(result.error).toBeDefined()
    await vi.waitFor(() => expect(status(store)).toBe('anonymous'))
    expect(calls['/api/me']).toBe(before + 1)
    expect(selectAuthSession(store.getState()).attempts).toBe(0)
  })

  it('a successful register also ends this document (hard navigation follows) and broadcasts', async () => {
    const broadcast = vi.fn()
    const store = createAppStore({ autoBatch: false, broadcast })
    mockHttp({ '/register': () => json({}, 201), '/api/me': () => json({}, 401) })
    await store.dispatch(authApi.endpoints.getMe.initiate())
    await store.dispatch(authApi.endpoints.register.initiate({ email: 'n@test.local', password: 'secretpass', password_confirmation: 'secretpass' }))
    expect(status(store as never)).toBe('navigating')
    expect(broadcast).toHaveBeenCalledOnce()
  })

  it.each([[200, 'navigating'], [401, 'navigating']])('logout answering %s ends the document, drops private caches and broadcasts', async (code, expected) => {
    const broadcast = vi.fn()
    const store = createAppStore({ authSession: acceptedAuthSessionState(A), autoBatch: false, broadcast })
    mockHttp({ '/logout': () => json({}, code) })
    await seedPrivateCaches(store as never)
    await store.dispatch(authApi.endpoints.logout.initiate())
    expect(status(store as never)).toBe(expected)
    expect(exportList(store as never)).toBeUndefined()
    expect(broadcast).toHaveBeenCalledOnce()
  })

  it('a failed logout leaves the account in place: attempt settles and identity is re-proved', async () => {
    mockHttp({ '/logout': () => json({}, 500), '/api/me': () => json(meOf(A)) })
    const store = createAppStore({ authSession: acceptedAuthSessionState(A), autoBatch: false, broadcast: vi.fn() })
    await store.dispatch(authApi.endpoints.logout.initiate())
    await vi.waitFor(() => expect(status(store as never)).toBe('accepted'))
    expect(selectAuthSession(store.getState()).attempts).toBe(0)
  })

  it('a superseded attempt cannot end the document', async () => {
    const first = deferred()
    let n = 0
    mockHttp({ '/login': () => (++n === 1 ? first.promise : json({}, 422)), '/api/me': () => json({}, 401) })
    const store = createTestStore()
    await store.dispatch(authApi.endpoints.getMe.initiate())
    const one = store.dispatch(authApi.endpoints.login.initiate({ email: 'a@test.local', password: 'secretpass' }))
    await store.dispatch(authApi.endpoints.login.initiate({ email: 'a@test.local', password: 'secretpass' }))
    first.resolve(json(meOf(B)))
    await one
    expect(status(store)).not.toBe('navigating')
    expect(selectAuthSession(store.getState()).attempts).toBe(0)
  })
})

describe('request fencing', () => {
  it.each([
    ['success', () => json({ exports: [{ ...exportRow, id: 99 }] })],
    ['500', () => json({}, 500)],
  ])('a late A %s after an auth attempt began never lands in the cache or as A data', async (_label, late) => {
    const old = deferred()
    let exportCalls = 0
    mockHttp({ '/api/privacy/exports': () => (++exportCalls === 1 ? old.promise : json({ exports: [] })), '/login': () => json({}, 422), '/api/me': () => json(meOf(A)) })
    const store = createTestStore({ viewer: A })
    const request = store.dispatch(privacyApi.endpoints.getExports.initiate(undefined, { subscribe: false }))
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    await store.dispatch(authApi.endpoints.login.initiate({ email: 'b@test.local', password: 'secretpass' }))
    old.resolve(late())
    await request
    await settle()
    // The obsolete answer is discarded; only a fresh request for the re-proved identity may fill the cache.
    expect(exportList(store)?.some((row) => (row as { id: number }).id === 99)).toBeFalsy()
  })

  it('refuses private transport while an auth attempt changes the cookie', async () => {
    const login = deferred()
    const { calls } = mockHttp({ '/login': () => login.promise, '/api/privacy/exports': () => json({ exports: [] }) })
    const store = createTestStore({ viewer: A })
    const attempt = store.dispatch(authApi.endpoints.login.initiate({ email: 'b@test.local', password: 'secretpass' }))
    const blocked = await store.dispatch(privacyApi.endpoints.getExports.initiate(undefined, { subscribe: false }))
    expect(blocked.error).toMatchObject({ error: 'SESSION_CHANGED' })
    expect(calls['/api/privacy/exports']).toBeUndefined()
    login.resolve(json({}, 422))
    await attempt
  })

  it('does not replay a 419 write for an identity that changed during the CSRF refresh', async () => {
    document.cookie = 'XSRF-TOKEN=stale; path=/'
    const csrf = deferred<void>()
    let writes = 0
    const store = createTestStore({ viewer: A })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input)
      if (path === '/sanctum/csrf-cookie') { await csrf.promise; return new Response(null, { status: 204 }) }
      if (path === '/api/account') { writes++; return json({ message: 'CSRF token mismatch.' }, 419) }
      throw new Error(`unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const write = store.dispatch(privacyApi.endpoints.deleteAccount.initiate({ password: 'x' } as never))
    await vi.waitFor(() => expect(writes).toBe(1))
    store.dispatch({ type: 'authSession/externalChange' })
    csrf.resolve()
    const result = await write
    expect(writes).toBe(1)
    expect('error' in result && result.error).toMatchObject({ error: 'SESSION_CHANGED' })
  })

  it('same-user resumption refetches work our fence rejected', async () => {
    const slow = deferred()
    let exportsCalls = 0
    mockHttp({
      '/api/me': () => json(meOf(A)),
      '/api/privacy/exports': () => (++exportsCalls === 1 ? slow.promise : json({ exports: [exportRow] })),
    })
    const store = createTestStore({ viewer: A })
    listen(store)
    const { result } = renderHook(() => useGetExportsQuery(), { wrapper: ({ children }) => createElement(Provider, { store, children }) })
    const request = Promise.resolve(result)
    await vi.waitFor(() => expect(exportsCalls).toBe(1))
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CHANGE_STORAGE_KEY, newValue: 'n-same' }))
    await vi.waitFor(() => expect(status(store)).toBe('accepted'))
    slow.resolve(json({ exports: [{ ...exportRow, id: 1 }] }))
    await request
    await vi.waitFor(() => expect(exportList(store)?.[0]?.id).toBe(7))
    expect(exportsCalls).toBe(2)
  })
})

describe('anonymous resumption', () => {
  it('refetches work our fence rejected once a probe confirms the document is anonymous', async () => {
    const slow = deferred()
    const me = deferred()
    let exportsCalls = 0
    mockHttp({
      '/api/me': () => me.promise,
      '/api/privacy/exports': () => (++exportsCalls === 1 ? slow.promise : json({ exports: [exportRow] })),
    })
    const store = createTestStore()
    listen(store)
    renderHook(() => useGetExportsQuery(), { wrapper: ({ children }) => createElement(Provider, { store, children }) })
    await vi.waitFor(() => expect(exportsCalls).toBe(1))
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CHANGE_STORAGE_KEY, newValue: 'n-anon' }))
    await vi.waitFor(() => expect(selectAuthSession(store.getState()).probing).toBe(true))
    slow.resolve(json({ exports: [] }))
    await settle()
    me.resolve(json({ message: 'Unauthenticated.' }, 401))
    await vi.waitFor(() => expect(status(store)).toBe('anonymous'))
    await vi.waitFor(() => expect(exportsCalls).toBe(2))
  })
})

describe('cross-tab signals and the Back/Forward cache', () => {
  it('applies a nonce once even when BroadcastChannel and storage both deliver it', async () => {
    const { calls } = mockHttp({ '/api/me': () => json(meOf(A)) })
    const store = createTestStore({ viewer: A })
    listen(store)
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CHANGE_STORAGE_KEY, newValue: 'same-nonce' }))
    await vi.waitFor(() => expect(status(store)).toBe('accepted'))
    const generation = selectAuthSession(store.getState()).generation
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CHANGE_STORAGE_KEY, newValue: 'same-nonce' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'x' }))
    await settle()
    expect(selectAuthSession(store.getState()).generation).toBe(generation)
    expect(calls['/api/me']).toBe(1)
  })

  it('quarantines on a cross-tab signal until a probe re-proves identity; a different account is replaced', async () => {
    const probe = deferred()
    mockHttp({ '/api/me': () => probe.promise })
    const store = createTestStore({ viewer: A })
    listen(store)
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CHANGE_STORAGE_KEY, newValue: 'n-2' }))
    expect(status(store)).toBe('quarantined')
    expect(selectAcceptedViewer(store.getState())).toBeNull()
    probe.resolve(json(meOf(B)))
    await vi.waitFor(() => expect(status(store)).toBe('replaced'))
  })

  it('pagehide hides private UI at once; a persisted pageshow forces fresh proof before resuming', async () => {
    const probe = deferred()
    mockHttp({ '/api/me': () => probe.promise })
    const store = createTestStore({ viewer: A })
    listen(store)
    const proof = captureWriteProof(selectAuthSession(store.getState()))!
    window.dispatchEvent(new Event('pagehide'))
    expect(selectAcceptedViewer(store.getState())).toBeNull()
    // A same-user exit flush stays authorised until the document is restored or an auth change lands.
    expect(isWriteProofCurrent(selectAuthSession(store.getState()), proof)).toBe(true)

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(status(store)).toBe('quarantined')
    expect(selectAcceptedViewer(store.getState())).toBeNull() // restored frame stays hidden
    expect(isWriteProofCurrent(selectAuthSession(store.getState()), proof)).toBe(false)
    probe.resolve(json({}, 401))
    await vi.waitFor(() => expect(status(store)).toBe('lost'))
  })

  it('a non-persisted pageshow only unhides', () => {
    const store = createTestStore({ viewer: A })
    listen(store)
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    expect(selectAcceptedViewer(store.getState())?.id).toBe('a')
  })

  it('an auth attempt invalidates a pending write proof', async () => {
    const store = createTestStore({ viewer: A })
    const proof = captureWriteProof(selectAuthSession(store.getState()))!
    mockHttp({ '/login': () => json({}, 422), '/api/me': () => json(meOf(A)) })
    void store.dispatch(authApi.endpoints.login.initiate({ email: 'b@test.local', password: 'secretpass' }))
    expect(isWriteProofCurrent(selectAuthSession(store.getState()), proof)).toBe(false)
    await settle()
  })
})
