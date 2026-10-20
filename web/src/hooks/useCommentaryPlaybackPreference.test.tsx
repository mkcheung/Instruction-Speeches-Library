import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { annotationApi } from '@/features/annotation/annotationApi'
import { playbackPreferenceCacheKey, playbackPreferences } from '@/lib/commentaryPlaybackPreference'
import { useCommentaryPlaybackPreference } from './useCommentaryPlaybackPreference'

function response(mode: string, speechId = 8, source = 'saved') {
  return new Response(JSON.stringify({ commentary_playback: { speech_id: speechId, mode, source } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

function setup() {
  const store = createTestStore()
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  return { store, wrapper }
}

describe('useCommentaryPlaybackPreference transport', () => {
  beforeEach(() => {
    playbackPreferences.setIdentity(null)
    localStorage.clear()
    clearCookies()
    document.cookie = 'XSRF-TOKEN=test-csrf; path=/'
  })
  afterEach(() => {
    cleanup()
    playbackPreferences.setIdentity(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not subscribe for the disabled coach context or an unknown identity', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = setup()
    const { result, rerender } = renderHook(
      ({ enabled, userId }: { enabled: boolean; userId?: string }) => useCommentaryPlaybackPreference(userId, 8, enabled),
      { wrapper, initialProps: { enabled: false, userId: 'coach' as string | undefined } },
    )
    expect(result.current.ready).toBe(false)
    rerender({ enabled: true, userId: undefined })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits for server hydration despite local saved and legacy settings', async () => {
    let resolveRead!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveRead = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem(playbackPreferenceCacheKey('owner', 8), JSON.stringify({ mode: 'voice' }))
    localStorage.setItem('voice-commentary:owner:8', JSON.stringify({ mode: 'play', experienced: true }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useCommentaryPlaybackPreference('owner', 8, true), { wrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(result.current).toMatchObject({ mode: 'off', ready: false })
    await act(async () => { resolveRead(response('all', 8, 'default')) })
    await waitFor(() => expect(result.current).toMatchObject({ mode: 'all', ready: true }))
    expect(localStorage.getItem('voice-commentary:owner:8')).toContain('play')
  })

  it('PATCHes the new endpoint, commits its acknowledgement, then converges on a clean focus GET', async () => {
    let remoteMode = 'all'
    const fetchMock = vi.fn(async (request: Request) => {
      if (request.method === 'PATCH') remoteMode = (await request.json()).mode
      return response(remoteMode)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { store, wrapper } = setup()
    const { result } = renderHook(() => useCommentaryPlaybackPreference('owner', 8, true), { wrapper })
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.select('off'))
    expect(result.current.mode).toBe('off')
    await waitFor(() => expect(result.current.saving).toBe(false))
    const patch = fetchMock.mock.calls.map(([request]) => request).find((request) => request.method === 'PATCH')!
    expect(new URL(patch.url).pathname).toBe('/api/me/preferences/commentary-playback/8')
    expect(annotationApi.endpoints.getCommentaryPlaybackPreference.select({ userId: 'owner', speechId: 8 })(store.getState()).data?.mode).toBe('off')
    expect(JSON.parse(localStorage.getItem(playbackPreferenceCacheKey('owner', 8))!).mode).toBe('off')
    remoteMode = 'written'
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current.mode).toBe('written'))
  })

  it('hydrates and saves through the server when confirmed local cache storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
    vi.stubGlobal('fetch', vi.fn(async (request: Request) => response(request.method === 'PATCH' ? (await request.json()).mode : 'written')))
    const { wrapper } = setup()
    const { result } = renderHook(() => useCommentaryPlaybackPreference('owner', 8, true), { wrapper })
    await waitFor(() => expect(result.current).toMatchObject({ mode: 'written', ready: true }))
    act(() => result.current.select('off'))
    await waitFor(() => expect(result.current).toMatchObject({ mode: 'off', saving: false, saveError: false }))
  })

  it('scopes cached preferences by identity and suppresses the next speech until its own GET', async () => {
    let resolveSecond!: (response: Response) => void
    const fetchMock = vi.fn(async (request: Request) => {
      if (request.url.endsWith('/9')) return new Promise<Response>((resolve) => { resolveSecond = resolve })
      return response('written')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper, store } = setup()
    await store.dispatch(annotationApi.util.upsertQueryData('getCommentaryPlaybackPreference', { userId: 'another-user', speechId: 9 }, {
      speech_id: 9, mode: 'all', source: 'saved',
    }))
    const { result, rerender } = renderHook(
      ({ speechId }) => useCommentaryPlaybackPreference('owner', speechId, true),
      { wrapper, initialProps: { speechId: 8 } },
    )
    await waitFor(() => expect(result.current.mode).toBe('written'))
    rerender({ speechId: 9 })
    expect(result.current).toMatchObject({ mode: 'off', ready: false })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await act(async () => { resolveSecond(response('off', 9)) })
    await waitFor(() => expect(result.current).toMatchObject({ mode: 'off', ready: true }))
  })
})
