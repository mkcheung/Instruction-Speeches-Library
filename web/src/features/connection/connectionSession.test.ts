import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { authApi } from '@/features/auth/authApi'
import type { MeResponse } from '@/features/auth/types'
import { createTestStore } from '@/test/renderWithProviders'
import { connectionApi } from './connectionApi'
import { selectConnectionSession, selectEligibleConnectionViewer, revalidateConnectionSession } from './connectionSession'

const me = (id: string, roles: string[] = [], username: string | null = `person-${id}`): MeResponse => ({
  user: { id, username, roles, email: `${id}@test.local`, first_name: id, last_name: null,
    display_name: id, email_verified: true, onboarding_completed: true, onboarding_step: 4,
    storage_bytes_used: 0, quota_bytes: 100, uploads_in_flight: 0 },
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>((yes) => { resolve = yes }); return { promise, resolve } }
const stores: ReturnType<typeof createTestStore>[] = []
function makeStore() { const store = createTestStore(); stores.push(store); return store }
beforeEach(() => { document.cookie = 'XSRF-TOKEN=test; path=/' })
afterEach(() => { for (const store of stores.splice(0)) { store.dispatch(authApi.util.resetApiState()); store.dispatch(connectionApi.util.resetApiState()) } vi.unstubAllGlobals() })

describe('connection session authority in the real test store', () => {
  it.each([['admin'], ['member', 'super_admin']])('excludes administrative roles %s', async (...roles) => {
    const store = makeStore()
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('a', roles.flat())))
    expect(selectEligibleConnectionViewer(store.getState())).toBeNull()
    expect(selectConnectionSession(store.getState()).status).toBe('ready')
  })

  it('supports RTK upserts, excludes missing username, and hides during failed/retried revalidation', async () => {
    const store = makeStore()
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('a', [], null)))
    expect(selectEligibleConnectionViewer(store.getState())).toBeNull()
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('a')))
    expect(selectEligibleConnectionViewer(store.getState())).toEqual({ id: 'a', username: 'person-a' })
    const pending = deferred()
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    const query = store.dispatch(authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true, subscribe: false }))
    expect(selectEligibleConnectionViewer(store.getState())).toBeNull()
    pending.resolve(json({ message: 'Unavailable' }, 503))
    await query
    expect(selectConnectionSession(store.getState()).status).toBe('error')
    expect(selectEligibleConnectionViewer(store.getState())).toBeNull()
  })

  it.each(['logout', 'auth reset', 'getMe 401', 'Friends 401', 'identity change'])('clears protected data on %s', async (event) => {
    const store = makeStore()
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('a')))
    const args = { viewerId: 'a', view: 'accepted' as const }
    await store.dispatch(connectionApi.util.upsertQueryData('getFriends', args, { friends: [], meta: { total: 7, next_cursor: null } }))
    vi.stubGlobal('fetch', vi.fn(async () => json({}, event.includes('401') ? 401 : 200)))
    if (event === 'logout') await store.dispatch(authApi.endpoints.logout.initiate())
    if (event === 'auth reset') store.dispatch(authApi.util.resetApiState())
    if (event === 'identity change') await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('b')))
    if (event === 'getMe 401') await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true, subscribe: false }))
    if (event === 'Friends 401') await store.dispatch(connectionApi.endpoints.getFriends.initiate(args, { forceRefetch: true, subscribe: false }))
    expect(connectionApi.endpoints.getFriends.select(args)(store.getState()).data).toBeUndefined()
    expect(selectEligibleConnectionViewer(store.getState())?.id).toBe(event === 'identity change' ? 'b' : undefined)
  })

  it('does not reset the connection cache again for a 401 that arrives while already anonymous', async () => {
    // A public page keeps an auth-only query mounted (the profile timeline). Its 401 is the expected answer for an
    // anonymous visitor; resetting the cache on each one would resubscribe the query and loop 401 -> reset -> refetch.
    const store = makeStore()
    const fetchMock = vi.fn(async () => json({ message: 'Unauthenticated.' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('a')))
    const args = { username: 'alice', tab: 'left' as const }
    await store.dispatch(connectionApi.endpoints.getProfileTimeline.initiate(args, { forceRefetch: true, subscribe: false }))
    expect(selectConnectionSession(store.getState()).status).toBe('anonymous')
    const generation = selectConnectionSession(store.getState()).generation

    await store.dispatch(connectionApi.endpoints.getProfileTimeline.initiate(args, { forceRefetch: true, subscribe: false }))
    await store.dispatch(connectionApi.endpoints.getProfileTimeline.initiate(args, { forceRefetch: true, subscribe: false }))

    expect(selectConnectionSession(store.getState()).generation).toBe(generation)
    expect(selectConnectionSession(store.getState()).status).toBe('anonymous')
  })

  it('hides probes returning the old cookie identity while a new login is in progress', async () => {
    const store = makeStore()
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('a')))
    const login = deferred()
    let loggedIn = false
    vi.stubGlobal('fetch', vi.fn((request: Request) => {
      if (new URL(request.url).pathname === '/login') return login.promise
      return Promise.resolve(json(me(loggedIn ? 'b' : 'a')))
    }))
    const loginQuery = store.dispatch(authApi.endpoints.login.initiate({ email: 'b@test.local', password: 'secret' }))
    await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true, subscribe: false }))
    expect(selectEligibleConnectionViewer(store.getState())).toBeNull()
    loggedIn = true
    login.resolve(json(me('b')))
    await loginQuery
    await waitFor(() => expect(selectEligibleConnectionViewer(store.getState())?.id).toBe('b'))
  })

  it.each([200, 401])('never revives A when old getMe resolves (%s) after logout and B login', async (status) => {
    const old = deferred()
    const calls: string[] = []
    let meCalls = 0
    vi.stubGlobal('fetch', vi.fn((request: Request) => {
      const url = new URL(request.url).pathname; calls.push(url)
      if (url === '/api/me' && ++meCalls === 1) return old.promise
      return Promise.resolve(json(url === '/logout' ? {} : me('b')))
    }))
    const store = makeStore()
    const oldQuery = store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false }))
    await waitFor(() => expect(calls).toContain('/api/me'))
    await store.dispatch(authApi.endpoints.logout.initiate()).unwrap()
    await store.dispatch(authApi.endpoints.login.initiate({ email: 'b@test.local', password: 'secret' })).unwrap()
    const seen: Array<string | undefined> = []
    const unsubscribe = store.subscribe(() => { seen.push(selectEligibleConnectionViewer(store.getState())?.id) })
    old.resolve(json(me('a'), status))
    await oldQuery
    await waitFor(() => expect(selectEligibleConnectionViewer(store.getState())?.id).toBe('b'))
    expect(seen).not.toContain('a')
    expect(meCalls).toBeGreaterThan(1)
    unsubscribe()
  })

  it.each([200, 401])('ignores late A connection response (%s) after switching to B', async (status) => {
    const store = makeStore()
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('a')))
    const old = deferred(); const calls = vi.fn(() => old.promise); vi.stubGlobal('fetch', calls)
    const args = { viewerId: 'a', view: 'accepted' as const }
    const query = store.dispatch(connectionApi.endpoints.getFriends.initiate(args, { subscribe: false }))
    await waitFor(() => expect(calls).toHaveBeenCalled())
    // A fresh identity change must also advance the generation, not only reset queries.
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('b')))
    const response = json({ friends: [], meta: { total: 99, next_cursor: null } }, status)
    old.resolve(response)
    await query
    // Cache reset can settle the query handle before its transport completes.
    await waitFor(() => expect(response.bodyUsed).toBe(true))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(selectEligibleConnectionViewer(store.getState())?.id).toBe('b')
    expect(connectionApi.endpoints.getFriends.select(args)(store.getState()).data).toBeUndefined()
  })

  it('quarantines cached data immediately on explicit session verification', async () => {
    const store = makeStore()
    await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, me('a')))
    const response = deferred(); vi.stubGlobal('fetch', vi.fn(() => response.promise))
    store.dispatch(revalidateConnectionSession())
    expect(selectEligibleConnectionViewer(store.getState())).toBeNull()
    response.resolve(json(me('a')))
    await waitFor(() => expect(selectEligibleConnectionViewer(store.getState())?.id).toBe('a'))
  })
})
