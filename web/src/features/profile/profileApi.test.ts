import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { createTestStore } from '@/test/renderWithProviders'
import { connectionApi } from '@/features/connection/connectionApi'
import { authApi } from '@/features/auth/authApi'
import { profileApi } from './profileApi'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let store: ReturnType<typeof createTestStore>
beforeEach(() => { store = createTestStore(); document.cookie = 'XSRF-TOKEN=test; path=/' })
afterEach(() => { store.dispatch(authApi.util.resetApiState()); store.dispatch(profileApi.util.resetApiState()); store.dispatch(connectionApi.util.resetApiState()); vi.unstubAllGlobals() })

describe('profile changes invalidate separate connection caches', () => {
  it.each(['name', 'username', 'avatar', 'failed name'] as const)('%s refreshes Friends, discovery and relationship only on successful change', async (kind) => {
    const reads = new Map<string, number>()
    let body: Request | undefined
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname
      if (request.method !== 'GET') { body = request.clone(); return json({ user: {} }, kind === 'failed name' ? 422 : 200) }
      const key = path + url.search
      reads.set(key, (reads.get(key) ?? 0) + 1)
      if (path === '/api/friends') return json({ friends: [], meta: { total: 0, next_cursor: null } })
      if (path.endsWith('/find')) return json({ people: [], meta: { next_cursor: null } })
      if (path.includes('/relationship/')) return json({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (path === '/api/connections') return json({ connections: [], meta: { next_cursor: null } })
      if (path.endsWith('/timeline')) return json({ timeline: [], meta: { next_cursor: null, tab: 'left', profile_username: 'old-name' } })
      return json({ profile: { id: 1, username: 'old-name' } })
    }))
    const queries = [
      store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'accepted' })),
      store.dispatch(connectionApi.endpoints.findFriends.initiate({ viewerId: '1', search: 'Alice' })),
      store.dispatch(connectionApi.endpoints.getFriendRelationship.initiate({ viewerId: '1', targetId: 8 })),
      store.dispatch(profileApi.endpoints.getPublicProfile.initiate('old-name')),
      store.dispatch(connectionApi.endpoints.getConnectionsRail.initiate()),
      store.dispatch(connectionApi.endpoints.getPendingConnectionRequests.initiate()),
      store.dispatch(connectionApi.endpoints.getProfileTimeline.initiate({ username: 'old-name', tab: 'left' })),
    ]
    await Promise.all(queries)
    if (kind === 'username') {
      await store.dispatch(profileApi.endpoints.updateOwnUsername.initiate({ username: 'new-name' })).unwrap()
      expect(new URL(body!.url).pathname).toBe('/api/profile/username')
      expect(await body!.json()).toEqual({ username: 'new-name' })
    } else if (kind === 'avatar') {
      const formData = new FormData(); formData.append('avatar', new Blob(['image'], { type: 'image/png' }), 'avatar.png')
      await store.dispatch(profileApi.endpoints.updateOwnAvatar.initiate({ username: 'old-name', formData })).unwrap()
      expect(new URL(body!.url).pathname).toBe('/api/avatar')
      expect(body!.headers.get('content-type')).toContain('multipart/form-data')
    } else {
      await store.dispatch(profileApi.endpoints.updateOwnProfile.initiate({ display_name: 'New', username: 'old-name' }))
      expect(new URL(body!.url).pathname).toBe('/api/profile')
      expect(body!.method).toBe('PATCH')
      expect(await body!.json()).toEqual({ display_name: 'New', username: 'old-name' })
    }
    await waitFor(() => expect([...reads.entries()].filter(([path]) => path.startsWith('/api/friends')).map(([, count]) => count)).toEqual(Array(3).fill(kind === 'failed name' ? 1 : 2)))
    await waitFor(() => expect([reads.get('/api/connections'), reads.get('/api/connections?state=pending')]).toEqual(Array(2).fill(kind === 'failed name' ? 1 : 2)))
    expect(reads.get('/api/u/old-name/timeline?tab=left')).toBe(1)
    if (kind === 'username') await waitFor(() => expect(reads.get('/api/u/old-name')).toBe(2))
    queries.forEach((query) => query.unsubscribe())
  })
})
