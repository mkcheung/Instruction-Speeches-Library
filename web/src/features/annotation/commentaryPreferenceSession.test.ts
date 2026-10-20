import { configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '@/features/auth/authApi'
import { annotationApi } from './annotationApi'
import { commentaryPreferenceSession } from './commentaryPreferenceSession'
import { playbackPreferences } from '@/lib/commentaryPlaybackPreference'
import type { CommentaryPlaybackPreference } from './types'

function makeStore() {
  return configureStore({
    reducer: { [authApi.reducerPath]: authApi.reducer, [annotationApi.reducerPath]: annotationApi.reducer },
    middleware: (getDefault) => getDefault().concat(commentaryPreferenceSession, authApi.middleware, annotationApi.middleware),
  })
}

describe('preference authentication lifetime', () => {
  let account: string | null
  beforeEach(() => {
    account = 'a'
    playbackPreferences.setIdentity(null)
    document.cookie = 'XSRF-TOKEN=test; path=/'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(account ? { user: { id: account } } : { message: 'Unauthenticated.' }), {
      status: account ? 200 : 401, headers: { 'Content-Type': 'application/json' },
    })))
  })
  afterEach(() => { playbackPreferences.setIdentity(null); vi.unstubAllGlobals() })

  it.each(['account change', 'logout', 'auth reset', 'session expiry'])('discards queued work and ignores old acknowledgements on %s while the route is unmounted', async (event) => {
    const store = makeStore()
    await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false })).unwrap()
    let resolve!: (preference: CommentaryPlaybackPreference) => void
    const transport = {
      read: async () => ({ speech_id: 8, mode: 'all', source: 'saved' } as const),
      write: vi.fn(() => new Promise<CommentaryPlaybackPreference>((yes) => { resolve = yes })),
      cancel: vi.fn(), confirmed: vi.fn(),
    }
    const entry = playbackPreferences.get('a', 8, () => transport)
    await entry.hydrate()
    entry.select('voice')
    entry.select('off')
    await store.dispatch(annotationApi.util.upsertQueryData('getCommentaryPlaybackPreference', { userId: 'a', speechId: 8 }, {
      speech_id: 8, mode: 'all', source: 'saved',
    }))
    if (event === 'auth reset') store.dispatch(authApi.util.resetApiState())
    else if (event === 'logout') await store.dispatch(authApi.endpoints.logout.initiate()).unwrap()
    else {
      account = event === 'account change' ? 'b' : null
      await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false, forceRefetch: true }))
    }
    resolve({ speech_id: 8, mode: 'voice', source: 'saved' })
    await Promise.resolve(); await Promise.resolve()
    expect(transport.cancel).toHaveBeenCalledOnce()
    expect(transport.write).toHaveBeenCalledOnce()
    expect(transport.confirmed).toHaveBeenCalledTimes(1)
    expect(entry.getSnapshot().ready).toBe(false)
    expect(annotationApi.endpoints.getCommentaryPlaybackPreference.select({ userId: 'a', speechId: 8 })(store.getState()).data).toBeUndefined()
  })
})
