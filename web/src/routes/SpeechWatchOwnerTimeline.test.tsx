import { configureStore } from '@reduxjs/toolkit'
import { authApi } from '@/features/auth/authApi'
import { profileApi } from '@/features/profile/profileApi'
import { speechApi } from '@/features/speech/speechApi'
import { reviewApi } from '@/features/review/reviewApi'
import { notificationApi } from '@/features/notification/notificationApi'
import { annotationApi } from '@/features/annotation/annotationApi'
import { essayApi } from '@/features/essay/essayApi'
import { captionApi } from '@/features/caption/captionApi'
import { transcriptApi } from '@/features/transcript/transcriptApi'
import { reportApi } from '@/features/report/reportApi'
import { privacyApi } from '@/features/privacy/privacyApi'
import { coachApplicationApi } from '@/features/coachApplication/coachApplicationApi'
import { connectionApi } from '@/features/connection/connectionApi'
import { commentaryPreferenceSession } from '@/features/annotation/commentaryPreferenceSession'

import { StrictMode, type ComponentProps } from 'react'
import type Player from 'video.js/dist/types/player'
import { Provider } from 'react-redux'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoPlayer } from '@/components/speech/VideoPlayer'
import * as ownerToolsModule from '@/components/review/OwnerVideoTools'
import { WorkspaceCompanionProvider } from '@/components/workspace/WorkspaceCompanionProvider'
import SpeechWatch from './SpeechWatch'
import type { Annotation, CommentaryPlaybackMode } from '@/features/annotation/types'
import type { Speech } from '@/features/speech/types'
import { playbackPreferences } from '@/lib/commentaryPlaybackPreference'
import { clearCookies } from '@/test/renderWithProviders'

function freshStore() { return configureStore({
  reducer: {
    [authApi.reducerPath]: authApi.reducer,
    [profileApi.reducerPath]: profileApi.reducer,
    [speechApi.reducerPath]: speechApi.reducer,
    [reviewApi.reducerPath]: reviewApi.reducer,
    [notificationApi.reducerPath]: notificationApi.reducer,
    [annotationApi.reducerPath]: annotationApi.reducer,
    [essayApi.reducerPath]: essayApi.reducer,
    [captionApi.reducerPath]: captionApi.reducer,
    [transcriptApi.reducerPath]: transcriptApi.reducer,
    [reportApi.reducerPath]: reportApi.reducer,
    [privacyApi.reducerPath]: privacyApi.reducer,
    [coachApplicationApi.reducerPath]: coachApplicationApi.reducer,
    [connectionApi.reducerPath]: connectionApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      commentaryPreferenceSession,
      authApi.middleware,
      profileApi.middleware,
      speechApi.middleware,
      reviewApi.middleware,
      notificationApi.middleware,
      annotationApi.middleware,
      essayApi.middleware,
      captionApi.middleware,
      transcriptApi.middleware,
      reportApi.middleware,
      privacyApi.middleware,
      coachApplicationApi.middleware,
      connectionApi.middleware,
    ),
  enhancers: (getDefault) => getDefault({ autoBatch: false }),
}) }



type PlayerHarnessInstance = {
  player: Player
  video: HTMLVideoElement
  root: HTMLDivElement
  url: string
  disposed: boolean
  ready: () => void
  refresh: () => Promise<string>
  replacePresentation: () => void
  seeks: number[]
  advance: (seconds: number) => void
  metadata: () => void
  resetMedia: (event?: 'loadstart' | 'emptied' | 'error') => void
}
const playerHarness = vi.hoisted(() => ({
  autoReady: true,
  native: false,
  instances: [] as PlayerHarnessInstance[],
}))
beforeEach(() => {
  playerHarness.autoReady = true
  playerHarness.native = false
  playerHarness.instances = []
})

