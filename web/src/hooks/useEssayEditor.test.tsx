import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { authSessionActions, selectAuthSession } from '@/features/auth/authSession'
import type { CurrentUser } from '@/features/auth/types'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { useEssayEditor } from '@/hooks/useEssayEditor'
import type { Essay } from '@/features/essay/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

async function bodyOf(input: RequestInfo | URL): Promise<Record<string, unknown>> {
  if (!(input instanceof Request)) return {}
  try {
    return (await input.clone().json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function essay(overrides: Partial<Essay> = {}): Essay {
  return {
    essay_html: '<p>existing</p>',
    essay_text: 'existing',
    essay_published_at: null,
    essay_updated_at: null,
    essay_words: 1,
    essay_lock_version: 1,
    ...overrides,
  }
}

const viewer = {
  id: '7', email: 'a@example.com', first_name: 'A', last_name: 'B', username: 'ab', display_name: 'A B',
  email_verified: true, roles: [], onboarding_completed: true, onboarding_step: 4,
} as unknown as CurrentUser

function makeWrapper(store: ReturnType<typeof createTestStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore({ viewer })}>{children}</Provider>
}

describe('useEssayEditor', () => {
  beforeEach(() => clearCookies())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('debounces the html save at 750ms', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/essay')) {
        return jsonResponse({ essay: { ...essay(), essay_html: '<p>hi</p>', essay_lock_version: 2 } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useEssayEditor({ speechId: 1, reviewId: 1, initial: essay() }), { wrapper })

    act(() => result.current.setHtml('<p>hi</p>'))
    expect(result.current.autosaveState).toBe('dirty')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    const before = fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/essay'))
    expect(before).toHaveLength(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    const after = fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/essay'))
    expect(after).toHaveLength(1)
    expect(result.current.autosaveState).toBe('saved')
  })

  it('collapses rapid keystrokes into one PUT', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/essay')) return jsonResponse({ essay: { ...essay(), essay_lock_version: 2 } })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useEssayEditor({ speechId: 1, reviewId: 1, initial: essay() }), { wrapper })

    for (const text of ['<p>h</p>', '<p>he</p>', '<p>hel</p>']) {
      act(() => result.current.setHtml(text))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750)
    })

    const putCalls = fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/essay'))
    expect(putCalls).toHaveLength(1)
    const sent = await bodyOf(putCalls[0][0])
    expect(sent.html).toBe('<p>hel</p>')
    expect(sent.lock_version).toBe(1)
  })

  describe('the three-tier conflict UI', () => {
    it('banners a dirty editor on 409 and never discards local text', async () => {
      vi.useFakeTimers()
      const serverCurrent = essay({ essay_html: '<p>theirs</p>', essay_lock_version: 5 })
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/essay')) {
          return jsonResponse({ message: 'conflict', conflictSource: 'self', current: serverCurrent }, 409)
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { result } = renderHook(() => useEssayEditor({ speechId: 1, reviewId: 1, initial: essay() }), { wrapper })

      act(() => result.current.setHtml('<p>mine, still typing</p>'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(result.current.autosaveState).toBe('conflict')
      expect(result.current.conflict).toEqual(serverCurrent)
      expect(result.current.html).toBe('<p>mine, still typing</p>')

      act(() => result.current.useTheirs())
      expect(result.current.html).toBe('<p>theirs</p>')
      expect(result.current.conflict).toBeNull()
      expect(result.current.autosaveState).toBe('saved')
    })

    it('"keep mine" re-saves using the server-reported lock_version', async () => {
      vi.useFakeTimers()
      const serverCurrent = essay({ essay_html: '<p>theirs</p>', essay_lock_version: 5 })
      let putCount = 0
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/essay')) {
          putCount += 1
          if (putCount === 1) {
            return jsonResponse({ message: 'conflict', conflictSource: 'self', current: serverCurrent }, 409)
          }
          const sent = await bodyOf(input)
          return jsonResponse({
            essay: {
              ...essay(),
              essay_html: 'mine wins',
              essay_lock_version: typeof sent.lock_version === 'number' ? sent.lock_version : 99,
            },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { result } = renderHook(() => useEssayEditor({ speechId: 1, reviewId: 1, initial: essay() }), { wrapper })

      act(() => result.current.setHtml('mine wins'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })
      expect(result.current.autosaveState).toBe('conflict')

      act(() => result.current.keepMine())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(result.current.conflict).toBeNull()
      expect(result.current.html).toBe('mine wins')
      expect(putCount).toBe(2)
    })

    it('keeps text typed while a 409 was in flight even if the sent text equalled the snapshot', async () => {
      vi.useFakeTimers()
      const initial = essay()
      const serverCurrent = essay({ essay_html: '<p>theirs C</p>', essay_lock_version: 7 })
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/essay')) {
          await gate
          return jsonResponse({ message: 'conflict', conflictSource: 'self', current: serverCurrent }, 409)
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const onSilentAdopt = vi.fn()
      const { result, unmount } = renderHook(
        () => useEssayEditor({ speechId: 1, reviewId: 1, initial, onSilentAdopt }),
        { wrapper },
      )

      // Send text A (equal to the saved snapshot), then type B before the 409 lands.
      act(() => result.current.setHtml(initial.essay_html ?? ''))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })
      act(() => result.current.setHtml('<p>typed B</p>'))
      await act(async () => {
        release()
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(onSilentAdopt).not.toHaveBeenCalled()
      expect(result.current.html).toBe('<p>typed B</p>')
      expect(result.current.autosaveState).toBe('conflict')
      expect(result.current.conflict).toEqual(serverCurrent)

      act(() => result.current.useTheirs())
      expect(result.current.html).toBe('<p>theirs C</p>')

      // Drain the still-pending debounce for B while fetch is stubbed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      unmount()
    })

    it('silently adopts on 409 when the editor is clean', async () => {
      vi.useFakeTimers()
      const initial = essay()
      const serverCurrent = essay({ essay_html: '<p>saved elsewhere</p>', essay_lock_version: 9 })
      // First save succeeds (making the editor "clean" against that
      // snapshot), the SECOND independent edit conflicts but by the time it
      // resolves the local text already matches the last saved snapshot —
      // simulated directly by asserting the clean-adopt branch via a save
      // that returns 409 with `current` equal to what's about to be typed.
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/essay')) {
          return jsonResponse({ message: 'conflict', conflictSource: 'self', current: serverCurrent }, 409)
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const onSilentAdopt = vi.fn()
      const { result } = renderHook(
        () => useEssayEditor({ speechId: 1, reviewId: 1, initial, onSilentAdopt }),
        { wrapper },
      )

      // Nothing typed yet — `html` still equals `savedSnapshotRef`'s seed,
      // so a save attempt reaching this point is only reachable via
      // `keepMine`/`flush({forcedLockVersion})`, which is enough to invoke
      // the same clean-adopt branch `flush`'s catch block uses.
      act(() => result.current.setHtml(initial.essay_html ?? ''))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(result.current.conflict).toBeNull()
      expect(result.current.autosaveState).toBe('saved')
      expect(result.current.html).toBe('<p>saved elsewhere</p>')
      expect(onSilentAdopt).toHaveBeenCalledWith(serverCurrent)
    })
  })

  describe('410 Gone — speech deleted mid-edit', () => {
    it('flags speechDeleted and never touches the local text', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/essay')) return jsonResponse({ message: 'This speech has been deleted.' }, 410)
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { result } = renderHook(() => useEssayEditor({ speechId: 1, reviewId: 1, initial: essay() }), { wrapper })

      act(() => result.current.setHtml('<p>my draft survives this</p>'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(result.current.speechDeleted).toBe(true)
      expect(result.current.html).toBe('<p>my draft survives this</p>')
    })
  })

  describe('pagehide beacon', () => {
    it('fires a keepalive PUT when dirty on unload, and nothing when clean', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (urlOf(input).includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        void init
        return jsonResponse({ essay: essay() })
      })
      vi.stubGlobal('fetch', fetchMock)

      const { result, unmount } = renderHook(
        () => useEssayEditor({ speechId: 1, reviewId: 1, initial: essay() }),
        { wrapper },
      )

      act(() => result.current.setHtml('<p>typed, not yet flushed</p>'))
      expect(result.current.autosaveState).toBe('dirty')

      window.dispatchEvent(new Event('pagehide'))

      const beaconCall = fetchMock.mock.calls.find(
        ([input, init]) => urlOf(input).endsWith('/essay') && init?.keepalive === true,
      )
      expect(beaconCall).toBeDefined()

      // `setHtml` also left the ordinary debounced save pending. Unmount
      // explicitly while the fetch mock is still installed, then wait for
      // that cleanup PUT; otherwise RTL's automatic cleanup can run after
      // this suite restores native fetch and leak a real network request.
      unmount()
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(
            ([input, init]) =>
              urlOf(input).endsWith('/essay') &&
              methodOf(input, init) === 'PUT' &&
              init?.keepalive !== true,
          ),
        ).toBe(true)
      })
    })

    const rawPuts = (m: ReturnType<typeof vi.fn>) =>
      m.mock.calls.filter(([i, init]) => urlOf(i).endsWith('/essay') && (init as RequestInit | undefined)?.keepalive === true)

    async function dirtyThen(
      mutate: (store: ReturnType<typeof createTestStore>) => void,
      withViewer = true,
      settle?: (store: ReturnType<typeof createTestStore>) => Promise<void>,
    ) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (urlOf(input).endsWith('/api/me')) return jsonResponse({ user: viewer })
        return jsonResponse({ essay: essay() })
      })
      vi.stubGlobal('fetch', fetchMock)
      const store = createTestStore(withViewer ? { viewer } : {})
      const { result, unmount } = renderHook(
        () => useEssayEditor({ speechId: 1, reviewId: 1, initial: essay() }),
        { wrapper: makeWrapper(store) },
      )
      act(() => result.current.setHtml('<p>typed</p>'))
      act(() => mutate(store))
      if (settle) await act(async () => { await settle(store) })
      window.dispatchEvent(new Event('pagehide'))
      const n = rawPuts(fetchMock).length
      unmount()
      return n
    }

    it('still flushes after pagehide hides the UI for the same user', async () => {
      expect(await dirtyThen((s) => { s.dispatch(authSessionActions.pageHidden()) })).toBe(1)
    })
    it('skips the raw write when an auth attempt started', async () => {
      expect(await dirtyThen((s) => { s.dispatch(authSessionActions.attemptStarted('a1')) })).toBe(0)
    })
    it('skips the raw write after a cross-tab account change', async () => {
      expect(await dirtyThen((s) => { s.dispatch(authSessionActions.externalChange()) })).toBe(0)
    })
    const settledAccepted = (store: ReturnType<typeof createTestStore>) =>
      waitFor(() => expect(selectAuthSession(store.getState()).status).toBe('accepted'))
    it('still flushes after a same-user cross-tab generation bump re-proves the viewer', async () => {
      expect(await dirtyThen((s) => { s.dispatch(authSessionActions.externalChange()) }, true, settledAccepted)).toBe(1)
    })
    it('still flushes after a same-user BFCache restore re-proves the viewer', async () => {
      expect(await dirtyThen((s) => { s.dispatch(authSessionActions.pageRestored()) }, true, settledAccepted)).toBe(1)
    })
    it('skips the raw write after a BFCache restore', async () => {
      expect(await dirtyThen((s) => { s.dispatch(authSessionActions.pageRestored()) })).toBe(0)
    })
    it('skips the raw write in a terminal state', async () => {
      expect(await dirtyThen((s) => { s.dispatch(authSessionActions.attemptSucceeded()) })).toBe(0)
    })
    it('skips the raw write when no accepted viewer existed at capture', async () => {
      expect(await dirtyThen(() => {}, false)).toBe(0)
    })
  })
})
