import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { createTestStore } from '@/test/renderWithProviders'
import { friendsResponse, makeFriend, relationship as relationshipResponse } from '@/test/friendsFixtures'
import { connectionApi } from './connectionApi'
import { connectionErrorMessage, selectConnectionSession } from './connectionSession'

const friend = makeFriend({ connection_id: 12, person: { id: 8, name: 'Alice Example', username: 'alice', avatar_url: '/avatar.jpg' }, mutual_friends_count: 3, requested_at: null, connected_at: '2026-01-01T00:00:00Z' })
const friends = friendsResponse([friend], { total: 24, next_cursor: 'opaque+/=' })
const relationship = relationshipResponse({ state: 'pending', direction: 'incoming', connection_id: 12 })
const connection = { id: 12, state: 'pending', initiated_by_id: 8, note: null, requested_at: null, responded_at: null, connected_at: null }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let store: ReturnType<typeof createTestStore>
beforeEach(() => { store = createTestStore(); document.cookie = 'XSRF-TOKEN=test; path=/' })
afterEach(() => { store.dispatch(connectionApi.util.resetApiState()); vi.unstubAllGlobals() })

describe('Friends wire contracts and cache partitioning', () => {
  it('keeps the CSRF 419 retry and represents transport failures', async () => {
    const calls: string[] = []
    let posts = 0
    vi.stubGlobal('fetch', vi.fn(async (request: Request | string) => {
      const path = new URL(typeof request === 'string' ? request : request.url).pathname
      calls.push(path)
      if (path === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
      return ++posts === 1 ? json({ message: 'Expired' }, 419) : json({ connection })
    }))
    expect(await store.dispatch(connectionApi.endpoints.sendConnectionRequest.initiate({ user_id: 8 })).unwrap()).toEqual(connection)
    expect(calls).toEqual(['/api/connections', '/sanctum/csrf-cookie', '/api/connections'])
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network offline') }))
    const result = await store.dispatch(connectionApi.endpoints.findFriends.initiate({ viewerId: '1', search: 'Alice' }, { subscribe: false }))
    expect(result.error).toMatchObject({ status: 'FETCH_ERROR' })
    expect(connectionErrorMessage(result.error)).toContain('Check your connection')
  })

  it('sends normalized view/search/cursor only, preserves list metadata and partitions viewer cache', async () => {
    const calls: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => { calls.push(new URL(request.url)); return json(friends) }))
    const args = { viewerId: '1', view: 'accepted' as const, search: ' Alice % ', cursor: 'opaque+/=' }
    expect(await store.dispatch(connectionApi.endpoints.getFriends.initiate(args, { subscribe: false })).unwrap()).toEqual(friends)
    expect(Object.fromEntries(calls[0].searchParams)).toEqual({ view: 'accepted', search: 'Alice %', cursor: 'opaque+/=' })
    expect(calls[0].pathname).toBe('/api/friends')
    await store.dispatch(connectionApi.endpoints.getFriends.initiate({ ...args, search: 'Alice %' }, { subscribe: false })).unwrap()
    expect(calls).toHaveLength(1)
    expect(connectionApi.endpoints.getFriends.select({ ...args, viewerId: '2' })(store.getState()).data).toBeUndefined()
    await store.dispatch(connectionApi.endpoints.getFriends.initiate({ ...args, viewerId: '2' }, { subscribe: false })).unwrap()
    expect(calls).toHaveLength(2)
  })

  it('preserves incoming list, discovery without usernames and targeted relationship envelopes', async () => {
    const calls: URL[] = []
    const people = { people: [{ person: { id: 8, name: 'Alice', avatar_url: null }, mutual_friends_count: 0 }], meta: { next_cursor: null } }
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      const url = new URL(request.url); calls.push(url)
      return json(url.pathname.includes('relationship') ? relationship : url.pathname.endsWith('/find') ? people : friends)
    }))
    expect(await store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'incoming' }, { subscribe: false })).unwrap()).toEqual(friends)
    expect(await store.dispatch(connectionApi.endpoints.findFriends.initiate({ viewerId: '1', search: ' Alice ', cursor: 'next' }, { subscribe: false })).unwrap()).toEqual(people)
    expect(await store.dispatch(connectionApi.endpoints.getFriendRelationship.initiate({ viewerId: '1', targetId: 8 }, { subscribe: false })).unwrap()).toEqual(relationship)
    expect(calls.map((url) => url.pathname)).toEqual(['/api/friends', '/api/friends/find', '/api/friends/relationship/8'])
    expect(Object.fromEntries(calls[0].searchParams)).toEqual({ view: 'incoming' })
    expect(Object.fromEntries(calls[1].searchParams)).toEqual({ search: 'Alice', cursor: 'next' })
    expect(calls[2].search).toBe('')
  })

  it('shares trimmed discovery cache entries only within the same viewer partition', async () => {
    const fetch = vi.fn(async () => json({ people: [], meta: { next_cursor: null } }))
    vi.stubGlobal('fetch', fetch)
    const args = { viewerId: '1', search: ' Alice ' }
    await store.dispatch(connectionApi.endpoints.findFriends.initiate(args, { subscribe: false })).unwrap()
    await store.dispatch(connectionApi.endpoints.findFriends.initiate({ ...args, search: 'Alice', cursor: null }, { subscribe: false })).unwrap()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(connectionApi.endpoints.findFriends.select({ ...args, viewerId: '2' })(store.getState()).data).toBeUndefined()
    await store.dispatch(connectionApi.endpoints.findFriends.initiate({ ...args, viewerId: '2' }, { subscribe: false })).unwrap()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['sendConnectionRequest', 'acceptConnection', 'declineConnection', 'blockConnection', 'unblockConnection'] as const)('%s sends its existing contract and refreshes every Friends/legacy projection', async (endpoint) => {
    const reads = new Map<string, number>(); let mutation: Request | undefined
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      if (request.method === 'POST') { mutation = request.clone(); return json({ connection }) }
      reads.set(url.pathname + url.search, (reads.get(url.pathname + url.search) ?? 0) + 1)
      if (url.pathname === '/api/connections') return json({ connections: [], meta: { next_cursor: null } })
      if (url.pathname.endsWith('/timeline')) return json({ timeline: [], meta: { next_cursor: null, tab: 'left', profile_username: 'alice' } })
      return json(url.pathname.includes('/relationship/') ? relationship : url.pathname.endsWith('/find') ? { people: [], meta: { next_cursor: null } } : friends)
    }))
    const subscriptions = [
      store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'accepted' })),
      store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'accepted', search: 'Alice', cursor: 'next' })),
      store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'incoming' })),
      store.dispatch(connectionApi.endpoints.findFriends.initiate({ viewerId: '1', search: 'Alice' })),
      store.dispatch(connectionApi.endpoints.getFriendRelationship.initiate({ viewerId: '1', targetId: 8 })),
      store.dispatch(connectionApi.endpoints.getConnectionsRail.initiate()),
      store.dispatch(connectionApi.endpoints.getPendingConnectionRequests.initiate()),
      store.dispatch(connectionApi.endpoints.getProfileTimeline.initiate({ username: 'alice', tab: 'left' })),
    ]
    await Promise.all(subscriptions)
    const result = endpoint === 'sendConnectionRequest'
      ? await store.dispatch(connectionApi.endpoints.sendConnectionRequest.initiate({ user_id: 8, note: 'Hello' })).unwrap()
      : await store.dispatch(connectionApi.endpoints[endpoint].initiate(12)).unwrap()
    expect(result).toEqual(connection)
    expect(mutation?.method).toBe('POST')
    expect(new URL(mutation!.url).pathname).toBe(endpoint === 'sendConnectionRequest' ? '/api/connections' : `/api/connections/12/${endpoint.replace('Connection', '')}`)
    if (endpoint === 'sendConnectionRequest') expect(await mutation!.json()).toEqual({ user_id: 8, note: 'Hello' })
    else expect(await mutation!.text()).toBe('')
    await waitFor(() => expect([...reads.values()]).toEqual(Array(8).fill(2)))
    subscriptions.forEach((subscription) => subscription.unsubscribe())
  })

  it.each([401, 403, 404, 409, 422, 429, 503])('retains real HTTP %s failures for useful recovery text', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Request failed' }, status)))
    const result = await store.dispatch(connectionApi.endpoints.findFriends.initiate({ viewerId: '1', search: 'Alice' }, { subscribe: false }))
    // A 401 withdraws proof and asks /me (here also 401): anonymity is decided by that probe.
    if (status === 401) await waitFor(() => expect(selectConnectionSession(store.getState()).status).toBe('anonymous'))
    else expect(result.error).toMatchObject({ status })
    expect(connectionErrorMessage(result.error ?? { status })).toMatch(status === 401 ? /Sign in/ : status === 429 ? /Wait a moment/ : status === 403 ? /unavailable for this account/ : status === 503 ? /Check your connection/ : /Refresh/)
  })
})