// Reproduce VideoPlayer's detached React host, initialUrl-driven source
// disposal and latest-ready-callback semantics. Readiness can be delayed
// independently for each concrete player. This is not a native media test.
vi.mock('@/components/speech/VideoPlayer', async () => {
  const { useState, useEffect, useRef } = await import('react')
  const { createPortal } = await import('react-dom')
  return { VideoPlayer: (props: ComponentProps<typeof VideoPlayer>) => {
    const container = useRef<HTMLDivElement>(null)
    const latest = useRef(props)
    const [presentationGeneration, setPresentationGeneration] = useState(0)
    const [host] = useState(() => {
      const node = document.createElement('div')
      node.dataset.testid = 'owner-commentary-host'
      node.className = 'owner-commentary-host'
      return node
    })
    useEffect(() => { latest.current = props })
    useEffect(() => {
      const root = document.createElement('div')
      root.className = 'video-js'
      const video = document.createElement('video')
      video.dataset.testid = 'speech-video'
      root.append(video, host)
      container.current!.append(root)
      let tracks: TextTrack[] = []
      let nativeTime = 0
      if (playerHarness.native) {
        video.src = props.initialUrl
        Object.defineProperties(video, {
          duration: { value: 100, writable: true, configurable: true },
          readyState: { value: 0, writable: true, configurable: true },
          error: { value: null, writable: true, configurable: true },
          currentTime: { configurable: true, get: () => nativeTime, set: (seconds: number) => {
            nativeTime = seconds
            instance.seeks.push(seconds)
            // The fake native boundary queues events; production still uses
            // the real controller and canonical seek paths. Browser proof is separate.
            queueMicrotask(() => {
              if (instance.disposed) return
              video.dispatchEvent(new Event('seeking'))
              video.dispatchEvent(new Event('seeked'))
            })
          } },
        })
      }
      const instance: PlayerHarnessInstance = {
        root, video, url: props.initialUrl, disposed: false,
        seeks: [],
        advance: (seconds) => { nativeTime = seconds; video.dispatchEvent(new Event('timeupdate')) },
        metadata: () => {
          Object.defineProperties(video, {
            readyState: { value: 1, writable: true, configurable: true },
            error: { value: null, writable: true, configurable: true },
          })
          video.dispatchEvent(new Event('loadedmetadata'))
        },
        resetMedia: (event = 'loadstart') => {
          Object.defineProperties(video, {
            readyState: { value: 0, writable: true, configurable: true },
            error: { value: event === 'error' ? { code: 3 } : null, writable: true, configurable: true },
          })
          video.dispatchEvent(new Event(event))
        },
        replacePresentation: () => setPresentationGeneration((generation) => generation + 1),
        player: null as unknown as Player,
        ready: () => {
          if (playerHarness.native) instance.metadata()
          latest.current.onPlayerReady?.(instance.player)
        },
        refresh: async () => {
          const url = await latest.current.refreshUrl()
          if (!instance.disposed) {
            if (playerHarness.native) {
              instance.resetMedia('loadstart')
              instance.resetMedia('emptied')
            }
            video.src = url
            tracks = []
            latest.current.onSourceRefreshed?.()
          }
          return url
        },
      }
      instance.player = {
        isDisposed: () => instance.disposed,
        tech: () => ({ el: () => video }),
        el: () => root,
        currentTime: () => video.currentTime,
        remoteTextTracks: () => {
          if (instance.disposed) throw new Error('Track access on disposed player')
          return tracks
        },
        removeRemoteTextTrack: (track: TextTrack) => { tracks = tracks.filter((t) => t !== track) },
        addRemoteTextTrack: () => {
          const track = { kind: 'captions', mode: 'showing' } as TextTrack
          tracks.push(track)
          return { track }
        },
      } as unknown as Player
      playerHarness.instances.push(instance)
      if (playerHarness.autoReady) queueMicrotask(instance.ready)
      return () => {
        host.remove()
        instance.disposed = true
        root.remove()
      }
      // Deliberately mirror the production source effect's dependency.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.initialUrl])
    return <div data-testid="watch-player" ref={container}>{createPortal(props.presentation, host, String(presentationGeneration))}</div>
  } }
})


// Real RTK reducers, requests, preference coordinator and commentary/voice hooks
// run in these tests. Only the native player/audio boundary is simulated.
const apis = [authApi, profileApi, speechApi, reviewApi, notificationApi,
  annotationApi, essayApi, captionApi, transcriptApi, reportApi, privacyApi,
  coachApplicationApi, connectionApi] as const
const stores: ReturnType<typeof freshStore>[] = []
let unexpectedRequests: string[] = []
const OWNER = '9003'
const SAME_URL = 'https://media.example.test/shared.mp4'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}
function account(id = OWNER) {
  return { user: { id, email: 'speaker@example.test', first_name: 'Sam', last_name: 'Speaker',
    username: 'speaker', display_name: 'Sam Speaker', email_verified: true,
    roles: ['member'], onboarding_completed: true, onboarding_step: 4 } }
}
function speech(id = 17, userId = Number(OWNER)): Speech {
  return { id, user_id: userId, ulid: `speech-${id}`, title: `Speech ${id}`, description: null,
    delivered_on: null, change_note: null, created_at: '2026-10-01T00:00:00Z', captions_enabled: true,
    primary_video: { id: id === 17 ? 42 : 84, kind: 'video', status: 'ready', failure_code: null,
      duration_seconds: '100', width: 1920, height: 1080, poster_time_seconds: null },
    sprite: { url: 'https://media.example.test/sprite.jpg', columns: 5, rows: 2,
      frame_width: 800, frame_height: 180, duration_seconds: '100' } }
}
function review(speechId = 17, id = speechId === 17 ? 501 : 502) {
  return { id, status: 'published', source: 'invitation', allow_preview: false,
    prior_commentary_shared: false, invited_at: '2026-09-01T00:00:00Z', responded_at: '2026-09-01T00:00:00Z',
    first_published_at: '2026-09-02T00:00:00Z', last_published_at: '2026-09-02T00:00:00Z',
    last_transition_at: '2026-09-02T00:00:00Z', revoked_at: null, revocation_reason: null,
    annotations_count: 3, published_annotations_count: 3, revoked_by_is_self: false,
    reviewer: { id: id + 10, username: `coach${id}`, name: `Coach ${id}` } }
}
function notes(speechId = 17): Annotation[] {
  const prefix = speechId === 17 ? 'a' : 'b'
  const base: Annotation = { id: `${prefix}-text`, timing_type: 'range', start_seconds: 2,
    duration_seconds: 5, body: `${prefix.toUpperCase()} written body`, kind: 'observation',
    topic: null, voice: null, lock_version: 0, client_uuid: `${prefix}-uuid` }
  return [base, { ...base, id: `${prefix}-voice`, timing_type: 'point', start_seconds: 12,
    duration_seconds: 4, body: `${prefix.toUpperCase()} voice transcript`,
    voice: { asset_id: speechId + 100, audio_status: 'ready', transcript_status: 'ready', failure_code: null } },
  { ...base, id: `${prefix}-erased`, timing_type: 'point', start_seconds: 22, body: 'Erased transcript' }]
}
function annotationResponse(id = 17) {
  const roster = review(id)
  return { review_id: roster.id, reviewer: roster.reviewer, annotations: notes(id) }
}
type Override = (request: Request, url: URL) => Promise<Response> | Response | undefined
function server(override: Override = () => undefined) {
  const requests: Request[] = []
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input.toString(), init)
    requests.push(request.clone())
    const url = new URL(request.url)
    const overridden = override(request, url)
    if (overridden !== undefined) return overridden
    const path = url.pathname
    if (path === '/api/me') return json(account())
    if (path === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (path === '/api/reviewers') return json({ reviewers: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    if (path === '/api/reviews') return json({ invited: [], in_progress: [], published: [], declined: [] })
    const preference = path.match(/^\/api\/me\/preferences\/commentary-playback\/(17|18)$/)
    if (preference && request.method === 'GET') return json({ commentary_playback: { speech_id: Number(preference[1]), mode: 'all', source: 'saved' } })
    if (preference && request.method === 'PATCH') {
      const { mode } = await request.clone().json()
      return json({ commentary_playback: { speech_id: Number(preference[1]), mode, source: 'saved' } })
    }
    const match = path.match(/^\/api\/speeches\/(17|18)(.*)$/)
    if (match) {
      const id = Number(match[1])
      const suffix = match[2]
      if (!suffix && request.method === 'GET') return json({ speech: speech(id) })
      if (suffix === '/review-roster') return json({ reviews: [review(id)] })
      if (suffix === '/annotations') {
        if (url.searchParams.get('review_id') === String(review(id).id)) return json(annotationResponse(id))
      }
      if (suffix === '/essay') return json({ essay: { essay_html: null, essay_published_at: null } })
      if (suffix === '/captions') return json({ captions: { vtt: null, status: 'unavailable', failure_code: null,
        updated_at: null, asset_id: null, revision: null } })
      if (suffix === `/assets/${speech(id).primary_video!.id}/playback-url`) return json({ url: SAME_URL })
      if (suffix === `/annotations/${id === 17 ? 'a' : 'b'}-voice/voice-playback-url`) return json({ audio: { url: 'https://media.example.test/voice.mp3', expires_at: '2099-01-01T00:00:00Z' } })
    }
    unexpectedRequests.push(`${request.method} ${url.pathname}${url.search}`)
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}${url.search}`)
  })
  vi.stubGlobal('fetch', mock)
  return { mock, requests, count: (path: string) => requests.filter((request) => new URL(request.url).pathname === path).length }
}
function makeStore() { const store = freshStore(); stores.push(store); return store }
function watch(store = makeStore(), id = 17, strict = false) {
  const router = createMemoryRouter([{ path: '/speeches/:id', element:
    <WorkspaceCompanionProvider><SpeechWatch /></WorkspaceCompanionProvider> }], { initialEntries: [`/speeches/${id}`] })
  const view = <Provider store={store}><RouterProvider router={router} /></Provider>
  return { store, router, ...render(strict ? <StrictMode>{view}</StrictMode> : view) }
}
const tools = () => screen.getByRole('tablist', { name: 'Video tools' }).closest('.owner-video-tools') as HTMLElement
const markers = () => [...tools().querySelectorAll<HTMLButtonElement>('.awt-marker')]
async function loaded(prefix = 'a') {
  await waitFor(() => expect(screen.getByTestId(`range-marker-${prefix}-text`)).toBeInTheDocument(), { timeout: 2500 })
  return tools()
}
// CI-only failure on the third `it.each` case ("paused") never showed the
// loading status, and RTL's own dump is cut off inside decorative SVG before it
// reaches the commentary controls. On failure, report just the facts that
// decide whether the controller ever started: every status line and the
// commentary-playback radios (disabled = preference not ready/enabled yet).
async function findVoiceStatus(text: string, video: HTMLVideoElement) {
  try {
    return await screen.findByText(text, undefined, { timeout: 4000 })
  } catch (error) {
    const radios = screen.queryAllByRole('radio').map((radio) => {
      const input = radio as HTMLInputElement
      return `${input.value}:${input.checked ? 'on' : 'off'}${input.disabled ? ':disabled' : ''}`
    })
    throw new Error(`${(error as Error).message.split('\n')[0]}\nvoice diagnostics: ${JSON.stringify({
      statuses: screen.queryAllByRole('status').map((node) => node.textContent),
      radios,
      currentTime: video.currentTime,
      paused: video.paused,
    })}`, { cause: error })
  }
}
function currentPlayer() {
  const active = playerHarness.instances.filter((instance) => !instance.disposed)
  expect(active).toHaveLength(1)
  return active[0]
}
async function refreshSpeech(store: ReturnType<typeof freshStore>, id = 17) {
  await act(async () => { await store.dispatch(speechApi.endpoints.getSpeech.initiate(id,
    { forceRefetch: true, subscribe: false })).unwrap().catch(() => undefined) })
}
async function refreshMe(store: ReturnType<typeof freshStore>) {
  await act(async () => { await store.dispatch(authApi.endpoints.getMe.initiate(undefined,
    { forceRefetch: true, subscribe: false })).unwrap().catch(() => undefined) })
}
async function prime(store: ReturnType<typeof freshStore>, annotationCache = true) {
  await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false })).unwrap()
  for (const id of [17, 18]) {
    await store.dispatch(speechApi.endpoints.getSpeech.initiate(id, { subscribe: false })).unwrap()
    await store.dispatch(reviewApi.endpoints.listReviewRoster.initiate(id, { subscribe: false })).unwrap()
    if (annotationCache) await store.dispatch(annotationApi.endpoints.getAnnotations.initiate(
      { speechId: id, reviewId: review(id).id }, { subscribe: false })).unwrap()
  }
}

class ScrubPointerEvent extends MouseEvent {
  pointerId: number
  isPrimary: boolean
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.isPrimary = init.isPrimary ?? true
    this.pointerType = init.pointerType ?? 'mouse'
  }
}
const scrubRect = { left: 156, top: 20, width: 400, height: 44, right: 556, bottom: 64,
  x: 156, y: 20, toJSON() {} } as DOMRect
function scrubSeam() {
  playerHarness.native = true
  vi.stubGlobal('PointerEvent', ScrubPointerEvent)
  const original = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('awt-scrubber') || this.classList.contains('awt-axis')
      ? scrubRect : original.call(this)
  })
}
function sliderControl() {
  const slider = screen.getByRole('slider', { name: 'Video position' })
  const captured = new Set<number>()
  Object.assign(slider, {
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: vi.fn((id: number) => captured.has(id)),
    releasePointerCapture: vi.fn((id: number) => {
      captured.delete(id)
      fireEvent.lostPointerCapture(slider, { pointerId: id })
    }),
  })
  return slider
}
function drag(slider: HTMLElement, phase: 'down' | 'move' | 'up', seconds: number) {
  const event = { pointerId: 1, isPrimary: true, button: 0, clientX: 156 + seconds * 4 }
  if (phase === 'down') fireEvent.pointerDown(slider, event)
  else if (phase === 'move') fireEvent.pointerMove(slider, event)
  else fireEvent.pointerUp(slider, event)
}
async function flushMedia() { await act(async () => { await Promise.resolve() }) }
const REVIEWER = '9004'
function myReview(speechId = 17, id = speechId === 17 ? 501 : 502) {
  // GET /api/reviews does not eager-load reviewer: no reviewer.id proof exists.
  const { reviewer: omitted, ...row } = review(speechId, id)
  void omitted
  return { ...row, status: 'in_progress', invitation_message: null,
    speech: { id: speechId, ulid: `speech-${speechId}`, title: `Speech ${speechId}`, owner_name: 'Sam Speaker' } }
}
function mySections(id = 501) { return { invited: [], in_progress: [myReview(17, id), myReview(18)], published: [], revoked: [] } }
function reviewerServer(override: Override = () => undefined) {
  return server((request, url) => {
    const overridden = override(request, url)
    if (overridden !== undefined) return overridden
    if (url.pathname === '/api/me') return json(account(REVIEWER))
    if (url.pathname === '/api/reviews') return json(mySections())
    const annotation = url.pathname.match(/^\/api\/speeches\/(17|18)\/annotations$/)
    if (annotation && request.method === 'GET') {
      const reviewId = Number(url.searchParams.get('review_id'))
      if ([501, 502, 601].includes(reviewId)) return json({ review_id: reviewId, reviewer: null,
        annotations: notes(Number(annotation[1])) })
    }
  })
}
async function primeReviewer(store: ReturnType<typeof freshStore>) {
  await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false })).unwrap()
  await store.dispatch(speechApi.endpoints.getSpeech.initiate(17, { subscribe: false })).unwrap()
  await store.dispatch(reviewApi.endpoints.listMyReviews.initiate(undefined, { subscribe: false })).unwrap()
}
function reviewState(store: ReturnType<typeof freshStore>) { return reviewApi.endpoints.listMyReviews.select()(store.getState()) }
async function refreshReviews(store: ReturnType<typeof freshStore>) {
  await act(async () => { await store.dispatch(reviewApi.endpoints.listMyReviews.initiate(undefined,
    { forceRefetch: true, subscribe: false })).unwrap().catch(() => undefined) })
}
async function reviewerLoaded(enabled = true) {
  await screen.findByText('Your commentary')
  const slider = sliderControl()
  await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', String(!enabled)))
  return slider
}
function noDataWrites(network: ReturnType<typeof server>) {
  expect(network.requests.filter((request) => request.method !== 'GET' && request.method !== 'HEAD')).toEqual([])
}

beforeEach(() => {
  unexpectedRequests = []
  playbackPreferences.setIdentity(null)
  localStorage.clear()
  clearCookies()
  document.cookie = 'XSRF-TOKEN=test; path=/'
})
afterEach(() => {
  cleanup()
  playbackPreferences.setIdentity(null)
  for (const store of stores.splice(0)) for (const api of apis) store.dispatch(api.util.resetApiState())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  expect(unexpectedRequests).toEqual([])
})

describe('owner timeline with the production RTK session middleware', () => {
  it('isolates cached A and B with identical URLs until B has its own ready concrete player', async () => {
    const playbackB = deferred<Response>()
    const network = server((_request, url) => url.pathname === '/api/speeches/18/assets/84/playback-url' ? playbackB.promise : undefined)
    const store = makeStore()
    await prime(store)
    const view = watch(store)
    await loaded()
    const first = currentPlayer()
    first.video.currentTime = 3
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    playerHarness.autoReady = false
    await act(async () => { await view.router.navigate('/speeches/18') })
    expect(currentPlayer()).toBe(first)
    expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
    expect(first.root.querySelector('[data-testid="voice-note-markers"]')).toBeNull()
    expect(first.root.querySelector('[data-testid="overlay-stack"]')).toBeNull()
    await act(async () => { playbackB.resolve(json({ url: SAME_URL })); await playbackB.promise })
    await waitFor(() => expect(first.disposed).toBe(true))
    const second = currentPlayer()
    expect(second.video).not.toBe(first.video)
    expect(second.url).toBe(first.url)
    expect(screen.getByRole('tab', { name: 'Commentary timeline' })).toHaveAttribute('aria-selected', 'true')
    expect(markers()).toHaveLength(0)
    expect(second.root.querySelector('[data-testid="voice-note-markers"]')).toBeNull()
    act(first.ready)
    expect(markers()).toHaveLength(0)
    act(second.ready)
    await loaded('b')
    expect(screen.queryByTestId('range-marker-a-text')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('range-marker-b-text'))
    expect(second.video.currentTime).toBe(2)
    expect(first.video.currentTime).toBe(3)
    expect(network.requests.filter((request) => new URL(request.url).pathname.includes('/playback-url'))
      .map((request) => new URL(request.url).pathname)).toEqual([
      '/api/speeches/17/assets/42/playback-url', '/api/speeches/18/assets/84/playback-url'])
    expect(annotationApi.endpoints.getAnnotations.select({ speechId: 17, reviewId: 501 })(store.getState()).data?.annotations[0].id).toBe('a-text')
    expect(annotationApi.endpoints.getAnnotations.select({ speechId: 18, reviewId: 502 })(store.getState()).data?.annotations[0].id).toBe('b-text')
  })

  it('ignores A playback and annotation responses that finish after B is displayed', async () => {
    const playbackA = deferred<Response>()
    const annotationsA = deferred<Response>()
    const network = server((_request, url) => {
      if (url.pathname === '/api/speeches/17/assets/42/playback-url') return playbackA.promise
      if (url.pathname === '/api/speeches/17/annotations') return annotationsA.promise
    })
    const store = makeStore()
    await prime(store, false)
    const view = watch(store)
    await waitFor(() => expect(network.count('/api/speeches/17/annotations')).toBe(1))
    await act(async () => { await view.router.navigate('/speeches/18') })
    await loaded('b')
    const second = currentPlayer()
    await act(async () => {
      playbackA.resolve(json({ url: 'https://media.example.test/late-a.mp4' }))
      annotationsA.resolve(json(annotationResponse(17)))
      await Promise.all([playbackA.promise, annotationsA.promise])
    })
    await waitFor(() => expect(annotationApi.endpoints.getAnnotations.select({ speechId: 17, reviewId: 501 })(store.getState()).data?.annotations[0].id).toBe('a-text'))
    expect(currentPlayer()).toBe(second)
    expect(playerHarness.instances).toHaveLength(1)
    expect(screen.queryByTestId('range-marker-a-text')).not.toBeInTheDocument()
    expect(second.root.querySelector('[data-testid="overlay-a-text"]')).toBeNull()
  })

  it.each([403, 404])('does not apply cached A tools to B while B resolves to %s', async (status) => {
    const pendingB = deferred<Response>()
    server((_request, url) => url.pathname === '/api/speeches/18' ? pendingB.promise : undefined)
    const view = watch()
    await loaded()
    const first = currentPlayer()
    await act(async () => { await view.router.navigate('/speeches/18') })
    expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
    expect(first.root.querySelector('[data-testid="voice-note-markers"]')).toBeNull()
    await act(async () => { pendingB.resolve(json({ message: 'Unavailable' }, status)); await pendingB.promise })
    await waitFor(() => expect(speechApi.endpoints.getSpeech.select(18)(view.store.getState()).error).toMatchObject({ status }))
    expect(speechApi.endpoints.getSpeech.select(18)(view.store.getState()).data).toBeUndefined()
    expect(first.root.querySelector('[data-testid="voice-note-markers"]')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
  })

  it('clears authorized annotation data on actual getMe401 despite RTK retaining the old user', async () => {
    let denied = false
    server((_request, url) => denied && url.pathname === '/api/me' ? json({ message: 'Unauthenticated' }, 401) : undefined)
    const view = watch()
    await loaded()
    denied = true
    await refreshMe(view.store)
    expect(authApi.endpoints.getMe.select()(view.store.getState()).data?.user.id).toBe(OWNER)
    expect(annotationApi.endpoints.getAnnotations.select({ speechId: 17, reviewId: 501 })(view.store.getState()).data).toBeUndefined()
    expect(annotationApi.endpoints.getCommentaryPlaybackPreference.select({ userId: OWNER, speechId: 17 })(view.store.getState()).data).toBeUndefined()
    expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('voice-note-markers')).not.toBeInTheDocument()
  })

  it('cancels an old account preference write and ignores its late acknowledgement after account replacement', async () => {
    let currentAccount = OWNER
    const pendingWrite = deferred<Response>()
    const network = server((request, url) => {
      if (url.pathname === '/api/me') return json(account(currentAccount))
      if (url.pathname.includes('/preferences/commentary-playback/') && request.method === 'PATCH') return pendingWrite.promise
    })
    const view = watch()
    await loaded()
    fireEvent.click(screen.getByRole('radio', { name: 'Audio only' }))
    await waitFor(() => expect(network.requests.some((request) => request.method === 'PATCH')).toBe(true))
    currentAccount = '9004'
    await refreshMe(view.store)
    expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
    await act(async () => { pendingWrite.resolve(json({ commentary_playback: { speech_id: 17, mode: 'voice', source: 'saved' } })); await pendingWrite.promise })
    expect(annotationApi.endpoints.getAnnotations.select({ speechId: 17, reviewId: 501 })(view.store.getState()).data).toBeUndefined()
    expect(annotationApi.endpoints.getCommentaryPlaybackPreference.select({ userId: OWNER, speechId: 17 })(view.store.getState()).data).toBeUndefined()
    expect(screen.queryByTestId('voice-note-markers')).not.toBeInTheDocument()
  })

  it.each([200, 500])('retains the picker and its actual POST %s result through failed network invalidation and recovery', async (status) => {
    let networkFailure = false
    let playbackUrl = SAME_URL
    const post = deferred<Response>()
    const network = server((_request, url) => {
      if (url.pathname.endsWith('/poster-frame')) return post.promise
      if (url.pathname === '/api/speeches/17' && networkFailure) return Promise.reject(new TypeError('Network unavailable'))
      if (url.pathname.endsWith('/playback-url')) return json({ url: playbackUrl })
    })
    const view = watch()
    const originalTools = await loaded()
    const first = currentPlayer()
    first.video.currentTime = 18.75
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    const button = screen.getByRole('button', { name: 'Use current frame' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveTextContent('Updating…'))
    fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    networkFailure = true
    await act(async () => { post.resolve(json({ asset: { id: 42 } }, status)); await post.promise })
    await waitFor(() => expect(speechApi.endpoints.getSpeech.select(17)(view.store.getState()).isError).toBe(true))
    const result = status === 200 ? 'Poster updating…' : 'Could not update poster.'
    expect(within(originalTools).getByText(result)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    expect(screen.getByRole('button', { name: 'Use current frame' })).toBe(button)
    expect(tools()).toBe(originalTools)
    networkFailure = false
    playbackUrl = 'https://media.example.test/recreated.mp4'
    playerHarness.autoReady = false
    await refreshSpeech(view.store)
    await waitFor(() => expect(first.disposed).toBe(true))
    expect(tools()).toBe(originalTools)
    expect(button).toBeDisabled()
    expect(within(originalTools).getByText(result)).toBeVisible()
    act(currentPlayer().ready)
    await waitFor(() => expect(button).not.toBeDisabled())
    expect(screen.getByRole('tab', { name: 'Frame selector' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Use current frame' })).toBe(button)
    const posts = network.requests.filter((request) => request.method === 'POST' && new URL(request.url).pathname.endsWith('/poster-frame'))
    expect(posts).toHaveLength(1)
    expect(new URL(posts[0].url).pathname).toBe('/api/speeches/17/assets/42/poster-frame')
    expect(await posts[0].json()).toEqual({ time_seconds: 18.75 })
  })

  it('preserves the utility, video and metadata engine during an adapter signed URL refresh', async () => {
    let playbackUrl = SAME_URL
    const network = server((_request, url) => url.pathname.endsWith('/playback-url') ? json({ url: playbackUrl }) : undefined)
    watch()
    const originalTools = await loaded()
    const instance = currentPlayer()
    const addTrack = vi.spyOn(instance.video, 'addTextTrack')
    instance.video.currentTime = 31
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    const button = screen.getByRole('button', { name: 'Use current frame' })
    playbackUrl = 'https://media.example.test/refreshed-signature.mp4'
    await act(async () => { await instance.refresh() })
    expect(currentPlayer()).toBe(instance)
    expect(instance.video.currentTime).toBe(31)
    expect(tools()).toBe(originalTools)
    expect(screen.getByRole('button', { name: 'Use current frame' })).toBe(button)
    expect(addTrack).not.toHaveBeenCalled()
    expect(network.count('/api/speeches/17/annotations')).toBe(1)
  })

  it('does not mark feedback read through passive timeline exposure or seeking while Essay and the video remain paused', async () => {
    const preference = deferred<Response>()
    const network = server((_request, url) => url.pathname.includes('/preferences/commentary-playback/') ? preference.promise : undefined)
    watch()
    await screen.findByRole('tab', { name: 'Essay' })
    fireEvent.click(screen.getByRole('tab', { name: 'Essay' }))
    await act(async () => { preference.resolve(json({ commentary_playback: { speech_id: 17, mode: 'all', source: 'saved' } })); await preference.promise })
    await loaded()
    const instance = currentPlayer()
    const play = vi.spyOn(instance.video, 'play')
    expect(instance.video.paused).toBe(true)
    expect(localStorage.getItem('commentary-seen:17:501')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    fireEvent.click(screen.getByTestId('range-marker-a-text'))
    expect(localStorage.getItem('commentary-seen:17:501')).toBeNull()
    expect(play).not.toHaveBeenCalled()
    expect(network.requests.some((request) => new URL(request.url).pathname.endsWith('/poster-frame'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Open Notes' }))
    await waitFor(() => expect(localStorage.getItem('commentary-seen:17:501')).toBe(review().last_published_at))
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveFocus()
  })

  it.each([401, 403, 404, 410])('suppresses cached annotation markers and reviewer label after annotation %s', async (status) => {
    let annotationStatus = 200
    server((_request, url) => url.pathname === '/api/speeches/17/annotations' && annotationStatus !== 200
      ? json({ message: 'Unavailable' }, annotationStatus) : undefined)
    const view = watch()
    await loaded()
    annotationStatus = status
    await act(async () => { await view.store.dispatch(annotationApi.endpoints.getAnnotations.initiate(
      { speechId: 17, reviewId: 501 }, { subscribe: false, forceRefetch: true })).unwrap().catch(() => undefined) })
    expect(annotationApi.endpoints.getAnnotations.select({ speechId: 17, reviewId: 501 })(view.store.getState()).data?.annotations).toHaveLength(3)
    expect(markers()).toHaveLength(0)
    expect(within(tools()).queryByText(/Coach 501/)).not.toBeInTheDocument()
    expect(within(tools()).getByText('Commentary is unavailable. Open Notes for details.')).toBeInTheDocument()
  })

  it('keeps successful annotation rows with a refresh error and suppresses them immediately when the selected reviewer is revoked', async () => {
    let annotationFailure = false
    let revoked = false
    server((_request, url) => {
      if (annotationFailure && url.pathname === '/api/speeches/17/annotations') return json({ message: 'Temporary failure' }, 500)
      if (revoked && url.pathname === '/api/speeches/17/review-roster') return json({ reviews: [{ ...review(), revoked_at: '2026-10-22T00:00:00Z' }] })
    })
    const view = watch()
    await loaded()
    annotationFailure = true
    await act(async () => { await view.store.dispatch(annotationApi.endpoints.getAnnotations.initiate(
      { speechId: 17, reviewId: 501 }, { subscribe: false, forceRefetch: true })).unwrap().catch(() => undefined) })
    expect(markers()).toHaveLength(3)
    expect(within(tools()).getByText(/Commentary could not refresh/)).toBeInTheDocument()
    revoked = true
    await act(async () => { await view.store.dispatch(reviewApi.endpoints.listReviewRoster.initiate(17,
      { subscribe: false, forceRefetch: true })).unwrap() })
    expect(markers()).toHaveLength(0)
    expect(within(tools()).queryByText(/Coach 501/)).not.toBeInTheDocument()
  })
  it('keeps live mode changes in the canonical preference controller while utility tabs preserve query and metadata lifetimes', async () => {
    const network = server()
    watch()
    const originalTools = await loaded()
    const instance = currentPlayer()
    const addTrack = vi.spyOn(instance.video, 'addTextTrack')
    const counts: [CommentaryPlaybackMode, string, number][] = [
      ['written', 'Written notes only', 2], ['voice', 'Audio only', 1], ['off', 'Off', 0], ['all', 'Text + audio', 3],
    ]
    for (const [mode, name, count] of counts) {
      fireEvent.click(screen.getByRole('radio', { name }))
      await waitFor(() => expect(screen.queryByText('Saving setting…')).not.toBeInTheDocument())
      expect(markers()).toHaveLength(count)
      if (mode === 'voice') expect(markers()[0].dataset.kind).toBe('voice')
      if (mode === 'written') expect(markers().some((marker) => marker.dataset.kind === 'erased-voice')).toBe(true)
      fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
      fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
      expect(tools()).toBe(originalTools)
      expect(currentPlayer()).toBe(instance)
      expect(screen.getByRole('radio', { name })).toBeChecked()
      expect(within(tools()).queryByText('A written body')).not.toBeInTheDocument()
      expect(within(tools()).queryByText('A voice transcript')).not.toBeInTheDocument()
    }
    expect(addTrack).not.toHaveBeenCalled()
    expect(network.count('/api/speeches/17/annotations')).toBe(1)
    const writes = network.requests.filter((request) => request.method === 'PATCH')
    expect(await Promise.all(writes.map((request) => request.json()))).toEqual(counts.map(([mode]) => ({ mode })))
  })

  it.each([401, 403, 404, 410])('does not expose cached annotations before preference hydration or after preference denial %s', async (status) => {
    const preference = deferred<Response>()
    server((_request, url) => url.pathname.includes('/preferences/commentary-playback/') ? preference.promise : undefined)
    const store = makeStore()
    await prime(store)
    watch(store)
    await screen.findByRole('tablist', { name: 'Video tools' })
    expect(markers()).toHaveLength(0)
    expect(within(tools()).queryByText(/Coach 501/)).not.toBeInTheDocument()
    await act(async () => { preference.resolve(json({ message: 'Unavailable' }, status)); await preference.promise })
    await waitFor(() => expect(within(tools()).getByText('Commentary is unavailable. Open Notes for details.')).toBeInTheDocument())
    expect(markers()).toHaveLength(0)
    expect(annotationApi.endpoints.getAnnotations.select({ speechId: 17, reviewId: 501 })(store.getState()).data?.annotations).toHaveLength(3)
    expect(screen.queryByTestId('overlay-a-text')).not.toBeInTheDocument()
  })

  it('keeps the same loading, playing and paused voice through utility tabs, then cancels once on marker seek without autoplay', async () => {
    const audioUrl = deferred<Response>()
    const network = server((_request, url) => url.pathname.endsWith('/a-voice/voice-playback-url') ? audioUrl.promise : undefined)
    const audios: HTMLAudioElement[] = []
    vi.stubGlobal('Audio', class {
      src: string
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      play = vi.fn(async () => undefined)
      pause = vi.fn()
      load = vi.fn()
      removeAttribute = vi.fn()
      constructor(src: string) { this.src = src; audios.push(this as unknown as HTMLAudioElement) }
    })
    watch()
    await loaded()
    const instance = currentPlayer()
    let paused = false
    Object.defineProperty(instance.video, 'paused', { configurable: true, get: () => paused })
    const videoPlay = vi.spyOn(instance.video, 'play').mockImplementation(async () => { paused = false })
    const videoPause = vi.spyOn(instance.video, 'pause').mockImplementation(() => { paused = true })
    act(() => { instance.video.currentTime = 11.5; instance.video.dispatchEvent(new Event('play')) })
    act(() => { instance.video.currentTime = 12.1; instance.video.dispatchEvent(new Event('timeupdate')) })
    await screen.findByText('Loading voice commentary…')
    expect(videoPause).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    expect(screen.getByText('Loading voice commentary…')).toBeInTheDocument()
    await act(async () => { audioUrl.resolve(json({ audio: { url: 'https://media.example.test/a.mp3', expires_at: '2099-01-01T00:00:00Z' } })); await audioUrl.promise })
    await screen.findByText('Playing voice commentary')
    expect(audios).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    expect(screen.getByText('Playing voice commentary')).toBeInTheDocument()
    expect(audios[0].pause).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Pause commentary' }))
    expect(audios[0].pause).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    expect(screen.getByText('Voice commentary paused')).toBeInTheDocument()
    expect(audios[0].pause).toHaveBeenCalledOnce()
    expect(audios[0].play).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByTestId('range-marker-a-text'))
    // Native seeking events belong to the media seam, not a second route cancel path.
    act(() => { instance.video.dispatchEvent(new Event('seeking')); instance.video.dispatchEvent(new Event('seeked')) })
    expect(instance.video.currentTime).toBe(2)
    expect(screen.queryByText('Voice commentary paused')).not.toBeInTheDocument()
    expect(audios[0].pause).toHaveBeenCalledTimes(2)
    expect(audios[0].load).toHaveBeenCalledOnce()
    expect(videoPlay).not.toHaveBeenCalled()
    expect(network.count('/api/speeches/17/annotations/a-voice/voice-playback-url')).toBe(1)
    expect(network.count('/api/speeches/17/annotations')).toBe(1)
  })

  it('ignores a delayed voice URL after a paused marker seek cancels its loading controller', async () => {
    const audioUrl = deferred<Response>()
    const network = server((_request, url) => url.pathname.endsWith('/a-voice/voice-playback-url') ? audioUrl.promise : undefined)
    const createAudio = vi.fn()
    vi.stubGlobal('Audio', class { constructor() { createAudio() } })
    watch()
    await loaded()
    const instance = currentPlayer()
    let paused = false
    Object.defineProperty(instance.video, 'paused', { configurable: true, get: () => paused })
    const play = vi.spyOn(instance.video, 'play').mockResolvedValue(undefined)
    vi.spyOn(instance.video, 'pause').mockImplementation(() => { paused = true })
    act(() => { instance.video.currentTime = 11.5; instance.video.dispatchEvent(new Event('play')) })
    act(() => { instance.video.currentTime = 12.1; instance.video.dispatchEvent(new Event('timeupdate')) })
    await screen.findByText('Loading voice commentary…')
    await waitFor(() => expect(network.count('/api/speeches/17/annotations/a-voice/voice-playback-url')).toBe(1))
    fireEvent.click(screen.getByTestId('range-marker-a-text'))
    act(() => { instance.video.dispatchEvent(new Event('seeking')); instance.video.dispatchEvent(new Event('seeked')) })
    await act(async () => { audioUrl.resolve(json({ audio: { url: 'https://media.example.test/late.mp3', expires_at: '2099-01-01T00:00:00Z' } })); await audioUrl.promise })
    expect(createAudio).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
    expect(screen.queryByText('Loading voice commentary…')).not.toBeInTheDocument()
    expect(instance.video.currentTime).toBe(2)
  })

  it('crossfades to a cached reviewer without remounting tools and ignores the old reviewer refresh that finishes later', async () => {
    const lateFirst = deferred<Response>()
    let refetchFirst = false
    const other = { ...notes()[0], id: 'other-text', start_seconds: 40, body: 'Other reviewer body' }
    server((_request, url) => {
      if (url.pathname === '/api/speeches/17/review-roster') return json({ reviews: [review(),
        { ...review(17, 503), last_published_at: '2026-09-01T00:00:00Z' }] })
      if (url.pathname === '/api/speeches/17/annotations') {
        if (url.searchParams.get('review_id') === '503') return json({ review_id: 503,
          reviewer: review(17, 503).reviewer, annotations: [other] })
        if (refetchFirst && url.searchParams.get('review_id') === '501') return lateFirst.promise
      }
    })
    const store = makeStore()
    await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false })).unwrap()
    await store.dispatch(annotationApi.endpoints.getAnnotations.initiate({ speechId: 17, reviewId: 503 }, { subscribe: false })).unwrap()
    watch(store)
    const originalTools = await loaded()
    const instance = currentPlayer()
    const addTrack = vi.spyOn(instance.video, 'addTextTrack')
    refetchFirst = true
    let request!: Promise<unknown>
    act(() => { request = store.dispatch(annotationApi.endpoints.getAnnotations.initiate(
      { speechId: 17, reviewId: 501 }, { subscribe: false, forceRefetch: true })) })
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    const picker = screen.getByRole('button', { name: 'Use current frame' })
    fireEvent.click(screen.getByRole('tab', { name: 'Essay' }))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Choose whose essay to read' }))
      .getByRole('radio', { name: 'Coach 503' }))
    expect(markers()).toHaveLength(0)
    expect(tools()).toBe(originalTools)
    expect(screen.getByRole('tab', { name: 'Frame selector' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('range-marker-other-text')).toBeInTheDocument(), { timeout: 2000 })
    await act(async () => { lateFirst.resolve(json(annotationResponse())); await lateFirst.promise; await request })
    expect(screen.queryByTestId('range-marker-a-text')).not.toBeInTheDocument()
    expect(markers()).toHaveLength(1)
    expect(currentPlayer()).toBe(instance)
    expect(screen.getByRole('button', { name: 'Use current frame' })).toBe(picker)
    expect(addTrack).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    fireEvent.click(screen.getByTestId('range-marker-other-text'))
    expect(instance.video.currentTime).toBe(40)
  })

})

describe('draggable timeline owner cache, source and native voice boundaries', () => {
  beforeEach(scrubSeam)

  it('cancels owner capture and rejects its saved route callback while auth refetch is pending, then resumes the same scope', async () => {
    const pendingAuth = deferred<Response>()
    let refetching = false
    const network = server((_request, url) => url.pathname === '/api/me' && refetching ? pendingAuth.promise : undefined)
    // Observe the actual props while still calling the real utility/component.
    const ownerRender = vi.spyOn(ownerToolsModule, 'OwnerVideoTools')
    const view = watch()
    const originalTools = await loaded()
    const instance = currentPlayer()
    const slider = sliderControl()
    const seek = ownerRender.mock.calls.find(([props]) => props.scrub?.enabled)?.[0].scrub?.onSeek
    expect(seek).toBeTypeOf('function')
    drag(slider, 'down', 50)
    drag(slider, 'move', 60)
    refetching = true
    let request!: Promise<unknown>
    await act(async () => {
      request = view.store.dispatch(authApi.endpoints.getMe.initiate(undefined,
        { forceRefetch: true, subscribe: false }))
      await Promise.resolve()
    })
    try {
      const auth = authApi.endpoints.getMe.select()(view.store.getState())
      expect(auth.status).toBe('pending')
      expect(auth.data?.user.id).toBe(OWNER)
      expect(slider).toHaveAttribute('aria-disabled', 'true')
      expect(slider).toHaveAttribute('tabindex', '-1')
      expect(slider).not.toHaveAttribute('data-dragging')
      expect(screen.getByTestId('timeline-axis').style.getPropertyValue('--scrub-preview-percent')).toBe('')
      act(() => { seek!(35) })
      drag(slider, 'up', 80)
      await flushMedia()
      expect(instance.seeks).toEqual([])
      expect(tools()).toBe(originalTools)
    } finally {
      await act(async () => { pendingAuth.resolve(json(account())); await request })
    }
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    drag(slider, 'up', 90)
    expect(instance.seeks).toEqual([])
    drag(slider, 'down', 70); drag(slider, 'up', 75)
    await flushMedia()
    expect(instance.seeks).toEqual([75])
    expect(currentPlayer()).toBe(instance)
    expect(tools()).toBe(originalTools)
    expect(network.count('/api/reviews')).toBe(0)
    expect(network.count('/api/speeches/17/annotations')).toBe(1)
    noDataWrites(network)
  })

  it.each(['off', 'empty', 'no-selection', 'unavailable'])('seeks valid media with commentary %s without a marker or data mutation', async (state) => {
    const network = server((_request, url) => {
      if (state === 'off' && url.pathname.includes('/preferences/commentary-playback/')) return json({ commentary_playback: { speech_id: 17, mode: 'off', source: 'saved' } })
      if (state === 'no-selection' && url.pathname.endsWith('/review-roster')) return json({ reviews: [] })
      if (url.pathname === '/api/speeches/17/annotations') {
        if (state === 'empty') return json({ ...annotationResponse(), annotations: [] })
        if (state === 'unavailable') return json({ message: 'Unavailable commentary' }, 403)
      }
    })
    watch()
    await screen.findByRole('tablist', { name: 'Video tools' })
    const slider = sliderControl()
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    await waitFor(() => expect(markers()).toHaveLength(0))
    const instance = currentPlayer()
    const play = vi.spyOn(instance.video, 'play')
    drag(slider, 'down', 40)
    drag(slider, 'move', 60)
    expect(instance.seeks).toEqual([])
    drag(slider, 'up', 70)
    await flushMedia()
    expect(instance.seeks).toEqual([70])
    expect(instance.video.paused).toBe(true)
    expect(play).not.toHaveBeenCalled()
    expect(markers()).toHaveLength(0)
    noDataWrites(network)
  })

  it('retires a captured A release across cached B with the same URL, including late old ready callbacks', async () => {
    const network = server()
    const store = makeStore()
    await prime(store)
    let view!: ReturnType<typeof watch>
    await act(async () => { view = watch(store) })
    await loaded()
    const first = currentPlayer()
    const slider = sliderControl()
    playerHarness.autoReady = false
    await act(async () => {
      drag(slider, 'down', 40)
      await view.router.navigate('/speeches/18')
    })
    await waitFor(() => expect(first.disposed).toBe(true))
    const second = currentPlayer()
    expect(second.url).toBe(first.url)
    expect(second.video).not.toBe(first.video)
    drag(slider, 'up', 70)
    await act(async () => { first.ready() })
    expect(first.seeks).toEqual([])
    expect(second.seeks).toEqual([])
    const unavailable = sliderControl()
    expect(unavailable).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { second.ready() })
    await loaded('b')
    expect(unavailable).toHaveAttribute('aria-disabled', 'false')
    drag(unavailable, 'down', 80); drag(unavailable, 'up', 80)
    await flushMedia()
    expect(first.seeks).toEqual([])
    expect(second.seeks).toEqual([80])
    noDataWrites(network)
  })

  it.each(['account replacement', 'terminal auth', 'disposed player'])('rejects an old captured commit after %s', async (change) => {
    let accountId = OWNER
    let denied = false
    const network = server((_request, url) => url.pathname === '/api/me'
      ? json(denied ? { message: 'Unauthenticated' } : account(accountId), denied ? 401 : 200) : undefined)
    const view = watch()
    await loaded()
    const instance = currentPlayer()
    const slider = sliderControl()
    drag(slider, 'down', 50)
    if (change === 'disposed player') instance.disposed = true
    else {
      if (change === 'account replacement') accountId = REVIEWER
      else denied = true
      await refreshMe(view.store)
    }
    drag(slider, 'up', 80)
    await flushMedia()
    expect(instance.seeks).toEqual([])
    noDataWrites(network)
  })

  it('preserves the mounted Frame selector through transient speech failure and rejects hidden/source-reset releases', async () => {
    let temporary = false
    let url = SAME_URL
    const network = server((_request, requestUrl) => {
      if (requestUrl.pathname === '/api/speeches/17' && temporary) return json({ message: 'Temporary' }, 500)
      if (requestUrl.pathname.endsWith('/playback-url')) return json({ url })
    })
    const view = watch()
    const originalTools = await loaded()
    const instance = currentPlayer()
    const slider = sliderControl()
    drag(slider, 'down', 50)
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' })) })
    const picker = screen.getByRole('button', { name: 'Use current frame' })
    drag(slider, 'up', 80)
    temporary = true
    await refreshSpeech(view.store)
    expect(tools()).toBe(originalTools)
    expect(screen.getByRole('button', { name: 'Use current frame' })).toBe(picker)
    temporary = false
    await refreshSpeech(view.store)
    expect(tools()).toBe(originalTools)
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' })) })
    drag(slider, 'down', 60)
    url = 'https://media.example.test/owner-refresh.mp4'
    await act(async () => { await instance.refresh() })
    drag(slider, 'up', 90)
    expect(instance.seeks).toEqual([])
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { instance.metadata() })
    expect(slider).toHaveAttribute('aria-disabled', 'false')
    expect(currentPlayer()).toBe(instance)
    expect(tools()).toBe(originalTools)
    noDataWrites(network)
  })

  it('does not mark paused Essay feedback read through scrub preview, cancellation or commit', async () => {
    const preference = deferred<Response>()
    const network = server((_request, url) => url.pathname.includes('/preferences/commentary-playback/') ? preference.promise : undefined)
    watch()
    await screen.findByRole('tab', { name: 'Essay' })
    fireEvent.click(screen.getByRole('tab', { name: 'Essay' }))
    await act(async () => { preference.resolve(json({ commentary_playback: { speech_id: 17, mode: 'all', source: 'saved' } })); await preference.promise })
    await loaded()
    const instance = currentPlayer()
    const play = vi.spyOn(instance.video, 'play')
    const slider = sliderControl()
    drag(slider, 'down', 40); drag(slider, 'move', 60)
    fireEvent.pointerCancel(slider, { pointerId: 1 })
    expect(localStorage.getItem('commentary-seen:17:501')).toBeNull()
    drag(slider, 'down', 40); drag(slider, 'up', 60)
    await flushMedia()
    expect(instance.seeks).toEqual([60])
    expect(instance.video.paused).toBe(true)
    expect(localStorage.getItem('commentary-seen:17:501')).toBeNull()
    expect(play).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Essay' })).toHaveAttribute('aria-selected', 'true')
    noDataWrites(network)
  })

  it.each(['loading', 'playing', 'paused'])('keeps %s voice through preview/cancel and cancels once on a committed native seek', async (voiceState) => {
    const audioUrl = deferred<Response>()
    const network = server((_request, url) => url.pathname.endsWith('/a-voice/voice-playback-url') ? audioUrl.promise : undefined)
    const audios: HTMLAudioElement[] = []
    vi.stubGlobal('Audio', class {
      src: string
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      play = vi.fn(async () => undefined)
      pause = vi.fn()
      load = vi.fn()
      removeAttribute = vi.fn()
      constructor(src: string) { this.src = src; audios.push(this as unknown as HTMLAudioElement) }
    })
    watch()
    await loaded()
    const instance = currentPlayer()
    let paused = false
    Object.defineProperty(instance.video, 'paused', { configurable: true, get: () => paused })
    const play = vi.spyOn(instance.video, 'play').mockImplementation(async () => { paused = false })
    vi.spyOn(instance.video, 'pause').mockImplementation(() => { paused = true })
    act(() => { instance.advance(11.5); instance.video.dispatchEvent(new Event('play')); instance.advance(12.1) })
    await findVoiceStatus('Loading voice commentary…', instance.video)
    if (voiceState !== 'loading') {
      await act(async () => { audioUrl.resolve(json({ audio: { url: 'https://media.example.test/voice.mp3', expires_at: '2099-01-01T00:00:00Z' } })); await audioUrl.promise })
      await screen.findByText('Playing voice commentary', undefined, { timeout: 4000 })
      if (voiceState === 'paused') fireEvent.click(screen.getByRole('button', { name: 'Pause commentary' }))
    }
    const status = voiceState === 'loading' ? 'Loading voice commentary…'
      : voiceState === 'playing' ? 'Playing voice commentary' : 'Voice commentary paused'
    const slider = sliderControl()
    const audioPauses = audios[0] ? vi.mocked(audios[0].pause).mock.calls.length : 0
    drag(slider, 'down', 40); drag(slider, 'move', 60)
    expect(screen.getByText(status)).toBeInTheDocument()
    expect(instance.seeks).toEqual([])
    fireEvent.keyDown(slider, { key: 'Escape' })
    expect(screen.getByText(status)).toBeInTheDocument()
    expect(play).not.toHaveBeenCalled()
    if (audios[0]) expect(audios[0].pause).toHaveBeenCalledTimes(audioPauses)
    drag(slider, 'down', 40); drag(slider, 'up', 70)
    await flushMedia()
    expect(instance.seeks).toEqual([70])
    expect(screen.queryByText(status)).not.toBeInTheDocument()
    expect(play).not.toHaveBeenCalled()
    expect(paused).toBe(true)
    if (voiceState === 'loading') {
      await act(async () => { audioUrl.resolve(json({ audio: { url: 'https://media.example.test/late.mp3', expires_at: '2099-01-01T00:00:00Z' } })); await audioUrl.promise })
      expect(audios).toHaveLength(0)
    } else {
      expect(audios[0].pause).toHaveBeenCalledTimes(audioPauses + 1)
      expect(audios[0].load).toHaveBeenCalledOnce()
    }
    expect(network.count('/api/speeches/17/annotations/a-voice/voice-playback-url')).toBe(1)
    noDataWrites(network)
  }, 15_000)
})

describe('draggable timeline with real RTK reviewer request provenance', () => {
  beforeEach(scrubSeam)

  it('cancels reviewer capture while getMe refetch retains an unresolved account, then restores the same validated scope', async () => {
    const pendingAuth = deferred<Response>()
    let refetching = false
    const network = reviewerServer((_request, url) => url.pathname === '/api/me' && refetching
      ? pendingAuth.promise : undefined)
    const store = makeStore()
    await primeReviewer(store)
    watch(store)
    const slider = await reviewerLoaded()
    const instance = currentPlayer()
    const axis = screen.getByTestId('timeline-axis')
    const reviewReads = network.count('/api/reviews')
    drag(slider, 'down', 50)
    drag(slider, 'move', 60)
    expect(slider).toHaveAttribute('data-dragging', 'true')
    refetching = true
    let request!: Promise<unknown>
    await act(async () => {
      request = store.dispatch(authApi.endpoints.getMe.initiate(undefined,
        { forceRefetch: true, subscribe: false }))
      await Promise.resolve()
    })
    try {
      const auth = authApi.endpoints.getMe.select()(store.getState())
      expect(auth.status).toBe('pending')
      expect(auth.isLoading).toBe(true)
      expect(auth.data?.user.id).toBe(REVIEWER)
      expect.soft(slider).toHaveAttribute('aria-disabled', 'true')
      expect.soft(slider).toHaveAttribute('tabindex', '-1')
      expect.soft(slider).not.toHaveAttribute('data-dragging')
      expect.soft(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('')
      drag(slider, 'up', 80)
      await flushMedia()
      expect.soft(instance.seeks).toEqual([])
      expect.soft(network.count('/api/reviews')).toBe(reviewReads)
    } finally {
      await act(async () => {
        pendingAuth.resolve(json(account(REVIEWER)))
        await request
      })
    }
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(network.count('/api/reviews')).toBe(reviewReads)
    drag(slider, 'down', 70); drag(slider, 'up', 75)
    await flushMedia()
    expect(instance.seeks).toEqual([75])
    noDataWrites(network)
  })

  it('discards initial review validation completed during unresolved auth and waits for one explicit fresh retry', async () => {
    const pendingAuth = deferred<Response>()
    const initialProof = deferred<Response>()
    let refetching = false
    let reads = 0
    const network = reviewerServer((_request, url) => {
      if (url.pathname === '/api/me' && refetching) return pendingAuth.promise
      if (url.pathname === '/api/reviews' && ++reads === 2) return initialProof.promise
    })
    const store = makeStore()
    await primeReviewer(store)
    watch(store)
    const slider = await reviewerLoaded(false)
    await waitFor(() => expect(network.count('/api/reviews')).toBe(2))
    const staleProofId = reviewState(store).requestId
    let request!: Promise<unknown>
    refetching = true
    await act(async () => {
      request = store.dispatch(authApi.endpoints.getMe.initiate(undefined,
        { forceRefetch: true, subscribe: false }))
      await Promise.resolve()
    })
    try {
      await act(async () => { initialProof.resolve(json(mySections())); await initialProof.promise })
      await waitFor(() => expect(reviewState(store).status).toBe('fulfilled'))
      expect(reviewState(store).requestId).toBe(staleProofId)
      expect(slider).toHaveAttribute('aria-disabled', 'true')
      expect(screen.queryByRole('button', { name: 'Retry timeline navigation' })).not.toBeInTheDocument()
      expect(network.count('/api/reviews')).toBe(2)
    } finally {
      await act(async () => { pendingAuth.resolve(json(account(REVIEWER))); await request })
    }
    const retry = await screen.findByRole('button', { name: 'Retry timeline navigation' })
    await waitFor(() => expect(retry).not.toBeDisabled())
    await flushMedia()
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(network.count('/api/reviews')).toBe(2)
    fireEvent.click(retry)
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(network.count('/api/reviews')).toBe(3)
    expect(reviewState(store).requestId).not.toBe(staleProofId)
    noDataWrites(network)
  })

  it('cancels capture before a pending auth request reveals a replacement account and requires its fresh review proof', async () => {
    const pendingAuth = deferred<Response>()
    const replacementProof = deferred<Response>()
    let authPending = false
    let reads = 0
    const network = reviewerServer((_request, url) => {
      if (url.pathname === '/api/me' && authPending) return pendingAuth.promise
      if (url.pathname === '/api/reviews' && ++reads === 3) return replacementProof.promise
    })
    const view = watch()
    const oldSlider = await reviewerLoaded()
    const instance = currentPlayer()
    expect(network.count('/api/reviews')).toBe(2)
    drag(oldSlider, 'down', 50)
    authPending = true
    let request!: Promise<unknown>
    await act(async () => {
      request = view.store.dispatch(authApi.endpoints.getMe.initiate(undefined,
        { forceRefetch: true, subscribe: false }))
      await Promise.resolve()
    })
    try {
      expect(authApi.endpoints.getMe.select()(view.store.getState()).data?.user.id).toBe(REVIEWER)
      expect(oldSlider).toHaveAttribute('aria-disabled', 'true')
      expect(oldSlider).not.toHaveAttribute('data-dragging')
      drag(oldSlider, 'up', 80)
      await flushMedia()
      expect(instance.seeks).toEqual([])
      expect(network.count('/api/reviews')).toBe(2)
    } finally {
      await act(async () => { pendingAuth.resolve(json(account('9005'))); await request })
    }
    const slider = await reviewerLoaded(false)
    await waitFor(() => expect(network.count('/api/reviews')).toBe(3))
    expect(slider).not.toBe(oldSlider)
    const requestId = reviewState(view.store).requestId
    drag(oldSlider, 'up', 90)
    expect(instance.seeks).toEqual([])
    await act(async () => { replacementProof.resolve(json(mySections())); await replacementProof.promise })
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(reviewState(view.store).requestId).toBe(requestId)
    expect(instance.seeks).toEqual([])
    drag(slider, 'down', 70); drag(slider, 'up', 75)
    await flushMedia()
    expect(instance.seeks).toEqual([75])
    expect(currentPlayer()).toBe(instance)
    expect(network.count('/api/reviews')).toBe(3)
    noDataWrites(network)
  })

  it.each([false, true])('requires exactly one fresh validation GET after cached entry (StrictMode %s)', async (strict) => {
    const fresh = deferred<Response>()
    let reads = 0
    const network = reviewerServer((_request, url) => {
      if (url.pathname === '/api/reviews' && ++reads === 2) return fresh.promise
    })
    const store = makeStore()
    await primeReviewer(store)
    const cachedId = reviewState(store).requestId
    expect(reviewState(store).data?.in_progress?.[0]).not.toHaveProperty('reviewer')
    watch(store, 17, strict)
    const slider = await reviewerLoaded(false)
    await waitFor(() => expect(network.count('/api/reviews')).toBe(2))
    const requestId = reviewState(store).requestId
    expect(requestId).not.toBe(cachedId)
    expect(reviewState(store).status).toBe('pending')
    const instance = currentPlayer()
    drag(slider, 'down', 60)
    drag(slider, 'up', 60)
    expect(instance.seeks).toEqual([])
    await act(async () => { fresh.resolve(json(mySections())); await fresh.promise })
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(reviewState(store).requestId).toBe(requestId)
    drag(slider, 'down', 60)
    drag(slider, 'move', 70)
    expect(instance.video.currentTime).toBe(0)
    drag(slider, 'up', 75)
    await flushMedia()
    expect(instance.seeks).toEqual([75])
    expect(network.count('/api/reviews')).toBe(2)
    expect(network.count('/api/speeches/17/annotations')).toBe(1)
    noDataWrites(network)
  })

  it.each([200, 403])('waits for an older void-key request (%s) and proves a distinct request actually started', async (status) => {
    const older = deferred<Response>()
    const fresh = deferred<Response>()
    let reads = 0
    const network = reviewerServer((_request, url) => {
      if (url.pathname !== '/api/reviews') return
      reads += 1
      if (reads === 2) return older.promise
      if (reads === 3) return fresh.promise
    })
    const store = makeStore()
    await primeReviewer(store)
    // An ordinary subscriber already owns the pending void-key request.
    const ordinary = store.dispatch(reviewApi.endpoints.listMyReviews.initiate(undefined, { forceRefetch: true }))
    const abort = vi.spyOn(ordinary, 'abort')
    const olderId = reviewState(store).requestId
    watch(store)
    const slider = await reviewerLoaded(false)
    expect(network.count('/api/reviews')).toBe(2)
    expect(reviewState(store).requestId).toBe(olderId)
    await act(async () => { older.resolve(json(status === 200 ? mySections() : { message: 'Old account denial' }, status)); await ordinary })
    await waitFor(() => expect(network.count('/api/reviews')).toBe(3))
    expect(abort).not.toHaveBeenCalled()
    const freshId = reviewState(store).requestId
    expect(freshId).not.toBe(olderId)
    expect(reviewState(store).status).toBe('pending')
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { fresh.resolve(json(mySections())); await fresh.promise })
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(reviewState(store).requestId).toBe(freshId)
    expect(network.count('/api/reviews')).toBe(3)
    ordinary.unsubscribe()
    noDataWrites(network)
  })

  it('does not let a late old-account validation authorize the replacement account', async () => {
    const oldProof = deferred<Response>()
    const newProof = deferred<Response>()
    let identity = REVIEWER
    let reads = 0
    const network = reviewerServer((_request, url) => {
      if (url.pathname === '/api/me') return json(account(identity))
      if (url.pathname === '/api/reviews') {
        reads += 1
        if (reads === 2) return oldProof.promise
        if (reads === 3) return newProof.promise
      }
    })
    const store = makeStore()
    await primeReviewer(store)
    watch(store)
    await reviewerLoaded(false)
    await waitFor(() => expect(network.count('/api/reviews')).toBe(2))
    const oldId = reviewState(store).requestId
    identity = '9005'
    await refreshMe(store)
    const slider = sliderControl()
    const instance = currentPlayer()
    await act(async () => { oldProof.resolve(json(mySections())); await oldProof.promise })
    await waitFor(() => expect(network.count('/api/reviews')).toBe(3))
    expect(reviewState(store).requestId).not.toBe(oldId)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    drag(slider, 'down', 70); drag(slider, 'up', 70)
    expect(instance.seeks).toEqual([])
    await act(async () => { newProof.resolve(json(mySections())); await newProof.promise })
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    drag(slider, 'down', 80); drag(slider, 'up', 80)
    await flushMedia()
    expect(instance.seeks).toEqual([80])
    noDataWrites(network)
  })

  it('does not start queued verification when its reviewer route disappears', async () => {
    const older = deferred<Response>()
    let reads = 0
    const network = reviewerServer((_request, url) => {
      if (url.pathname === '/api/reviews' && ++reads === 2) return older.promise
    })
    const store = makeStore()
    await primeReviewer(store)
    const ordinary = store.dispatch(reviewApi.endpoints.listMyReviews.initiate(undefined, { forceRefetch: true }))
    const view = watch(store)
    await reviewerLoaded(false)
    view.unmount()
    await act(async () => { older.resolve(json(mySections())); await ordinary })
    expect(network.count('/api/reviews')).toBe(2)
    ordinary.unsubscribe()
    noDataWrites(network)
  })

  it('cancels an authorized reviewer capture on account replacement before its new validation completes', async () => {
    let identity = REVIEWER
    const proof = deferred<Response>()
    const network = reviewerServer((_request, url) => {
      if (url.pathname === '/api/me') return json(account(identity))
      if (url.pathname === '/api/reviews' && identity !== REVIEWER) return proof.promise
    })
    const view = watch()
    const oldSlider = await reviewerLoaded()
    const instance = currentPlayer()
    drag(oldSlider, 'down', 50)
    identity = '9005'
    await refreshMe(view.store)
    const slider = await reviewerLoaded(false)
    drag(oldSlider, 'up', 80)
    expect(instance.seeks).toEqual([])
    expect(slider).not.toBe(oldSlider)
    expect(currentPlayer()).toBe(instance)
    await act(async () => { proof.resolve(json(mySections())); await proof.promise })
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(instance.seeks).toEqual([])
    noDataWrites(network)
  })

  it('leaves initial failure unavailable without a loop, bounds duplicate retry and requires its fresh success', async () => {
    const retried = deferred<Response>()
    let reads = 0
    const network = reviewerServer((_request, url) => {
      if (url.pathname !== '/api/reviews') return
      reads += 1
      if (reads === 2) return json({ message: 'Try later' }, 500)
      if (reads === 3) return retried.promise
    })
    const store = makeStore()
    await primeReviewer(store)
    watch(store)
    const slider = await reviewerLoaded(false)
    const retry = await screen.findByRole('button', { name: 'Retry timeline navigation' })
    await waitFor(() => expect(retry).not.toBeDisabled())
    expect(reviewState(store).status).toBe('rejected')
    expect(reviewState(store).data?.in_progress?.[0].id).toBe(501)
    await flushMedia()
    expect(network.count('/api/reviews')).toBe(2)
    fireEvent.click(retry); fireEvent.click(retry)
    await waitFor(() => expect(network.count('/api/reviews')).toBe(3))
    const retryId = reviewState(store).requestId
    expect(retry).toBeDisabled()
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { retried.resolve(json(mySections())); await retried.promise })
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(reviewState(store).requestId).toBe(retryId)
    expect(screen.queryByRole('button', { name: 'Retry timeline navigation' })).not.toBeInTheDocument()
    expect(network.count('/api/reviews')).toBe(3)
    noDataWrites(network)
  })

  it.each([401, 403, 404, 410])('erases proof on review %s; pending retry and retained-data 500 cannot restore it', async (status) => {
    let response: number | Promise<Response> = 200
    const network = reviewerServer((_request, url) => url.pathname === '/api/reviews'
      ? typeof response === 'number' ? json(response === 200 ? mySections() : { message: 'Denied' }, response) : response : undefined)
    const view = watch()
    const slider = await reviewerLoaded()
    const instance = currentPlayer()
    drag(slider, 'down', 60)
    response = status
    await refreshReviews(view.store)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(reviewState(view.store).data?.in_progress?.[0].id).toBe(501)
    drag(slider, 'up', 70)
    expect(instance.seeks).toEqual([])
    const failed = deferred<Response>()
    response = failed.promise
    const retry = screen.getByRole('button', { name: 'Retry timeline navigation' })
    fireEvent.click(retry)
    await waitFor(() => expect(reviewState(view.store).status).toBe('pending'))
    const failedId = reviewState(view.store).requestId
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { failed.resolve(json({ message: 'Temporary' }, 500)); await failed.promise })
    await waitFor(() => expect(reviewState(view.store).status).toBe('rejected'))
    await waitFor(() => expect(retry).not.toBeDisabled())
    expect(reviewState(view.store).requestId).toBe(failedId)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    const count = network.count('/api/reviews')
    await flushMedia()
    expect(network.count('/api/reviews')).toBe(count)
    response = 200
    fireEvent.click(retry)
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(reviewState(view.store).requestId).not.toBe(failedId)
    expect(network.count('/api/reviews')).toBe(count + 1)
    noDataWrites(network)
  })

  it.each([401, 403, 404, 410])('blocks retained review proof after getMe %s through pending and 500 auth recovery', async (status) => {
    let authResponse: number | Promise<Response> = 200
    const network = reviewerServer((_request, url) => url.pathname === '/api/me'
      ? typeof authResponse === 'number' ? json(authResponse === 200 ? account(REVIEWER) : { message: 'Denied' }, authResponse) : authResponse : undefined)
    const view = watch()
    const slider = await reviewerLoaded()
    const instance = currentPlayer()
    drag(slider, 'down', 50)
    authResponse = status
    await refreshMe(view.store)
    expect(authApi.endpoints.getMe.select()(view.store.getState()).data?.user.id).toBe(REVIEWER)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    drag(slider, 'up', 80)
    expect(instance.seeks).toEqual([])
    const delayed = deferred<Response>()
    authResponse = delayed.promise
    let pending!: Promise<unknown>
    act(() => { pending = view.store.dispatch(authApi.endpoints.getMe.initiate(undefined,
      { forceRefetch: true, subscribe: false })) })
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { delayed.resolve(json({ message: 'Temporary failure' }, 500)); await pending })
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: 'Retry timeline navigation' })).not.toBeInTheDocument()
    const reads = network.count('/api/reviews')
    authResponse = 200
    await refreshMe(view.store)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(network.count('/api/reviews')).toBe(reads)
    fireEvent.click(screen.getByRole('button', { name: 'Retry timeline navigation' }))
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'))
    expect(network.count('/api/reviews')).toBe(reads + 1)
    noDataWrites(network)
  })

  it('requires fresh review proof after a current speech denial and transient retained-data recovery', async () => {
    let speechStatus = 200
    const network = reviewerServer((_request, url) => url.pathname === '/api/speeches/17' && speechStatus !== 200
      ? json({ message: 'Unavailable' }, speechStatus) : undefined)
    const view = watch()
    const slider = await reviewerLoaded()
    const instance = currentPlayer()
    drag(slider, 'down', 50)
    speechStatus = 403
    await refreshSpeech(view.store)
    drag(slider, 'up', 80)
    expect(instance.seeks).toEqual([])
    speechStatus = 500
    await refreshSpeech(view.store)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    speechStatus = 200
    await refreshSpeech(view.store)
    const recovered = await reviewerLoaded(false)
    fireEvent.click(screen.getByRole('button', { name: 'Retry timeline navigation' }))
    await waitFor(() => expect(recovered).toHaveAttribute('aria-disabled', 'false'))
    noDataWrites(network)
  })

  it('retains a validated scope through nonterminal background review failure without a validation loop', async () => {
    let failed = false
    const network = reviewerServer((_request, url) => failed && url.pathname === '/api/reviews'
      ? json({ message: 'Temporary' }, 500) : undefined)
    const view = watch()
    const slider = await reviewerLoaded()
    const before = network.count('/api/reviews')
    failed = true
    await refreshReviews(view.store)
    expect(reviewState(view.store).status).toBe('rejected')
    expect(slider).toHaveAttribute('aria-disabled', 'false')
    drag(slider, 'down', 45); drag(slider, 'up', 45)
    await flushMedia()
    expect(currentPlayer().seeks).toEqual([45])
    expect(network.count('/api/reviews')).toBe(before + 1)
    noDataWrites(network)
  })

  it('reconciles a replacement review before enabling it and retires a captured release when revoked', async () => {
    let id = 501
    let revoked = false
    const network = reviewerServer((_request, url) => {
      if (url.pathname === '/api/reviews') return json(revoked
        ? { in_progress: [], revoked: [{ ...myReview(17, id), revoked_at: '2026-10-22T00:00:00Z' }] } : mySections(id))
    })
    const view = watch()
    const first = await reviewerLoaded()
    const instance = currentPlayer()
    drag(first, 'down', 60)
    id = 601
    await refreshReviews(view.store)
    drag(first, 'up', 70)
    expect(instance.seeks).toEqual([])
    const second = await reviewerLoaded()
    expect(second).not.toBe(first)
    expect(reviewState(view.store).data?.in_progress?.[0].id).toBe(601)
    await waitFor(() => expect(network.requests.some((request) =>
      new URL(request.url).pathname === '/api/speeches/17/annotations' && new URL(request.url).searchParams.get('review_id') === '601')).toBe(true))
    drag(second, 'down', 80)
    revoked = true
    await refreshReviews(view.store)
    drag(second, 'up', 90)
    expect(instance.seeks).toEqual([])
    expect(screen.queryByRole('slider', { name: 'Video position' })).not.toBeInTheDocument()
    noDataWrites(network)
  })

  it.each(['loadstart', 'emptied', 'error'] as const)('cancels reviewer %s without extra review GET; only fresh metadata restores navigation', async (event) => {
    const network = reviewerServer()
    watch()
    const slider = await reviewerLoaded()
    const instance = currentPlayer()
    const reads = network.count('/api/reviews')
    drag(slider, 'down', 50)
    act(() => instance.resetMedia(event))
    drag(slider, 'up', 70)
    expect(instance.seeks).toEqual([])
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    // A retained finite duration and durationchange do not prove the new epoch.
    act(() => {
      Object.defineProperties(instance.video, {
        readyState: { value: 1, writable: true, configurable: true },
        error: { value: null, writable: true, configurable: true },
      })
      instance.video.dispatchEvent(new Event('durationchange'))
    })
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    act(instance.metadata)
    expect(slider).toHaveAttribute('aria-disabled', 'false')
    drag(slider, 'down', 80); drag(slider, 'up', 80)
    await flushMedia()
    expect(instance.seeks).toEqual([80])
    expect(network.count('/api/reviews')).toBe(reads)
    noDataWrites(network)
  })

  it('cancels same-element signed-URL generations without another validation GET or losing an authoring draft', async () => {
    let url = SAME_URL
    const network = reviewerServer((_request, requestUrl) => requestUrl.pathname.endsWith('/playback-url') ? json({ url }) : undefined)
    watch()
    const slider = await reviewerLoaded()
    const instance = currentPlayer()
    const draft = screen.getByLabelText('Commentary', { selector: 'textarea' })
    fireEvent.change(draft, { target: { value: 'Keep my unsent draft' } })
    const reads = network.count('/api/reviews')
    drag(slider, 'down', 40)
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Essay' })) })
    drag(slider, 'up', 60)
    expect(instance.seeks).toEqual([])
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Notes' })) })
    expect(screen.getByLabelText('Commentary', { selector: 'textarea' })).toBe(draft)
    drag(slider, 'down', 50)
    url = 'https://media.example.test/refreshed.mp4'
    await act(async () => { await instance.refresh() })
    drag(slider, 'up', 80)
    expect(instance.seeks).toEqual([])
    expect(currentPlayer()).toBe(instance)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    act(instance.metadata)
    expect(slider).toHaveAttribute('aria-disabled', 'false')
    expect(draft).toHaveValue('Keep my unsent draft')
    expect(screen.getByLabelText('Commentary', { selector: 'textarea' })).toBe(draft)
    expect(network.count('/api/reviews')).toBe(reads)
    noDataWrites(network)
  })
})
