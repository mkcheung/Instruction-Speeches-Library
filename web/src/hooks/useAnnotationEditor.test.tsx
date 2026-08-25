import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { useAnnotationEditor } from '@/hooks/useAnnotationEditor'
import { readDraftMirror, readBackup } from '@/lib/annotationDraftStorage'
import type { Annotation } from '@/features/annotation/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

async function bodyOf(input: RequestInfo | URL): Promise<Record<string, unknown>> {
  if (!(input instanceof Request)) return {}
  try {
    return (await input.clone().json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: '9',
    start_seconds: 12,
    duration_seconds: 6,
    kind: 'observation',
    topic: null,
    body: 'existing body',
    lock_version: 1,
    client_uuid: 'existing-uuid',
    voice: null,
    ...overrides,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

describe('useAnnotationEditor', () => {
  beforeEach(() => {
    clearCookies()
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('onBeforeInput timestamp stamp', () => {
    it('stamps the timestamp for an insert inputType and never re-stamps', () => {
      const videoEl = document.createElement('video')
      Object.defineProperty(videoEl, 'currentTime', { value: 42, writable: true })

      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: null, videoEl, autoPause: false }),
        { wrapper },
      )

      expect(result.current.fields.start_seconds).toBeNull()

      act(() => result.current.handleBeforeInput('insertText'))
      expect(result.current.fields.start_seconds).toBe(42)

      // Playhead moves on, but the stamp is first-keystroke-only.
      videoEl.currentTime = 99
      act(() => result.current.handleBeforeInput('insertFromPaste'))
      expect(result.current.fields.start_seconds).toBe(42)
    })

    it('does not stamp for a non-insert inputType (deletions, Tab, arrows)', () => {
      const videoEl = document.createElement('video')
      Object.defineProperty(videoEl, 'currentTime', { value: 42, writable: true })

      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: null, videoEl, autoPause: false }),
        { wrapper },
      )

      act(() => result.current.handleBeforeInput('deleteContentBackward'))
      expect(result.current.fields.start_seconds).toBeNull()

      act(() => result.current.handleBeforeInput(null))
      expect(result.current.fields.start_seconds).toBeNull()

      // A real insert still works after non-inserts were ignored.
      act(() => result.current.handleBeforeInput('insertCompositionText'))
      expect(result.current.fields.start_seconds).toBe(42)
    })

    it('auto-pauses the video on the first stamp when the preference is on', () => {
      const videoEl = document.createElement('video')
      const pauseSpy = vi.spyOn(videoEl, 'pause').mockImplementation(() => {})

      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: null, videoEl, autoPause: true }),
        { wrapper },
      )

      act(() => result.current.handleBeforeInput('insertText'))
      expect(pauseSpy).toHaveBeenCalledTimes(1)

      act(() => result.current.handleBeforeInput('insertText'))
      expect(pauseSpy).toHaveBeenCalledTimes(1) // still just the once
    })
  })

  describe('the synchronous localStorage mirror', () => {
    it('writes on every keystroke, not gated behind the debounce', () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        return jsonResponse({ message: 'unused' })
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoEl = document.createElement('video')
      Object.defineProperty(videoEl, 'currentTime', { value: 5, writable: true })

      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: null, videoEl, autoPause: false }),
        { wrapper },
      )

      act(() => result.current.handleBeforeInput('insertText'))
      act(() => result.current.setBody('h'))

      // No network call yet (750ms hasn't elapsed) — the mirror is written
      // synchronously regardless.
      const uuid = result.current.clientUuid
      expect(readDraftMirror(uuid)?.body).toBe('h')

      act(() => result.current.setBody('he'))
      expect(readDraftMirror(uuid)?.body).toBe('he')

      const flushCalls = fetchMock.mock.calls.filter(([input]) => urlOf(input).includes('/annotations'))
      expect(flushCalls).toHaveLength(0)
    })
  })

  describe('the 300ms nudge debounce', () => {
    it('collapses a held nudge into exactly one PATCH', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/annotations/9')) {
          return jsonResponse({ annotation: { ...annotation(), start_seconds: 15, lock_version: 2 } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoEl = document.createElement('video')
      const existing = annotation()
      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: existing, videoEl, autoPause: false }),
        { wrapper },
      )

      // Simulate a held arrow key: five nudges, each well inside the 300ms
      // window of the previous one.
      for (let i = 0; i < 5; i++) {
        act(() => result.current.nudgeStart(0.5))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50)
        })
      }

      // Not yet flushed — the debounce keeps getting pushed out.
      const beforeSettle = fetchMock.mock.calls.filter(([input]) => urlOf(input).includes('/annotations/9'))
      expect(beforeSettle).toHaveLength(0)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      const patchCalls = fetchMock.mock.calls.filter(([input]) => urlOf(input).includes('/annotations/9'))
      expect(patchCalls).toHaveLength(1)
    })
  })

  describe('the three-tier conflict UI', () => {
    /**
     * The ~90% "clean adopts silently" case is fundamentally a two-tab
     * scenario (STEP-07's acceptance list: "Two tabs editing the same
     * annotation: clean adopts silently, dirty banners"), not something
     * a single editor's OWN save conflict realistically produces — a save
     * attempt only exists because a field changed, which by definition
     * makes that editor's fields differ from its last saved snapshot
     * (dirty). So this is tested the way it actually happens: a sibling
     * "tab" (a second `useAnnotationEditor` instance sharing the same
     * `client_uuid`/`reviewId`) saves successfully, broadcasts it, and
     * THIS untouched editor — clean, nothing typed since its own last
     * save — silently adopts the broadcast rather than banner-ing.
     */
    it('silently adopts a sibling tab\'s save when this editor is clean', async () => {
      vi.useFakeTimers()
      const existing = annotation()
      const updated = { ...existing, body: 'saved from the other tab', lock_version: 2 }
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/annotations/9')) return jsonResponse({ annotation: updated })
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoElA = document.createElement('video')
      const videoElB = document.createElement('video')
      const onSilentAdopt = vi.fn()

      // "Tab A" — will make the edit that saves successfully.
      const { result: tabA } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: existing, videoEl: videoElA, autoPause: false }),
        { wrapper },
      )
      // "Tab B" — untouched, clean, listening on the same review.
      const { result: tabB } = renderHook(
        () =>
          useAnnotationEditor({
            speechId: 1,
            reviewId: 1,
            initial: existing,
            videoEl: videoElB,
            autoPause: false,
            onSilentAdopt,
          }),
        { wrapper },
      )

      act(() => tabA.current.setBody('saved from the other tab'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })
      expect(tabA.current.autosaveState).toBe('saved')

      // Broadcast delivery is async even within one JS realm.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(tabB.current.conflict).toBeNull()
      expect(tabB.current.autosaveState).toBe('saved')
      expect(tabB.current.fields.body).toBe('saved from the other tab')
      expect(onSilentAdopt).toHaveBeenCalledWith(updated)
    })

    it('banners a dirty editor on conflict and never discards the local text', async () => {
      vi.useFakeTimers()
      const serverCurrent = annotation({ body: 'theirs', lock_version: 5 })
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/annotations/9')) {
          return jsonResponse(
            { message: 'conflict', conflictSource: 'self', current: serverCurrent },
            409,
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoEl = document.createElement('video')
      const existing = annotation()
      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: existing, videoEl, autoPause: false }),
        { wrapper },
      )

      act(() => result.current.setBody('mine, still typing'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(result.current.autosaveState).toBe('conflict')
      expect(result.current.conflict).toEqual(serverCurrent)
      // The whole point: local text survives a conflict untouched.
      expect(result.current.fields.body).toBe('mine, still typing')

      // "Use theirs" replaces the editor's text, but backs the local text
      // up first — recoverable, never silently gone.
      act(() => result.current.useTheirs())
      expect(result.current.fields.body).toBe('theirs')
      expect(result.current.conflict).toBeNull()

      const backupKeys = Object.keys(localStorage).filter((k) => k.startsWith('annotation-draft-backup:'))
      expect(backupKeys).toHaveLength(1)
      expect(readBackup(backupKeys[0])?.body).toBe('mine, still typing')
    })

    it('"Keep mine" re-saves the local text using the server-reported lock_version', async () => {
      vi.useFakeTimers()
      const serverCurrent = annotation({ body: 'theirs', lock_version: 5 })
      let patchCount = 0
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/annotations/9')) {
          patchCount += 1
          if (patchCount === 1) {
            return jsonResponse(
              { message: 'conflict', conflictSource: 'self', current: serverCurrent },
              409,
            )
          }
          const sentBody = await bodyOf(input)
          return jsonResponse({
            annotation: {
              ...annotation(),
              body: 'mine wins',
              lock_version: typeof sentBody.lock_version === 'number' ? sentBody.lock_version : 99,
            },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoEl = document.createElement('video')
      const existing = annotation()
      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: existing, videoEl, autoPause: false }),
        { wrapper },
      )

      act(() => result.current.setBody('mine wins'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })
      expect(result.current.autosaveState).toBe('conflict')

      act(() => result.current.keepMine())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(result.current.conflict).toBeNull()
      expect(result.current.fields.body).toBe('mine wins')
      expect(patchCount).toBe(2)
    })
  })

  describe('lockVersion resync from a second write path', () => {
    it('adopts an externally-bumped lock_version so the next save does not 409 against itself', async () => {
      vi.useFakeTimers()
      const existing = annotation()
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/annotations/9')) {
          return jsonResponse({ annotation: { ...existing, body: 'typed after the external retime', lock_version: 3 } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoEl = document.createElement('video')
      const onSilentAdopt = vi.fn()
      const { result, rerender } = renderHook(
        (props: { initial: Annotation }) =>
          useAnnotationEditor({
            speechId: 1,
            reviewId: 1,
            videoEl,
            autoPause: false,
            onSilentAdopt,
            initial: props.initial,
          }),
        { wrapper, initialProps: { initial: existing } },
      )

      // TimelineStrip drags the same row directly (bypassing this hook),
      // bumping lock_version server-side; the row editor re-renders with
      // the fresh prop once the panel's own query refetches.
      const retimed = { ...existing, start_seconds: 20, lock_version: 2 }
      rerender({ initial: retimed })

      expect(result.current.fields.start_seconds).toBe(20)
      expect(onSilentAdopt).toHaveBeenCalledWith(retimed)

      act(() => result.current.setBody('typed after the external retime'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      const patchCall = fetchMock.mock.calls.find(([input]) => urlOf(input).includes('/annotations/9'))
      expect(patchCall).toBeDefined()
      const sentBody = patchCall ? await bodyOf(patchCall[0]) : {}
      // Without the resync fix this would still read 1 (the version this
      // instance mounted with) and 409 against the drag's own update.
      expect(sentBody.lock_version).toBe(2)
      expect(result.current.autosaveState).toBe('saved')
    })

    it('banners rather than silently overwriting when the editor is dirty at the moment of an external update', () => {
      vi.useFakeTimers()
      const existing = annotation()
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (urlOf(input).includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        throw new Error(`unexpected fetch: ${urlOf(input)}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoEl = document.createElement('video')
      const { result, rerender } = renderHook(
        (props: { initial: Annotation }) =>
          useAnnotationEditor({ speechId: 1, reviewId: 1, videoEl, autoPause: false, initial: props.initial }),
        { wrapper, initialProps: { initial: existing } },
      )

      act(() => result.current.setBody('still typing, not yet saved'))
      expect(result.current.autosaveState).toBe('dirty')

      const retimed = { ...existing, start_seconds: 20, lock_version: 2 }
      rerender({ initial: retimed })

      expect(result.current.autosaveState).toBe('conflict')
      expect(result.current.conflict).toEqual(retimed)
      // Never discarded, per §10.2.
      expect(result.current.fields.body).toBe('still typing, not yet saved')
    })
  })

  describe('a race between an in-flight create and a later keystroke', () => {
    it('does not lose text typed while the create request is still in flight', async () => {
      vi.useFakeTimers()
      let resolveCreate!: (value: Response) => void
      const createPromise = new Promise<Response>((resolve) => {
        resolveCreate = resolve
      })
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (/\/annotations$/.test(url)) return createPromise
        if (/\/annotations\/9$/.test(url)) {
          const sentBody = await bodyOf(input)
          return jsonResponse({ annotation: { ...annotation({ id: '9' }), body: sentBody.body as string, lock_version: 1 } })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoEl = document.createElement('video')
      Object.defineProperty(videoEl, 'currentTime', { value: 5, writable: true })
      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: null, videoEl, autoPause: false }),
        { wrapper },
      )

      act(() => result.current.handleBeforeInput('insertText'))
      act(() => result.current.setBody('first draft'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      // The create POST is now in flight (unresolved) — keep typing.
      act(() => result.current.setBody('first draft, plus more typed mid-request'))

      await act(async () => {
        resolveCreate(jsonResponse({ annotation: { ...annotation({ id: '9' }), body: 'first draft', lock_version: 1 } }))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      // The newer text must survive — never silently dropped by the
      // remount that would otherwise follow a clean create.
      expect(result.current.fields.body).toBe('first draft, plus more typed mid-request')
      expect(result.current.autosaveState).not.toBe('saved')

      // And it must actually get sent in a follow-up request, not just
      // linger unsent in local state.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      const patchCall = fetchMock.mock.calls.find(([input]) => urlOf(input).includes('/annotations/9'))
      expect(patchCall).toBeDefined()
      const sentBody = patchCall ? await bodyOf(patchCall[0]) : {}
      expect(sentBody.body).toBe('first draft, plus more typed mid-request')
    })
  })

  describe('410 Gone — speech deleted mid-annotation', () => {
    it('flags speechDeleted and never touches the local text', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input)
        if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
        if (url.includes('/annotations/9')) {
          return jsonResponse({ message: 'This speech has been deleted.' }, 410)
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const videoEl = document.createElement('video')
      const existing = annotation()
      const { result } = renderHook(
        () => useAnnotationEditor({ speechId: 1, reviewId: 1, initial: existing, videoEl, autoPause: false }),
        { wrapper },
      )

      act(() => result.current.setBody('my draft survives this'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(result.current.speechDeleted).toBe(true)
      expect(result.current.fields.body).toBe('my draft survives this')
    })
  })
})
