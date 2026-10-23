import { createRef, StrictMode } from 'react'
import type { ComponentProps } from 'react'
import { speechApi } from '@/features/speech/speechApi'
import { reviewApi } from '@/features/review/reviewApi'
import { authApi } from '@/features/auth/authApi'
import { annotationApi } from '@/features/annotation/annotationApi'
import { VideoPlayer } from '@/components/speech/VideoPlayer'
import type { AnnotationComposerPanel } from '@/components/annotation/AnnotationComposerPanel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type Player from 'video.js/dist/types/player'
import { Routes, Route } from 'react-router-dom'
import SpeechWatch, { PosterFramePicker, OverlayPositioner } from '@/routes/SpeechWatch'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import type { SpeechSprite } from '@/features/speech/types'
import type { Review } from '@/features/review/types'
import { playbackPreferences } from '@/lib/commentaryPlaybackPreference'
import { WorkspaceCompanionProvider } from '@/components/workspace/WorkspaceCompanionProvider'
import { useWorkspaceCompanionScene } from '@/components/workspace/useWorkspaceCompanion'

function CompanionProbe() {
  const scene = useWorkspaceCompanionScene()
  return <output data-testid="published-companion">{scene ?? 'none'}</output>
}

beforeEach(() => { playbackPreferences.setIdentity(null); localStorage.clear() })

type PlayerHarnessInstance = {
  player: Player
  video: HTMLVideoElement
  root: HTMLDivElement
  url: string
  disposed: boolean
  ready: () => void
  refresh: () => Promise<string>
  replacePresentation: () => void
}
const playerHarness = vi.hoisted(() => ({
  autoReady: true,
  instances: [] as PlayerHarnessInstance[],
}))
beforeEach(() => {
  playerHarness.autoReady = true
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
      const instance: PlayerHarnessInstance = {
        root, video, url: props.initialUrl, disposed: false,
        replacePresentation: () => setPresentationGeneration((generation) => generation + 1),
        player: null as unknown as Player,
        ready: () => { if (!instance.disposed) latest.current.onPlayerReady?.(instance.player) },
        refresh: async () => {
          const url = await latest.current.refreshUrl()
          if (!instance.disposed) {
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

// A microphone seam retains a real pending Blob while route/composer state,
// tab mounting, timers, list, editor and visual preview remain production code.
vi.mock('@/components/annotation/VoiceRecorder', async () => {
  const { useState } = await import('react')
  return { VoiceRecorder: ({ onPendingChange }: { onPendingChange?: (id: string, pending: boolean) => void }) => {
    const [blob, setBlob] = useState<Blob | null>(null)
    return <button type="button" onClick={() => {
      setBlob(new Blob(['unsaved voice']))
      onPendingChange?.('pending-route-recording', true)
    }}>{blob ? `Unsaved recording: ${blob.size} bytes` : 'Capture test recording'}</button>
  } }
})

// Wraps the REAL panel, recording the props SpeechWatch passes so tests can
// drive the lock callback and assert authoringActive.
const panelSpy = vi.hoisted(() => ({
  props: [] as Array<ComponentProps<typeof AnnotationComposerPanel>>,
}))
beforeEach(() => { panelSpy.props = [] })
vi.mock('@/components/annotation/AnnotationComposerPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/annotation/AnnotationComposerPanel')>()
  return { ...actual, AnnotationComposerPanel: (props: ComponentProps<typeof actual.AnnotationComposerPanel>) => {
    panelSpy.props.push(props)
    return <actual.AnnotationComposerPanel {...props} />
  } }
})
const latestPanel = () => panelSpy.props[panelSpy.props.length - 1]

/**
 * §8.6: the overlay's actual vertical placement lives on THIS wrapper —
 * the one element with room to place content in the upper vs lower half
 * of the video frame — not on `OverlayStack`'s own (content-sized) inner
 * box. A regression here (e.g. reverting to a hardcoded `justify-end`)
 * would silently defeat `useCaptionsAnchor`'s top-anchoring whenever
 * captions are showing, even though `OverlayStack.tsx` itself still
 * computes the "right" anchor-dependent class for its own children.
 */
describe('OverlayPositioner', () => {
  it('anchors to the top (data-anchor="top", justify-start) when captions are showing', () => {
    render(
      <OverlayPositioner anchor="top">
        <div>content</div>
      </OverlayPositioner>,
    )
    const positioner = screen.getByTestId('overlay-positioner')
    expect(positioner).toHaveAttribute('data-anchor', 'top')
    expect(positioner.className).toContain('justify-start')
    expect(positioner.className).not.toContain('justify-end')
  })

  it('anchors to the bottom (data-anchor="default", justify-end) when captions are not showing', () => {
    render(
      <OverlayPositioner anchor="default">
        <div>content</div>
      </OverlayPositioner>,
    )
    const positioner = screen.getByTestId('overlay-positioner')
    expect(positioner).toHaveAttribute('data-anchor', 'default')
    expect(positioner.className).toContain('justify-end')
    expect(positioner.className).not.toContain('justify-start')
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function fakePlayer(currentTime: number): Player {
  return { currentTime: () => currentTime, isDisposed: () => false } as unknown as Player
}

const sprite: SpeechSprite = {
  url: 'https://example.com/sprite.jpg',
  columns: 5,
  rows: 2,
  frame_width: 800, // whole-tile width: 5 cols * 160px
  frame_height: 180, // whole-tile height: 2 rows * 90px
  duration_seconds: '100',
}

/**
 * STEP-04-every-video-plays.md §9.5: "use current frame" and the
 * sprite-strip picker both call `POST .../poster-frame` — this checks the
 * mutation fires with the right `time_seconds` payload from each trigger.
 */
describe('PosterFramePicker', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('"Use current frame" calls the poster-frame mutation with the player\'s currentTime', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/poster-frame')) {
        expect(JSON.parse(String(init?.body))).toEqual({ time_seconds: 12.5 })
        return jsonResponse({
          asset: { id: 9, kind: 'video', status: 'ready', failure_code: null, duration_seconds: null, width: null, height: null, poster_time_seconds: '12.5' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const playerRef = createRef<Player | null>()
    ;(playerRef as { current: Player | null }).current = fakePlayer(12.5)

    const user = userEvent.setup()
    renderWithProviders(<PosterFramePicker speechId={1} assetId={9} playerRef={playerRef} />)

    await user.click(screen.getByRole('button', { name: /use current frame/i }))

    await waitFor(() => {
      const called = fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/speeches/1/assets/9/poster-frame'))
      expect(called).toBe(true)
    })
  })

  it('clicking a sprite cell calls the poster-frame mutation with the computed timestamp', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.includes('/poster-frame')) {
        // Cell index 3 of 10, duration 100s -> 3/10 * 100 = 30.
        expect(JSON.parse(String(init?.body))).toEqual({ time_seconds: 30 })
        return jsonResponse({
          asset: { id: 9, kind: 'video', status: 'ready', failure_code: null, duration_seconds: null, width: null, height: null, poster_time_seconds: '30' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const playerRef = createRef<Player | null>()
    ;(playerRef as { current: Player | null }).current = fakePlayer(0)

    const user = userEvent.setup()
    renderWithProviders(<PosterFramePicker speechId={1} assetId={9} playerRef={playerRef} sprite={sprite} />)

    const cells = screen.getAllByRole('button', { name: /use frame at/i })
    expect(cells).toHaveLength(10)

    await user.click(screen.getByRole('button', { name: 'Use frame at 30.0s' }))

    await waitFor(() => {
      const called = fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/speeches/1/assets/9/poster-frame'))
      expect(called).toBe(true)
    })
  })
})


// Even programmatic activation cannot submit against an unavailable media binding.
describe('PosterFramePicker unavailable playback', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each(['disabled', 'missing', 'disposed'])('guards both actions when playback is %s', (state) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const playerRef = createRef<Player | null>()
    if (state !== 'missing') playerRef.current = {
      currentTime: () => 7, isDisposed: () => state === 'disposed',
    } as unknown as Player
    renderWithProviders(<PosterFramePicker speechId={1} assetId={9} playerRef={playerRef}
      sprite={sprite} disabled={state === 'disabled'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use current frame' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use frame at 30.0s' }))
    expect(fetchMock).not.toHaveBeenCalled()
    if (state === 'disabled') screen.getAllByRole('button').forEach((button) => expect(button).toBeDisabled())
  })
})

/**
 * PLAN-ACCESS-DENIED-STATES.md §0.1/§5.2. Until this block existed, the
 * default-exported `SpeechWatch` was never rendered by any test — only its
 * two named sub-components were — which is exactly why the loading guard
 * shipped conflating "still fetching" with "the fetch failed" and hung on
 * `Loading…` forever for every 403/404/500.
 *
 * Rendered through an explicit `<Routes>` (PublicProfile-style) rather than
 * bare, because the component reads `:id` via `useParams`.
 */
describe('SpeechWatch access states', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  const me = {
    user: {
      id: '9003',
      email: 'coach@e2e.test',
      first_name: 'Cora',
      last_name: 'Coach',
      username: 'e2e-coach',
      display_name: 'Cora Coach',
      email_verified: true,
      roles: ['coach'],
      onboarding_completed: true,
      onboarding_step: 4,
    },
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /** Answers `/api/me` normally and `/api/speeches/:id` with whatever this
   * case is exercising. */
  function stubSpeechFetch(speechResponse: () => Response) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString()
      // Order matters: the voice-commentary preference route is nested
      // UNDER /api/me, so a loose `includes('/api/me')` match swallows it
      // and hands the hook a `{user}` payload, which it then dereferences
      // as `.voice_commentary.speech_id` and crashes on. Match the specific
      // route first and the identity route exactly.
      if (url.includes('/preferences/voice-commentary/')) {
        return json({ voice_commentary: { speech_id: 17, mode: 'play', experienced: true } })
      }
      if (url.endsWith('/api/me')) return json(me)
      if (url.includes('/api/speeches/')) return speechResponse()
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function renderWatch(route = '/speeches/17') {
    return renderWithProviders(
      <Routes>
        <Route path="/speeches/:id" element={<SpeechWatch />} />
      </Routes>,
      { route },
    )
  }

  it('renders an access-denied refusal on 403, and never says why', async () => {
    stubSpeechFetch(() => json({ message: 'Access denied.', code: 'speech_access_denied' }, 403))
    renderWatch()

    expect(await screen.findByText(/access denied/i)).toBeInTheDocument()
    // The regression that mattered: it must stop claiming to be loading.
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    // §1 Option A: the denial surface discloses nothing about a revocation.
    expect(document.body.textContent?.toLowerCase()).not.toContain('revok')
    // A permission state is muted, not announced as a failure.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders a not-found refusal on 404 rather than hanging', async () => {
    stubSpeechFetch(() => json({ message: 'No such speech.' }, 404))
    renderWatch()

    expect(await screen.findByText(/no such speech/i)).toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('announces a genuine failure as an alert, distinct from a refusal', async () => {
    stubSpeechFetch(() => json({ message: 'Server error.' }, 500))
    renderWatch()

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load this speech/i)
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
  })

  it('refuses a non-numeric id without ever issuing a request', async () => {
    const fetchMock = stubSpeechFetch(() => json({}, 200))
    renderWatch('/speeches/not-an-id')

    // `Number('not-an-id')` is NaN, so `skip` suppresses the query entirely
    // — there is no error object to read, which is the second path into the
    // old hang.
    expect(await screen.findByText(/no such speech/i)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) =>
      (input instanceof Request ? input.url : String(input)).includes('/api/speeches/'),
    )).toBe(false)
  })

  it('still renders the speech when access is granted', async () => {
    stubSpeechFetch(() =>
      json({
        speech: {
          id: 17,
          ulid: '01ABC',
          title: 'A Granted Speech',
          description: null,
          user_id: 9003,
          duration_seconds: 65.7,
          primary_video: null,
        },
      }),
    )
    renderWatch()

    expect(await screen.findByText('A Granted Speech')).toBeInTheDocument()
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument()
  })
})

/**
 * PLAN-WATCH-REVIEWERS-TAB.md §7. Inviting a reviewer used to be an
 * owner-only header button that swapped an inline panel in ABOVE the tab
 * strip; it is now a fourth `Reviewers` tab inside the owner's strip. Two
 * things about that move are only provable by test: that the invite
 * surface is still owner-only now that it is a tab rather than an
 * `{isOwner && …}` header slot, and that it is still reachable before
 * transcode finishes — the old button lived in the always-rendered
 * header, so moving it to a tab is exactly the kind of change that can
 * accidentally make inviting wait on a video the speaker is inviting
 * people to watch.
 */
describe('SpeechWatch reviewers tab', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  const OWNER_ID = 9003

  function userPayload(id: string) {
    return {
      user: {
        id,
        email: 'speaker@e2e.test',
        first_name: 'Sam',
        last_name: 'Speaker',
        username: 'e2e-speaker',
        display_name: 'Sam Speaker',
        email_verified: true,
        roles: ['member'],
        onboarding_completed: true,
        onboarding_step: 4,
      },
    }
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /** Matched on `pathname`, not `includes()`, because three of the routes
   * this screen touches are prefixes of one another once the tab strip and
   * the invite panel are both mounted: `/api/reviewers` (directory search)
   * vs `/api/reviews` (the viewer's own reviews) vs
   * `/api/speeches/17/review-roster` (the owner's commentary tracks — §7.4
   * switched `useCommentaryTrack` from `/reviews` to `/review-roster`,
   * since §7.2 put the note-count/unread data this feature needs only on
   * the roster resource). A loose substring match hands one endpoint's
   * payload to another endpoint's `transformResponse`, which fails as a
   * crash rather than as an assertion. */
  function pathOf(input: RequestInfo | URL): string {
    const raw = input instanceof Request ? input.url : input.toString()
    return new URL(raw, 'http://localhost').pathname
  }

  function stubWatchFetch({
    speech,
    reviewers = [],
    myReviews = {},
    roster = [],
  }: {
    speech: unknown
    reviewers?: unknown[]
    myReviews?: unknown
    /** §7.4: the owner's commentary-track data — `useCommentaryTrack` now
     * reads this endpoint instead of `/reviews`. Defaults to empty, same
     * as the old default did. */
    roster?: unknown[]
  }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input)
      if (path.startsWith('/api/me/preferences/commentary-playback/')) {
        return json({ commentary_playback: { speech_id: 17, mode: 'all', source: 'saved' } })
      }
      if (path === '/api/me') return json(userPayload(String(OWNER_ID)))
      // The reviewer directory behind the invite panel. `keepMounted` on
      // the Reviewers panel means `useSearchReviewersQuery` fires on the
      // first render, before the tab is ever selected — so this has to
      // answer even in the cases that never click the tab.
      if (path === '/api/reviewers') {
        return json({ reviewers, meta: { current_page: 1, last_page: 1, total: reviewers.length } })
      }
      // `useMyReviewForSpeech` — what decides whether a non-owner gets the
      // reviewer-side "Your feedback" strip at all.
      if (path === '/api/reviews') return json(myReviews)
      if (path === '/api/speeches/17') return json({ speech })
      if (path === '/api/speeches/17/review-roster') return json({ reviews: roster })
      // §7.4: a default/manual chip selection fires `getAnnotations` for
      // that review — needed now that the default-selection tests below
      // select a real review on load rather than staying on NO_COMMENTARY.
      if (path === '/api/speeches/17/annotations') {
        const reviewId = Number(new URL(urlOf(input), 'http://localhost').searchParams.get('review_id'))
        const match = roster.find((r) => (r as { id: number }).id === reviewId) as { reviewer?: unknown } | undefined
        return json({ review_id: reviewId, reviewer: match?.reviewer ?? null, annotations: [] })
      }
      // §7.4: EssayReviewerPicker's selection drives EssayReadOnlyPanel's
      // `getEssay` fetch — needed for the Essay-tab picker integration test.
      if (path === '/api/speeches/17/essay') {
        return json({ essay: { essay_html: null, essay_published_at: null } })
      }
      if (path === '/api/speeches/17/captions') {
        return json({
          captions: { vtt: null, status: 'unavailable', failure_code: null, updated_at: null, asset_id: null, revision: null },
        })
      }
      if (/^\/api\/speeches\/17\/assets\/\d+\/playback-url$/.test(path)) {
        return json({ url: 'https://example.com/signed.mp4' })
      }
      if (path.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      throw new Error(`unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  /** `status` is `SpeechAsset['status']` — `'ready'` is the only value that
   * unlocks the player (and, for a reviewer, the whole "Your feedback"
   * strip); the other three are the pre-playback states §1.5 cares about. */
  function speechFixture({
    userId = OWNER_ID,
    videoStatus = 'ready' as 'uploading' | 'processing' | 'ready' | 'failed',
  } = {}) {
    return {
      id: 17,
      ulid: '01ABC',
      title: 'A Speech With Tabs',
      description: null,
      delivered_on: null,
      change_note: null,
      created_at: '2026-10-01T00:00:00Z',
      captions_enabled: true,
      user_id: userId,
      primary_video: {
        id: 42,
        kind: 'video',
        status: videoStatus,
        failure_code: null,
        duration_seconds: '65.7',
        width: 1920,
        height: 1080,
        poster_time_seconds: null,
      },
    }
  }

  function renderWatch() {
    return renderWithProviders(
      <WorkspaceCompanionProvider>
        <CompanionProbe />
        <Routes>
          <Route path="/speeches/:id" element={<SpeechWatch />} />
        </Routes>
      </WorkspaceCompanionProvider>,
      { route: '/speeches/17' },
    )
  }

  /** A `GET /api/speeches/17/review-roster` row, trimmed to what
   * `useCommentaryTrack`'s default-selection logic and `TrackSelector`'s
   * chips read. */
  function rosterReview(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      status: 'published',
      invitation_message: null,
      allow_preview: false,
      prior_commentary_shared: false,
      invited_at: '2026-09-01T10:00:00Z',
      responded_at: '2026-09-01T11:00:00Z',
      first_published_at: '2026-09-02T10:00:00Z',
      last_published_at: '2026-09-02T10:00:00Z',
      last_transition_at: '2026-09-02T10:00:00Z',
      revoked_at: null,
      revocation_reason: null,
      annotations_count: 3,
      published_annotations_count: 3,
      revoked_by_is_self: false,
      reviewer: { id: 7, username: 'coach7', name: 'Coach Seven' },
      ...overrides,
    }
  }

  /**
   * IMPLEMENTATION-PLANS.md §7.4: "the default state of the screen whose
   * purpose is displaying feedback is displaying none" — `useCommentaryTrack`
   * now auto-selects the most recently published reviewer on load instead
   * of leaving every speaker on `NO_COMMENTARY` until they click a chip.
   */
  it('defaults the commentary selection to the reviewer who published most recently', async () => {
    stubWatchFetch({
      speech: speechFixture(),
      roster: [
        rosterReview({
          id: 1,
          reviewer: { id: 7, name: 'Earlier Coach' },
          first_published_at: '2026-09-01T10:00:00Z',
          last_published_at: '2026-09-01T10:00:00Z',
        }),
        rosterReview({
          id: 2,
          reviewer: { id: 8, name: 'Later Coach' },
          first_published_at: '2026-09-03T10:00:00Z',
          last_published_at: '2026-09-03T10:00:00Z',
        }),
        // Accepted but hasn't published anything yet — not a candidate for
        // the default, regardless of `last_transition_at`.
        rosterReview({
          id: 3,
          status: 'accepted',
          reviewer: { id: 9, name: 'Still Working Coach' },
          first_published_at: null,
          last_published_at: null,
        }),
      ],
    })
    renderWatch()

    const radiogroup = await screen.findByRole('radiogroup', { name: 'Choose commentary track' })
    const laterChip = await within(radiogroup).findByRole('radio', { name: /Later Coach/ })
    const earlierChip = within(radiogroup).getByRole('radio', { name: /Earlier Coach/ })

    // The radiogroup itself renders as soon as `optionsLoading` settles
    // false, but the auto-select effect's `setSelected` flushes on a
    // following tick — `waitFor`, not a bare assertion, gives it that
    // room rather than racing it.
    await waitFor(() => expect(laterChip).toBeChecked())
    expect(earlierChip).not.toBeChecked()
  })

  it('keeps an internal empty selection without a redundant No commentary chip when nobody has published', async () => {
    stubWatchFetch({
      speech: speechFixture(),
      roster: [
        rosterReview({
          id: 1,
          status: 'accepted',
          reviewer: { id: 7, name: 'Still Working Coach' },
          first_published_at: null,
          last_published_at: null,
        }),
      ],
    })
    renderWatch()

    const radiogroup = await screen.findByRole('radiogroup', { name: 'Choose commentary track' })
    expect(within(radiogroup).queryByRole('radio', { name: 'No commentary' })).not.toBeInTheDocument()
    expect(within(radiogroup).getByRole('radio', { name: /Still Working Coach/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Text + audio' })).toBeDisabled()
  })

  it('gives the owner a Reviewers tab in the Speech tools strip', async () => {
    stubWatchFetch({ speech: speechFixture() })
    renderWatch()

    const strip = await screen.findByRole('tablist', { name: 'Speech tools' })
    // Asserted as a tab inside the strip, not merely as text on the page:
    // the invite panel's own copy also says "reviewer", so a bare text
    // query would pass even if the tab itself were missing.
    expect(await screen.findByRole('tab', { name: 'Reviewers' })).toBeInTheDocument()
    expect(strip).toContainElement(screen.getByRole('tab', { name: 'Reviewers' }))
  })

  it('does not give a non-owner a Reviewers tab on the reviewer-side strip', async () => {
    stubWatchFetch({
      // Someone else's speech, reviewed by the signed-in user — the only
      // state in which a non-owner gets a tab strip here at all, so the
      // absence below is a real absence and not just an unrendered strip.
      speech: speechFixture({ userId: 4242 }),
      myReviews: {
        in_progress: [
          {
            id: 501,
            status: 'in_progress',
            invitation_message: null,
            allow_preview: false,
            prior_commentary_shared: false,
            invited_at: '2026-10-01T00:00:00Z',
            responded_at: '2026-10-02T00:00:00Z',
            first_published_at: null,
            last_published_at: null,
            last_transition_at: '2026-10-02T00:00:00Z',
            revoked_at: null,
            revocation_reason: null,
            speech: { id: 17, ulid: '01ABC', title: 'A Speech With Tabs', owner_name: 'Sam Speaker' },
          },
        ],
      },
    })
    renderWatch()

    const strip = await screen.findByRole('tablist', { name: 'Your feedback' })
    expect(strip).toBeInTheDocument()
    // Inviting is the speaker's prerogative; a reviewer must not acquire it
    // just because the control moved from a gated header slot into a strip.
    expect(screen.queryByRole('tab', { name: 'Reviewers' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('invite-reviewer-panel')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Search the reviewer directory')).not.toBeInTheDocument()
  })

  it('no longer offers an "Invite a reviewer" button in the header', async () => {
    stubWatchFetch({ speech: speechFixture() })
    renderWatch()

    await screen.findByRole('tab', { name: 'Reviewers' })
    // Pins the removal: the panel is reachable only through the tab now, so
    // a reintroduced header toggle would be a second, divergent entry point
    // (and would push the whole strip down the page again, which is what
    // the move was for).
    expect(screen.queryByRole('button', { name: /invite a reviewer/i })).not.toBeInTheDocument()
  })

  it('reveals the reviewer search once the Reviewers tab is selected', async () => {
    stubWatchFetch({
      speech: speechFixture(),
      reviewers: [{ id: 77, username: 'rory', name: 'Rory Reviewer', credential: 'coach', avatar_url: null }],
    })
    const user = userEvent.setup()
    renderWatch()

    const tab = await screen.findByRole('tab', { name: 'Reviewers' })
    // `keepMounted` keeps the panel's DOM alive from the first render, so
    // the search input EXISTS before the tab is clicked — asserting
    // `toBeInTheDocument()` here would pass without the click doing
    // anything. Visibility is the real claim: Base UI marks the inactive
    // panel `hidden`, so only selecting the tab actually shows it.
    expect(screen.getByLabelText('Search the reviewer directory')).not.toBeVisible()

    await user.click(tab)

    expect(await screen.findByLabelText('Search the reviewer directory')).toBeVisible()
    expect(screen.getByTestId('invite-reviewer-panel')).toBeVisible()
    expect(await screen.findByText('Rory Reviewer')).toBeVisible()
  })

  it('keeps the Reviewers tab reachable while the video is still processing', async () => {
    // §1.5 / §7.4 — the behaviour a careless implementation regresses. The
    // old invite button lived in the always-rendered card header, so it
    // worked the moment the speech record existed; the player, the captions
    // toggle, the poster picker and the reviewer-side strip are all gated
    // on `primary_video.status === 'ready'`. If the Reviewers tab had been
    // folded in behind any of those gates, a speaker could not line up
    // reviewers during the minutes a transcode takes — precisely when they
    // would.
    stubWatchFetch({ speech: speechFixture({ videoStatus: 'processing' }) })
    const user = userEvent.setup()
    renderWatch()

    expect(await screen.findByText('A Speech With Tabs')).toBeInTheDocument()
    const processingNotice = screen.getByText(/not ready to play yet/i)
    expect(processingNotice).toHaveClass('workspace-notebook-surface')
    expect(screen.queryByTestId('watch-player')).not.toBeInTheDocument()

    const tab = await screen.findByRole('tab', { name: 'Reviewers' })
    await user.click(tab)
    expect(await screen.findByLabelText('Search the reviewer directory')).toBeVisible()
  })

  /**
   * IMPLEMENTATION-PLANS.md §7.4: the Essay tab used to have no picker of
   * its own — opening it before ever visiting Notes landed on "Pick a
   * reviewer to see their essay" with nothing on screen to act on.
   * `EssayReviewerPicker` fixes that; this proves the wiring end to end,
   * not just the component in isolation (`EssayReviewerPicker.test.tsx`
   * covers the component itself).
   */
  it('lets the owner pick a reviewer from inside the Essay tab, and that selection drives the essay fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = stubWatchFetch({
      speech: speechFixture(),
      roster: [
        rosterReview({ id: 1, reviewer: { id: 7, name: 'Earlier Coach' }, first_published_at: '2026-09-01T10:00:00Z', last_published_at: '2026-09-01T10:00:00Z' }),
        rosterReview({ id: 2, reviewer: { id: 8, name: 'Later Coach' }, first_published_at: '2026-09-03T10:00:00Z', last_published_at: '2026-09-03T10:00:00Z' }),
      ],
    })
    renderWatch()

    const essayTab = await screen.findByRole('tab', { name: 'Essay' })
    await user.click(essayTab)

    const picker = await screen.findByRole('radiogroup', { name: 'Choose whose essay to read' })
    const laterChip = within(picker).getByRole('radio', { name: 'Later Coach' })
    const earlierChip = within(picker).getByRole('radio', { name: 'Earlier Coach' })

    // §7.4's default-selection behaviour (tested separately above) already
    // picks the most-recently-published reviewer, so Later Coach starts
    // checked with no click — the real thing this test exercises is
    // clicking the OTHER chip actually switching the selection, proving
    // the picker drives the SAME shared state Notes' TrackSelector does,
    // not a local copy of it.
    await waitFor(() => expect(laterChip).toBeChecked())

    await user.click(earlierChip)

    await waitFor(() => expect(earlierChip).toHaveAttribute('aria-checked', 'true'))
    expect(laterChip).toHaveAttribute('aria-checked', 'false')
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/speeches/17/essay?review_id=1')),
      ).toBe(true),
    )
  })

  it('updates owner context without replacing the player or losing an invitation draft', async () => {
    const fetchMock = stubWatchFetch({ speech: speechFixture() })
    const user = userEvent.setup()
    const view = renderWatch()
    const player = await screen.findByTestId('watch-player')
    const expectScene = async (scene: string) => {
      await waitFor(() => expect(screen.getByTestId('published-companion')).toHaveTextContent(scene))
      expect(view.container.querySelector('.workspace-scene--compact')).toHaveAttribute('data-workspace-scene', scene)
      expect(screen.getByTestId('watch-player')).toBe(player)
      expect(player.closest('.workspace-notebook-surface')).toBeNull()
    }
    await expectScene('reviews')
    await user.click(screen.getByRole('tab', { name: 'Reviewers' }))
    await expectScene('reviewers')
    const message = screen.getByLabelText('Message (optional)')
    await user.type(message, 'Please review my opening.')
    await user.click(screen.getByRole('tab', { name: 'Essay' }))
    await expectScene('edit')
    await user.click(screen.getByRole('tab', { name: 'Transcript' }))
    await expectScene('search')
    await user.click(screen.getByRole('tab', { name: 'Notes' }))
    await expectScene('reviews')
    await user.click(screen.getByRole('tab', { name: 'Reviewers' }))
    await expectScene('reviewers')
    expect(screen.getByLabelText('Message (optional)')).toBe(message)
    expect(message).toHaveValue('Please review my opening.')
    expect(fetchMock.mock.calls.filter(([input]) => urlOf(input).includes('/playback-url'))).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it.each([403, 404, 200])('suppresses local and published art for cached A while B resolves (%s)', async (status) => {
    const fetchMock = stubWatchFetch({ speech: speechFixture() })
    const originalFetch = fetchMock.getMockImplementation()!
    let finish!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    fetchMock.mockImplementation(async (input) => {
      const path = pathOf(input)
      if (path === '/api/speeches/18') return pending
      if (path === '/api/speeches/18/review-roster') return json({ reviews: [] })
      if (path === '/api/speeches/18/captions') return json({ captions: { status: 'unavailable', vtt: null } })
      return originalFetch(input)
    })
    const user = userEvent.setup()
    const view = renderWatch()
    await screen.findByTestId('watch-player')
    await user.click(screen.getByRole('tab', { name: 'Reviewers' }))
    await waitFor(() => expect(screen.getByTestId('published-companion')).toHaveTextContent('reviewers'))
    const player = screen.getByTestId('watch-player')
    await act(async () => { await view.router.navigate('/speeches/18') })
    // Preserve the existing retained-query rendering while hiding its art.
    expect(screen.getByRole('heading', { name: 'A Speech With Tabs' })).toBeInTheDocument()
    expect(screen.getByTestId('watch-player')).toBe(player)
    expect(screen.getByTestId('published-companion')).toHaveTextContent('none')
    expect(view.container.querySelector('.workspace-scene--compact')).toBeNull()
    await act(async () => {
      finish(status === 200
        ? json({ speech: { ...speechFixture(), id: 18, title: 'Current speech B' } })
        : json({ message: 'Unavailable' }, status))
      await pending
    })
    if (status === 200) {
      await screen.findByRole('heading', { name: 'Current speech B' })
      await waitFor(() => expect(screen.getByTestId('published-companion')).toHaveTextContent('reviewers'))
      expect(view.container.querySelector('.workspace-scene--compact')).toHaveAttribute('data-workspace-scene', 'reviewers')
    } else {
      await waitFor(() => expect(view.store.getState().speechApi.queries['getSpeech(18)']?.status).toBe('rejected'))
      expect(screen.getByTestId('published-companion')).toHaveTextContent('none')
      expect(view.container.querySelector('.workspace-scene--compact')).toBeNull()
    }
  })

  it('observes real reviewer tabs while retaining the mounted Notes composer', async () => {
    stubWatchFetch({
      speech: speechFixture({ userId: 4242 }),
      myReviews: { in_progress: [{ ...rosterReview(), id: 501, status: 'in_progress',
        speech: { id: 17, title: 'A Speech With Tabs' } }] },
    })
    const user = userEvent.setup()
    const view = renderWatch()
    await screen.findByRole('tablist', { name: 'Your feedback' })
    const player = screen.getByTestId('watch-player')
    const composer = await screen.findByText('Your commentary')
    const draft = await screen.findByLabelText('Commentary')
    await user.type(draft, 'A pending written note.')
    await waitFor(() => expect(screen.getByTestId('published-companion')).toHaveTextContent('reviews'))
    await user.click(screen.getByRole('tab', { name: 'Transcript' }))
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('published-companion')).toHaveTextContent('search'))
    expect(view.container.querySelector('.workspace-scene--compact')).toHaveAttribute('data-workspace-scene', 'search')
    expect(composer).toBeInTheDocument()
    expect(composer).not.toBeVisible()
    expect(screen.getByTestId('watch-player')).toBe(player)
    await user.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(composer).toBeVisible()
    expect(screen.getByLabelText('Commentary')).toBe(draft)
    expect(draft).toHaveValue('A pending written note.')
    expect(screen.getByTestId('published-companion')).toHaveTextContent('reviews')
  })


  function reviewerReview(speechId = 17, id = 501): Review {
    return { ...rosterReview(), id, status: 'in_progress',
      speech: { id: speechId, ulid: `01TEST${speechId}`, title: `Speech ${speechId}`, owner_name: 'Owner' } } as Review
  }

  function writtenNote(id: string, body: string) {
    return { id, timing_type: 'range', start_seconds: 2, duration_seconds: 5,
      body, kind: 'observation', topic: null, voice: null, lock_version: 0, client_uuid: `uuid-${id}` }
  }

  function stubReviewerFetch() {
    const mock = stubWatchFetch({ speech: speechFixture({ userId: 4242 }),
      myReviews: { in_progress: [reviewerReview(), reviewerReview(18, 502)] } })
    const original = mock.getMockImplementation()!
    mock.mockImplementation(async (input) => {
      const path = pathOf(input)
      if (path === '/api/me') return json({ user: { ...userPayload(String(OWNER_ID)).user, roles: ['coach'] } })
      if (path === '/api/speeches/18') return json({ speech: {
        ...speechFixture({ userId: 4242 }), id: 18, title: 'Speech B',
        primary_video: { ...speechFixture().primary_video, id: 84 },
      } })
      if (path === '/api/speeches/18/assets/84/playback-url') return json({ url: 'https://example.com/signed.mp4' })
      if (path === '/api/speeches/18/captions') return json({ captions: { status: 'unavailable', vtt: null } })
      if (path === '/api/speeches/18/essay') return json({ essay: { essay_html: null, essay_published_at: null } })
      if (path === '/api/speeches/17/annotations' || path === '/api/speeches/18/annotations') {
        const isA = path.includes('/17/')
        const reviewId = isA ? 501 : 502
        expect(new URL(urlOf(input), 'http://localhost').searchParams.get('review_id')).toBe(String(reviewId))
        return json({ review_id: reviewId, reviewer: null,
          annotations: [writtenNote(isA ? 'note-a' : 'note-b', isA ? 'Only A commentary' : 'Only B commentary')] })
      }
      return original(input)
    })
    return mock
  }

  function activePlayer() {
    const active = playerHarness.instances.filter((instance) => !instance.disposed)
    expect(active).toHaveLength(1)
    return active[0]
  }

  function seekPlayer(instance: PlayerHarnessInstance, time = 3) {
    act(() => { instance.video.currentTime = time; instance.video.dispatchEvent(new Event('seeked')) })
  }

  function enterDraft(body = 'Unsent reviewer draft') {
    const editor = screen.getByRole('region', { name: 'New annotation' })
    fireEvent.change(within(editor).getByLabelText('Start'), { target: { value: '10' } })
    fireEvent.change(within(editor).getByLabelText('End'), { target: { value: '15' } })
    const input = within(editor).getByLabelText('Commentary')
    fireEvent.change(input, { target: { value: body } })
    return input
  }

  it('validates review rows without reviewer identity and guards captured scrub callbacks across source refresh', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let reviews = 0
    let completeValidation!: (response: Response) => void
    const rows = { in_progress: [{ ...reviewerReview(), reviewer: undefined }] }
    mock.mockImplementation(async (input) => {
      if (pathOf(input) === '/api/reviews') {
        reviews += 1
        return reviews === 2 ? new Promise<Response>((resolve) => { completeValidation = resolve }) : json(rows)
      }
      return original(input)
    })
    renderWatch()
    await screen.findByRole('region', { name: 'New annotation' })
    await waitFor(() => expect(reviews).toBe(2))
    expect(latestPanel().scrub?.enabled).toBe(false)
    act(() => completeValidation(json(rows)))
    await waitFor(() => expect(latestPanel().scrub?.enabled).toBe(true))
    enterDraft()
    const source = activePlayer()
    const captured = latestPanel().scrub!
    act(() => captured.onSeek(33))
    expect(source.video.currentTime).toBe(33)
    expect(screen.getByLabelText('Start')).toHaveValue('10')
    await act(async () => { await source.refresh() })
    await waitFor(() => expect(latestPanel().scrub?.bindingKey).not.toBe(captured.bindingKey))
    act(() => captured.onSeek(45))
    expect(source.video.currentTime).toBe(33)
    act(() => latestPanel().scrub!.onSeek(46))
    expect(source.video.currentTime).toBe(46)
    expect(reviews).toBe(2)
  })

  it('bounds a failed reviewer navigation check and permits one explicit pending retry', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let reviews = 0
    let finishRetry!: (response: Response) => void
    const rows = { in_progress: [{ ...reviewerReview(), reviewer: undefined }] }
    mock.mockImplementation(async (input) => {
      if (pathOf(input) === '/api/reviews') {
        reviews += 1
        if (reviews === 1) return json(rows)
        if (reviews === 2) return json({ message: 'Temporary failure' }, 500)
        return new Promise<Response>((resolve) => { finishRetry = resolve })
      }
      return original(input)
    })
    const view = renderWatch()
    const retry = await screen.findByRole('button', { name: 'Retry timeline navigation' })
    await waitFor(() => { expect(reviews).toBe(2); expect(retry).toBeEnabled() })
    expect(latestPanel().scrub?.enabled).toBe(false)
    act(() => { view.store.dispatch(authApi.util.updateQueryData('getMe', undefined, (data) => { data.user.display_name = 'Same account' })) })
    expect(reviews).toBe(2)
    fireEvent.click(retry)
    await waitFor(() => { expect(reviews).toBe(3); expect(retry).toBeDisabled() })
    fireEvent.click(retry)
    expect(reviews).toBe(3)
    act(() => finishRetry(json(rows)))
    await waitFor(() => expect(latestPanel().scrub?.enabled).toBe(true))
    expect(screen.queryByRole('button', { name: 'Retry timeline navigation' })).not.toBeInTheDocument()
  })

  it('withholds reviewer scrub callbacks during retained-data auth refresh and resumes the same proof without another review GET', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let reviews = 0
    let refreshAuth = false
    let completeAuth!: (response: Response) => void
    mock.mockImplementation(async (input) => {
      if (pathOf(input) === '/api/reviews') reviews += 1
      if (pathOf(input) === '/api/me' && refreshAuth) return new Promise<Response>((resolve) => { completeAuth = resolve })
      return original(input)
    })
    const view = renderWatch()
    await waitFor(() => expect(latestPanel()?.scrub?.enabled).toBe(true))
    const source = activePlayer()
    const captured = latestPanel().scrub!
    expect(reviews).toBe(2)
    refreshAuth = true
    let authRequest!: Promise<unknown>
    act(() => { authRequest = view.store.dispatch(authApi.endpoints.getMe.initiate(undefined, {
      subscribe: false, forceRefetch: true,
    })) })
    await waitFor(() => expect(latestPanel().scrub?.enabled).toBe(false))
    expect(authApi.endpoints.getMe.select()(view.store.getState())).toMatchObject({
      status: 'pending', data: { user: { id: String(OWNER_ID) } },
    })
    act(() => { captured.onSeek(80); latestPanel().scrub!.onSeek(81) })
    expect(source.video.currentTime).toBe(0)
    await act(async () => {
      completeAuth(json({ user: { ...userPayload(String(OWNER_ID)).user, roles: ['coach'] } }))
      await authRequest
    })
    await waitFor(() => expect(latestPanel().scrub?.enabled).toBe(true))
    expect(latestPanel().scrub?.bindingKey).toBe(captured.bindingKey)
    expect(reviews).toBe(2)
    act(() => latestPanel().scrub!.onSeek(42))
    expect(source.video.currentTime).toBe(42)
  })

  it('starts fresh validation for a new user despite the previous account’s cached review denial', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let reviews = 0
    let completeNewUser!: (response: Response) => void
    const rows = { in_progress: [{ ...reviewerReview(), reviewer: undefined }] }
    mock.mockImplementation(async (input) => {
      if (pathOf(input) === '/api/reviews') {
        reviews += 1
        if (reviews <= 2) return json(rows)
        if (reviews === 3) return json({ message: 'Previous account denied' }, 403)
        return new Promise<Response>((resolve) => { completeNewUser = resolve })
      }
      return original(input)
    })
    const view = renderWatch()
    await waitFor(() => expect(latestPanel()?.scrub?.enabled).toBe(true))
    const oldCallback = latestPanel().scrub!.onSeek
    const source = activePlayer()
    await act(async () => { await view.store.dispatch(reviewApi.endpoints.listMyReviews.initiate(undefined, {
      subscribe: false, forceRefetch: true,
    })) })
    await waitFor(() => expect(latestPanel().scrub?.enabled).toBe(false))
    act(() => { view.store.dispatch(authApi.util.updateQueryData('getMe', undefined, (data) => { data.user.id = '99' })) })
    await waitFor(() => expect(reviews).toBe(4))
    expect(latestPanel().scrub?.enabled).toBe(false)
    act(() => oldCallback(41))
    expect(source.video.currentTime).toBe(0)
    act(() => completeNewUser(json(rows)))
    await waitFor(() => expect(latestPanel().scrub?.enabled).toBe(true))
    act(() => latestPanel().scrub!.onSeek(42))
    expect(source.video.currentTime).toBe(42)
    expect(reviews).toBe(4)
  })

  it('keeps a current terminal review denial latched through a failed retry until fresh success', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let reviews = 0
    let completeRetry!: (response: Response) => void
    const rows = { in_progress: [{ ...reviewerReview(), reviewer: undefined }] }
    mock.mockImplementation(async (input) => {
      if (pathOf(input) === '/api/reviews') {
        reviews += 1
        if (reviews <= 2) return json(rows)
        if (reviews === 3) return json({ message: 'Denied' }, 403)
        if (reviews === 4) return json({ message: 'Transient failure' }, 500)
        return new Promise<Response>((resolve) => { completeRetry = resolve })
      }
      return original(input)
    })
    const view = renderWatch()
    await waitFor(() => expect(latestPanel()?.scrub?.enabled).toBe(true))
    const captured = latestPanel().scrub!
    await act(async () => { await view.store.dispatch(reviewApi.endpoints.listMyReviews.initiate(undefined, {
      subscribe: false, forceRefetch: true,
    })) })
    await waitFor(() => expect(latestPanel().scrub?.enabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Retry timeline navigation' }))
    await waitFor(() => { expect(reviews).toBe(4); expect(screen.getByRole('button', { name: 'Retry timeline navigation' })).toBeEnabled() })
    act(() => captured.onSeek(31))
    expect(activePlayer().video.currentTime).toBe(0)
    expect(latestPanel().scrub?.enabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Retry timeline navigation' }))
    await waitFor(() => expect(reviews).toBe(5))
    expect(latestPanel().scrub?.enabled).toBe(false)
    act(() => completeRetry(json(rows)))
    await waitFor(() => expect(latestPanel().scrub?.enabled).toBe(true))
    expect(latestPanel().scrub?.bindingKey).not.toBe(captured.bindingKey)
    expect(reviews).toBe(5)
  })

  it('waits for concrete player readiness and keeps one reviewer portal and draft across Notes, Essay and Transcript', async () => {
    playerHarness.autoReady = false
    const mock = stubReviewerFetch()
    const user = userEvent.setup()
    renderWatch()
    await screen.findByTestId('watch-player')
    await screen.findByText('Your commentary')
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    const instance = activePlayer()
    // Readiness does not depend on native currentSrc having metadata yet.
    expect(instance.video.currentSrc).toBe('')
    const addTrack = vi.spyOn(instance.video, 'addTextTrack')
    act(instance.ready)
    const target = await screen.findByTestId('reviewer-preview-target')
    seekPlayer(instance)
    expect(within(target).getByTestId('overlay-note-a')).toHaveAttribute('data-visible', 'true')
    expect(instance.root).toContainElement(target)
    expect(target.closest('.owner-feedback-frame')).toBeInTheDocument()
    expect(target.closest('.workspace-notebook-surface')).toBeNull()
    expect(target.closest('[data-testid="overlay-positioner"]')).toHaveAttribute('data-anchor', 'default')
    const draft = enterDraft()
    seekPlayer(instance, 12)
    expect(target.querySelector('[data-draft="true"]')).toHaveTextContent('Unsent reviewer draft')
    await user.click(screen.getByRole('tab', { name: /^Voice note/ }))
    await user.click(screen.getByRole('button', { name: 'Capture test recording' }))
    const recording = screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })
    expect(addTrack).toHaveBeenCalledTimes(1)
    for (const tab of ['Essay', 'Transcript']) {
      await user.click(screen.getByRole('tab', { name: tab }))
      expect(screen.getByTestId('reviewer-preview-target')).toBe(target)
      expect(within(target).queryByTestId('overlay-stack')).not.toBeInTheDocument()
      expect(instance.video).toBe(screen.getByTestId('speech-video'))
    }
    await user.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(screen.getByLabelText('Commentary', { selector: 'textarea' })).toBe(draft)
    expect(draft).toHaveValue('Unsent reviewer draft')
    expect(target.querySelector('[data-draft="true"]')).toHaveTextContent('Unsent reviewer draft')
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    // The single paged list is folded by default for a populated review.
    await user.click(screen.getByRole('button', { name: /^Saved notes/ }))
    expect(screen.getAllByRole('list', { name: 'Your commentary' })).toHaveLength(1)
    expect(addTrack).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })).toBe(recording)
    expect(playerHarness.instances).toHaveLength(1)
    expect(mock.mock.calls.filter(([input]) => pathOf(input).endsWith('/annotations'))).toHaveLength(1)
    expect(document.querySelector('div.pointer-events-none.min-h-16')).toBeNull()
  })

  it.each([403, 404])('removes A preview during pending B and B %s while retaining A-bound URL refresh', async (status) => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let finish!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    mock.mockImplementation((input) => pathOf(input) === '/api/speeches/18' ? pending : original(input))
    const view = renderWatch()
    await screen.findByTestId('reviewer-preview-target')
    const a = activePlayer()
    seekPlayer(a)
    await act(async () => { await view.router.navigate('/speeches/18') })
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    expect(screen.getByTestId('speech-video')).toBe(a.video)
    await act(async () => { await a.refresh() })
    expect(mock.mock.calls.filter(([input]) => pathOf(input) === '/api/speeches/17/assets/42/playback-url')).toHaveLength(2)
    expect(mock.mock.calls.some(([input]) => pathOf(input) === '/api/speeches/18/assets/42/playback-url')).toBe(false)
    await act(async () => { finish(json({ message: 'Unavailable' }, status)); await pending })
    await waitFor(() => expect(view.store.getState().speechApi.queries['getSpeech(18)']?.status).toBe('rejected'))
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    act(a.ready)
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
  })

  it('keeps B commentary off retained A until B URL and B player are ready, even with identical URLs', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let finish!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    mock.mockImplementation((input) => pathOf(input) === '/api/speeches/18/assets/84/playback-url' ? pending.then((response) => response.clone()) : original(input))
    const view = renderWatch()
    await screen.findByTestId('reviewer-preview-target')
    const a = activePlayer()
    seekPlayer(a)
    playerHarness.autoReady = false
    await act(async () => { await view.router.navigate('/speeches/18') })
    await screen.findByRole('heading', { name: 'Speech B' })
    await waitFor(() => expect(mock.mock.calls.some(([input]) => pathOf(input) === '/api/speeches/18/assets/84/playback-url')).toBe(true))
    expect(screen.getByTestId('speech-video')).toBe(a.video)
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    await act(async () => { await a.refresh() })
    expect(mock.mock.calls.some(([input]) => pathOf(input) === '/api/speeches/18/assets/42/playback-url')).toBe(false)
    await act(async () => { finish(json({ url: a.url })); await pending })
    await waitFor(() => expect(a.disposed).toBe(true))
    const b = activePlayer()
    expect(b.url).toBe(a.url)
    expect(b.video).not.toBe(a.video)
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    act(a.ready)
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    act(b.ready)
    const target = await screen.findByTestId('reviewer-preview-target')
    seekPlayer(b)
    expect(target).toHaveTextContent('Only B commentary')
    expect(target).not.toHaveTextContent('Only A commentary')
    expect(b.root).toContainElement(target)
    await act(async () => { await b.refresh() })
    expect(screen.getByTestId('reviewer-preview-target')).toBe(target)
    expect(screen.getByTestId('speech-video')).toBe(b.video)
  })

  it('returns to not-ready when the new B initial URL fails instead of retaining A playback under B', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let finish!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    mock.mockImplementation((input) => pathOf(input) === '/api/speeches/18/assets/84/playback-url'
      ? pending : original(input))
    const view = renderWatch()
    await screen.findByTestId('reviewer-preview-target')
    const a = activePlayer()
    await act(async () => { await view.router.navigate('/speeches/18') })
    await screen.findByRole('heading', { name: 'Speech B' })
    expect(screen.getByTestId('speech-video')).toBe(a.video)
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    await act(async () => { finish(json({ message: 'Cannot sign B video' }, 500)); await pending })
    await screen.findByText('Not ready to play yet.')
    expect(a.disposed).toBe(true)
    expect(screen.queryByTestId('speech-video')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    expect(mock.mock.calls.some(([input]) => pathOf(input) === '/api/speeches/18/assets/42/playback-url')).toBe(false)
  })

  it('ignores a late initial A URL completion after B has its own ready player', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let finish!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    mock.mockImplementation((input) => pathOf(input) === '/api/speeches/17/assets/42/playback-url' ? pending : original(input))
    const view = renderWatch()
    await waitFor(() => expect(mock.mock.calls.some(([input]) => pathOf(input).endsWith('/playback-url'))).toBe(true))
    await act(async () => { await view.router.navigate('/speeches/18') })
    const target = await screen.findByTestId('reviewer-preview-target')
    const b = activePlayer()
    seekPlayer(b)
    await act(async () => { finish(json({ url: 'https://example.com/late-a.mp4' })); await pending })
    expect(activePlayer()).toBe(b)
    expect(screen.getByTestId('reviewer-preview-target')).toBe(target)
    expect(target).toHaveTextContent('Only B commentary')
    expect(playerHarness.instances).toHaveLength(1)
  })

  it('rejects old ready bindings during same-asset initial source recreation and retains the editor on transient errors', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let speechFailure = false
    let failPlayback = false
    let playbackUrl = 'https://example.com/signed.mp4'
    mock.mockImplementation((input) => {
      const path = pathOf(input)
      if (path === '/api/speeches/17' && speechFailure) return Promise.resolve(json({ message: 'Temporary problem' }, 500))
      if (path.endsWith('/playback-url')) return Promise.resolve(failPlayback
        ? json({ message: 'Temporary URL problem' }, 500) : json({ url: playbackUrl }))
      return original(input)
    })
    const view = renderWatch()
    await screen.findByTestId('reviewer-preview-target')
    const a = activePlayer()
    const draft = enterDraft('Preserve me across polling')
    fireEvent.click(screen.getByRole('tab', { name: /^Voice note/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Capture test recording' }))
    const recording = screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })
    const refetch = async () => {
      await act(async () => { await view.store.dispatch(speechApi.endpoints.getSpeech.initiate(17,
        { forceRefetch: true, subscribe: false })).unwrap().catch(() => {}) })
    }
    speechFailure = true
    await refetch()
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Commentary', { selector: 'textarea' })).toBe(draft)
    expect(draft).toHaveValue('Preserve me across polling')
    speechFailure = false
    failPlayback = true
    await refetch()
    await screen.findByTestId('reviewer-preview-target')
    expect(activePlayer()).toBe(a)
    expect(draft).toHaveValue('Preserve me across polling')
    speechFailure = true
    await refetch()
    speechFailure = false
    failPlayback = false
    playbackUrl = 'https://example.com/new-generation.mp4'
    playerHarness.autoReady = false
    await refetch()
    await waitFor(() => expect(a.disposed).toBe(true))
    const replacement = activePlayer()
    expect(replacement.url).toBe(playbackUrl)
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    act(a.ready)
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    act(replacement.ready)
    const target = await screen.findByTestId('reviewer-preview-target')
    expect(replacement.root).toContainElement(target)
    expect(screen.getByLabelText('Commentary', { selector: 'textarea' })).toBe(draft)
    expect(draft).toHaveValue('Preserve me across polling')
    expect(playerHarness.instances).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })).toBe(recording)
  })

  it('preserves same-asset adapter refresh and caption anchor changes without recreating the player or draft', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    mock.mockImplementation((input) => pathOf(input) === '/api/speeches/17/captions'
      ? Promise.resolve(json({ captions: { status: 'ready', vtt: 'WEBVTT\n\n00:00.000 --> 00:04.000\nHello', asset_id: 42 } }))
      : original(input))
    const view = renderWatch()
    const target = await screen.findByTestId('reviewer-preview-target')
    const instance = activePlayer()
    const draft = enterDraft()
    await waitFor(() => expect(target.closest('[data-testid="overlay-positioner"]')).toHaveAttribute('data-anchor', 'top'))
    const track = (instance.player.remoteTextTracks() as unknown as TextTrack[])[0]
    act(() => { track.mode = 'disabled' })
    await waitFor(() => expect(target.closest('[data-testid="overlay-positioner"]')).toHaveAttribute('data-anchor', 'default'), { timeout: 1500 })
    await act(async () => { await instance.refresh() })
    expect(screen.getByTestId('reviewer-preview-target')).toBe(target)
    expect(screen.getByTestId('speech-video')).toBe(instance.video)
    expect(draft).toHaveValue('Unsent reviewer draft')
    expect(playerHarness.instances).toHaveLength(1)
    // A successful same-identity speech poll does not fetch another initial URL.
    await act(async () => { await view.store.dispatch(speechApi.endpoints.getSpeech.initiate(17,
      { forceRefetch: true, subscribe: false })).unwrap() })
    expect(playerHarness.instances).toHaveLength(1)
    expect(mock.mock.calls.filter(([input]) => pathOf(input).endsWith('/playback-url'))).toHaveLength(2)
  })

  it.each(['accepted', 'in_progress', 'published'])('permits an access-granting member reviewer (%s)', async (status) => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    mock.mockImplementation((input) => {
      if (pathOf(input) === '/api/me') return Promise.resolve(json({ ...userPayload(String(OWNER_ID)),
        user: { ...userPayload(String(OWNER_ID)).user, roles: ['member'] } }))
      if (pathOf(input) === '/api/reviews') return Promise.resolve(json({ in_progress: [{ ...reviewerReview(), status }] }))
      return original(input)
    })
    renderWatch()
    expect(await screen.findByTestId('reviewer-preview-target')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Capture test recording' })).not.toBeInTheDocument()
  })

  it.each(['revoked', 'invited', 'declined'])('does not provision a preview without an access-granting review (%s)', async (status) => {
    stubWatchFetch({ speech: speechFixture({ userId: 4242 }),
      myReviews: { in_progress: [{ ...reviewerReview(), status: status === 'revoked' ? 'in_progress' : status,
        revoked_at: status === 'revoked' ? '2026-10-22T00:00:00Z' : null }] } })
    renderWatch()
    await screen.findByTestId('speech-video')
    await waitFor(() => expect(activePlayer().disposed).toBe(false))
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    expect(screen.queryByText('Your commentary')).not.toBeInTheDocument()
  })

  it('suppresses a mounted reviewer preview when the review is removed or the current user is unresolved', async () => {
    stubReviewerFetch()
    const view = renderWatch()
    const firstTarget = await screen.findByTestId('reviewer-preview-target')
    act(() => { view.store.dispatch(reviewApi.util.updateQueryData('listMyReviews', undefined,
      (data) => { data.in_progress = [] })) })
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    expect(firstTarget.querySelector('[data-testid="overlay-stack"]')).toBeNull()
    act(() => { view.store.dispatch(reviewApi.util.updateQueryData('listMyReviews', undefined,
      (data) => { data.in_progress = [reviewerReview()] })) })
    await screen.findByTestId('reviewer-preview-target')
    act(() => { view.store.dispatch(authApi.util.resetApiState()) })
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
  })

  it.each([401, 403, 404, 410])('removes retained commentary on annotation access error %s while keeping draft text', async (status) => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    const view = renderWatch()
    const target = await screen.findByTestId('reviewer-preview-target')
    const draft = enterDraft()
    mock.mockImplementation((input) => pathOf(input) === '/api/speeches/17/annotations'
      ? Promise.resolve(json({ message: 'Unavailable' }, status)) : original(input))
    await act(async () => { await view.store.dispatch(annotationApi.endpoints.getAnnotations.initiate(
      { speechId: 17, reviewId: 501 }, { forceRefetch: true, subscribe: false })).unwrap().catch(() => {}) })
    expect(within(target).queryByTestId('overlay-stack')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(draft).toHaveValue('Unsent reviewer draft')
  })

  it('converges detached hosts under StrictMode and removes the target and nested portal on unmount', async () => {
    stubReviewerFetch()
    const view = renderWithProviders(<StrictMode><Routes>
      <Route path="/speeches/:id" element={<SpeechWatch />} />
    </Routes></StrictMode>, { route: '/speeches/17' })
    const target = await screen.findByTestId('reviewer-preview-target')
    const instance = activePlayer()
    seekPlayer(instance)
    expect(screen.getAllByTestId('reviewer-preview-target')).toHaveLength(1)
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    expect(instance.root).toContainElement(target)
    view.unmount()
    expect(instance.disposed).toBe(true)
    expect(document.querySelector('[data-testid="reviewer-preview-target"]')).toBeNull()
    expect(document.querySelector('[data-testid="overlay-stack"]')).toBeNull()
    expect(target.querySelector('[data-testid="overlay-stack"]')).toBeNull()
  })


  it('replaces the actual target within one preview identity without losing the portal to stale cleanup', async () => {
    stubReviewerFetch()
    renderWatch()
    const target = await screen.findByTestId('reviewer-preview-target')
    const instance = activePlayer()
    seekPlayer(instance)
    const draft = enterDraft()
    act(instance.replacePresentation)
    const replacement = await screen.findByTestId('reviewer-preview-target')
    expect(replacement).not.toBe(target)
    expect(target.querySelector('[data-testid="overlay-stack"]')).toBeNull()
    expect(screen.getAllByTestId('reviewer-preview-target')).toHaveLength(1)
    expect(screen.getAllByTestId('overlay-stack')).toHaveLength(1)
    expect(replacement).toHaveTextContent('Only A commentary')
    expect(instance.root).toContainElement(replacement)
    expect(screen.getByLabelText('Commentary', { selector: 'textarea' })).toBe(draft)
    expect(playerHarness.instances).toHaveLength(1)
  })

  it('retains the draft, recording and alert on transient annotation refresh failure', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    const view = renderWatch()
    const target = await screen.findByTestId('reviewer-preview-target')
    const instance = activePlayer()
    const draft = enterDraft()
    fireEvent.click(screen.getByRole('tab', { name: /^Voice note/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Capture test recording' }))
    const recording = screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })
    mock.mockImplementation((input) => pathOf(input) === '/api/speeches/17/annotations'
      ? Promise.resolve(json({ message: 'Temporary annotation error' }, 500)) : original(input))
    await act(async () => { await view.store.dispatch(annotationApi.endpoints.getAnnotations.initiate(
      { speechId: 17, reviewId: 501 }, { forceRefetch: true, subscribe: false })).unwrap().catch(() => {}) })
    expect(screen.getByRole('alert')).toHaveTextContent('Your draft is retained')
    expect(screen.getByLabelText('Commentary', { selector: 'textarea' })).toBe(draft)
    expect(draft).toHaveValue('Unsent reviewer draft')
    expect(screen.getByRole('button', { name: 'Unsaved recording: 13 bytes' })).toBe(recording)
    expect(within(target).getByTestId('overlay-stack')).toBeInTheDocument()
    expect(activePlayer()).toBe(instance)
  })


  it.each(['owner', 'viewer', 'guest'])('never provisions a reviewer target for an ineligible %s', async (identity) => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    mock.mockImplementation((input) => {
      const path = pathOf(input)
      if (identity === 'owner' && path === '/api/speeches/17') return Promise.resolve(json({ speech: speechFixture() }))
      if (identity === 'viewer' && path === '/api/reviews') return Promise.resolve(json({ in_progress: [] }))
      if (identity === 'guest' && path === '/api/me') return Promise.resolve(json({ message: 'Unauthenticated' }, 401))
      return original(input)
    })
    renderWatch()
    await screen.findByTestId('speech-video')
    await waitFor(() => expect(activePlayer().disposed).toBe(false))
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
  })

  it('waits for a resolved user before registering the ready reviewer target', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let finish!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { finish = resolve })
    mock.mockImplementation((input) => pathOf(input) === '/api/me' ? pending : original(input))
    renderWatch()
    await screen.findByTestId('speech-video')
    await screen.findByText('Your commentary')
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    await act(async () => {
      finish(json({ user: { ...userPayload(String(OWNER_ID)).user, roles: ['coach'] } }))
      await pending
    })
    expect(await screen.findByTestId('reviewer-preview-target')).toBeInTheDocument()
    expect(playerHarness.instances).toHaveLength(1)
  })


  it('waits for the new concrete ready player when B captions finish after A is disposed', async () => {
    const mock = stubReviewerFetch()
    const original = mock.getMockImplementation()!
    let finishCaptions!: (value: Response) => void
    const pendingCaptions = new Promise<Response>((resolve) => { finishCaptions = resolve })
    mock.mockImplementation((input) => pathOf(input) === '/api/speeches/18/captions'
      ? pendingCaptions : original(input))
    const view = renderWatch()
    await screen.findByTestId('reviewer-preview-target')
    const a = activePlayer()
    playerHarness.autoReady = false
    await act(async () => { await view.router.navigate('/speeches/18') })
    await waitFor(() => expect(a.disposed).toBe(true))
    const b = activePlayer()
    expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
    await act(async () => {
      finishCaptions(json({ captions: { status: 'ready', asset_id: 84,
        vtt: 'WEBVTT\n\n00:00.000 --> 00:04.000\nB subtitles' } }))
      await pendingCaptions
    })
    act(b.ready)
    const target = await screen.findByTestId('reviewer-preview-target')
    await waitFor(() => expect(target.closest('[data-testid="overlay-positioner"]')).toHaveAttribute('data-anchor', 'top'))
    expect(b.player.remoteTextTracks()).toHaveLength(1)
    expect(screen.getByTestId('speech-video')).toBe(b.video)
    expect(playerHarness.instances).toHaveLength(2)
  })

  describe('owner video tools integration', () => {
    function stubOwnerTools(mode = 'all') {
      const mock = stubWatchFetch({ speech: { ...speechFixture(), sprite }, roster: [rosterReview()] })
      const original = mock.getMockImplementation()!
      const rows = [writtenNote('owner-text', 'Owner text body'), {
        ...writtenNote('owner-voice', 'Owner voice transcript'), timing_type: 'point', start_seconds: 12,
        voice: { asset_id: 70, audio_status: 'ready', transcript_status: 'ready', failure_code: null },
      }, { ...writtenNote('owner-erased', 'Erased audio transcript'), timing_type: 'point', start_seconds: 22 }]
      mock.mockImplementation(async (input) => {
        const path = pathOf(input)
        if (path.startsWith('/api/me/preferences/commentary-playback/')) return json({
          commentary_playback: { speech_id: 17, mode, source: 'saved' },
        })
        if (path === '/api/speeches/17/annotations') return json({ review_id: 1,
          reviewer: { id: 7, name: 'Coach Seven' }, annotations: rows })
        return original(input)
      })
      return mock
    }
    async function readyTools() {
      const tabs = await screen.findByRole('tablist', { name: 'Video tools' })
      const tools = tabs.closest('.owner-video-tools') as HTMLElement
      await waitFor(() => expect(within(tools).queryByText('Loading commentary…')).not.toBeInTheDocument())
      return tools
    }
    async function refetchSpeech(view: ReturnType<typeof renderWatch>) {
      await act(async () => { await view.store.dispatch(speechApi.endpoints.getSpeech.initiate(17,
        { forceRefetch: true, subscribe: false })).unwrap().catch(() => {}) })
    }
    const markers = (tools: HTMLElement) => [...tools.querySelectorAll<HTMLButtonElement>('.awt-marker')]

    it.each(['admin', 'coach', 'member', 'guest'])('does not grant owner utilities to a non-owner %s', async (role) => {
      const mock = stubWatchFetch({ speech: speechFixture({ userId: 4242 }) })
      const original = mock.getMockImplementation()!
      mock.mockImplementation((input) => pathOf(input) === '/api/me' ? Promise.resolve(role === 'guest'
        ? json({ message: 'Unauthenticated' }, 401)
        : json({ user: { ...userPayload(String(OWNER_ID)).user, roles: [role] } })) : original(input))
      renderWatch()
      await screen.findByTestId('speech-video')
      expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Use current frame' })).not.toBeInTheDocument()
    })

    it.each([false, true])('distinguishes no selection from a successfully empty selected review (selected=%s)', async (selected) => {
      stubWatchFetch({ speech: speechFixture(), roster: selected ? [rosterReview()] : [] })
      renderWatch()
      const tools = await readyTools()
      await waitFor(() => expect(within(tools).getByText(selected
        ? 'This reviewer has no published commentary yet.'
        : 'Choose a reviewer in Notes to see their commentary.')).toBeVisible())
      expect(markers(tools)).toHaveLength(0)
    })

    it('retains its mounted utility while initial concrete readiness is pending, then enables markers and frame actions', async () => {
      stubOwnerTools()
      playerHarness.autoReady = false
      renderWatch()
      const tools = await readyTools()
      expect(markers(tools)).toHaveLength(0)
      expect(within(tools).getByText(/Preparing video. Timeline navigation/)).toBeVisible()
      fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
      const button = screen.getByRole('button', { name: 'Use current frame' })
      expect(button).toBeDisabled()
      const player = activePlayer()
      act(player.ready)
      await waitFor(() => expect(button).not.toBeDisabled())
      expect(screen.getByRole('tablist', { name: 'Video tools' }).closest('.owner-video-tools')).toBe(tools)
      expect(screen.getByRole('tab', { name: 'Frame selector' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
      await waitFor(() => expect(markers(tools)).toHaveLength(3))
    })

    it.each([403, 500])('shows unavailable rather than a successful empty review on a selected-track %s error with no authorized rows', async (status) => {
      const mock = stubOwnerTools()
      const original = mock.getMockImplementation()!
      mock.mockImplementation((input) => pathOf(input) === '/api/speeches/17/annotations'
        ? Promise.resolve(json({ message: 'Unavailable' }, status)) : original(input))
      renderWatch()
      const tools = await readyTools()
      await waitFor(() => expect(within(tools).getByText('Commentary is unavailable. Open Notes for details.')).toBeVisible())
      expect(markers(tools)).toHaveLength(0)
      expect(within(tools).queryByText(/Coach Seven/)).not.toBeInTheDocument()
      expect(within(tools).queryByText('This reviewer has no published commentary yet.')).not.toBeInTheDocument()
    })

    it('keeps the player, captions, reviewer and playback mode through independent utility and speech tabs', async () => {
      const mock = stubOwnerTools()
      const view = renderWatch()
      const tools = await readyTools()
      await waitFor(() => expect(markers(tools)).toHaveLength(3))
      const player = activePlayer()
      player.video.currentTime = 31
      const notes = screen.getByRole('tab', { name: 'Notes' })
      const mode = screen.getByRole('radio', { name: 'Text + audio' })
      const requests = mock.mock.calls.filter(([input]) => pathOf(input).endsWith('/annotations')).length
      fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
      expect(screen.getByRole('button', { name: 'Use current frame' })).toBeVisible()
      fireEvent.click(screen.getByRole('tab', { name: 'Essay' }))
      expect(screen.getByRole('tab', { name: 'Frame selector' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
      expect(activePlayer()).toBe(player)
      expect(player.video.currentTime).toBe(31)
      expect(mode).toBeChecked()
      expect(view.container.querySelectorAll('video')).toHaveLength(1)
      expect(mock.mock.calls.filter(([input]) => pathOf(input).endsWith('/annotations'))).toHaveLength(requests)
      fireEvent.click(screen.getByRole('button', { name: 'Open Notes' }))
      expect(notes).toHaveAttribute('aria-selected', 'true')
      expect(notes).toHaveFocus()
      expect(screen.getByRole('radio', { name: /Coach Seven/ })).toBeChecked()
    })

    it.each([['all', 3], ['written', 2], ['voice', 1], ['off', 0]] as const)(
      'uses the canonical %s projection without leaking other mode markers', async (mode, count) => {
        stubOwnerTools(mode)
        renderWatch()
        const tools = await readyTools()
        await waitFor(() => expect(within(tools).getByText(mode === 'off'
          ? 'Commentary is off. Open Notes to enable it.' : /Coach Seven/)).toBeInTheDocument())
        expect(markers(tools)).toHaveLength(count)
        if (mode === 'voice') expect(markers(tools)[0]).toHaveAttribute('data-kind', 'voice')
        if (mode === 'written') expect(markers(tools).some((marker) => marker.dataset.kind === 'erased-voice')).toBe(true)
        expect(within(tools).queryByText('Owner text body')).not.toBeInTheDocument()
        expect(within(tools).queryByText('Owner voice transcript')).not.toBeInTheDocument()
      })

    it('seeks once through the existing binding without a poster request or starting paused video', async () => {
      const mock = stubOwnerTools()
      renderWatch()
      const tools = await readyTools()
      await waitFor(() => expect(markers(tools)).toHaveLength(3))
      const player = activePlayer()
      const play = vi.spyOn(player.video, 'play')
      fireEvent.click(markers(tools)[0])
      expect(player.video.currentTime).toBe(2)
      expect(play).not.toHaveBeenCalled()
      expect(mock.mock.calls.some(([input]) => pathOf(input).includes('poster-frame'))).toBe(false)
    })

    it.each([200, 500])('preserves a pending frame request and its %s result through hidden tabs, failed invalidation and source recreation', async (postStatus) => {
      const mock = stubOwnerTools()
      const original = mock.getMockImplementation()!
      let finishPost!: (response: Response) => void
      const pendingPost = new Promise<Response>((resolve) => { finishPost = resolve })
      let speechFailure = false
      let playbackUrl = 'https://example.com/signed.mp4'
      mock.mockImplementation((input) => {
        const path = pathOf(input)
        if (path.endsWith('/poster-frame')) return pendingPost
        if (path === '/api/speeches/17' && speechFailure) return Promise.resolve(json({ message: 'Temporary failure' }, 500))
        if (path.endsWith('/playback-url')) return Promise.resolve(json({ url: playbackUrl }))
        return original(input)
      })
      const view = renderWatch()
      const tools = await readyTools()
      const first = activePlayer()
      first.video.currentTime = 18.75
      fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
      const button = screen.getByRole('button', { name: 'Use current frame' })
      fireEvent.click(button)
      await waitFor(() => expect(button).toHaveTextContent('Updating…'))
      fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
      expect(button).not.toBeVisible()
      speechFailure = true
      await act(async () => { finishPost(json({ asset: { id: 42 } }, postStatus)); await pendingPost })
      const message = postStatus === 200 ? 'Poster updating…' : 'Could not update poster.'
      await waitFor(() => expect(within(tools).getByText(message)).toBeInTheDocument())
      await waitFor(() => expect(speechApi.endpoints.getSpeech.select(17)(view.store.getState()).isError).toBe(true))
      expect(screen.getByRole('tablist', { name: 'Video tools' }).closest('.owner-video-tools')).toBe(tools)
      fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
      expect(screen.getByRole('button', { name: 'Use current frame' })).toBe(button)
      expect(within(tools).getByText(message)).toBeVisible()
      speechFailure = false
      playbackUrl = 'https://example.com/recreated.mp4'
      playerHarness.autoReady = false
      await refetchSpeech(view)
      await waitFor(() => expect(first.disposed).toBe(true))
      expect(screen.getByRole('tab', { name: 'Frame selector' })).toHaveAttribute('aria-selected', 'true')
      expect(button).toBeDisabled()
      expect(within(tools).getByText(message)).toBeVisible()
      fireEvent.click(button)
      expect(mock.mock.calls.filter(([input]) => pathOf(input).endsWith('/poster-frame'))).toHaveLength(1)
      const replacement = activePlayer()
      act(first.ready)
      expect(button).toBeDisabled()
      act(replacement.ready)
      await waitFor(() => expect(button).not.toBeDisabled())
      expect(screen.getByRole('button', { name: 'Use current frame' })).toBe(button)
      const requests = mock.mock.calls.filter(([input]) => pathOf(input).endsWith('/poster-frame'))
      expect(requests).toHaveLength(1)
      expect(pathOf(requests[0][0])).toBe('/api/speeches/17/assets/42/poster-frame')
      expect(await (requests[0][0] as Request).clone().json()).toEqual({ time_seconds: 18.75 })
    })

    it('reads the current player time after returning to frames and never seeks for sprite selection', async () => {
      const mock = stubOwnerTools()
      const original = mock.getMockImplementation()!
      const times: number[] = []
      mock.mockImplementation(async (input) => {
        if (pathOf(input).endsWith('/poster-frame')) {
          const request = input as Request
          const body = await request.clone().json()
          times.push(body.time_seconds)
          return json({ asset: { id: 42 } })
        }
        return original(input)
      })
      renderWatch()
      await readyTools()
      const player = activePlayer()
      player.video.currentTime = 5
      fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
      fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
      player.video.currentTime = 26.25
      fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
      fireEvent.click(screen.getByRole('button', { name: 'Use current frame' }))
      await waitFor(() => expect(times).toEqual([26.25]))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Use frame at 30.0s' })).not.toBeDisabled())
      fireEvent.click(screen.getByRole('button', { name: 'Use frame at 30.0s' }))
      await waitFor(() => expect(times).toEqual([26.25, 30]))
      expect(player.video.currentTime).toBe(26.25)
    })

    it.each([401, 403, 404, 410])('invalidates a retained owner speech scope after %s and requires successful resolution before restoring tools', async (status) => {
      const mock = stubOwnerTools()
      const original = mock.getMockImplementation()!
      const view = renderWatch()
      await readyTools()
      let speechStatus = status
      mock.mockImplementation((input) => pathOf(input) === '/api/speeches/17'
        ? Promise.resolve(json({ message: 'Unavailable' }, speechStatus)) : original(input))
      await refetchSpeech(view)
      expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
      speechStatus = 500
      await refetchSpeech(view)
      expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
      mock.mockImplementation(original)
      await refetchSpeech(view)
      await readyTools()
      expect(screen.getByRole('tab', { name: 'Commentary timeline' })).toHaveAttribute('aria-selected', 'true')
    })

    it.each([401, 403, 404, 410])('suppresses owner tools on retained getMe %s and cannot revive them on a later 500', async (status) => {
      const mock = stubOwnerTools()
      const original = mock.getMockImplementation()!
      const view = renderWatch()
      await readyTools()
      let authStatus = status
      mock.mockImplementation((input) => pathOf(input) === '/api/me'
        ? Promise.resolve(json({ message: 'Unavailable' }, authStatus)) : original(input))
      const refetchMe = async () => {
        await act(async () => { await view.store.dispatch(authApi.endpoints.getMe.initiate(undefined,
          { forceRefetch: true, subscribe: false })).unwrap().catch(() => {}) })
      }
      await refetchMe()
      expect(authApi.endpoints.getMe.select()(view.store.getState()).data?.user.id).toBe(String(OWNER_ID))
      expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
      authStatus = 500
      await refetchMe()
      expect(screen.queryByRole('tablist', { name: 'Video tools' })).not.toBeInTheDocument()
      mock.mockImplementation(original)
      await refetchMe()
      await readyTools()
    })

    it('retains an already validated owner utility during a nonterminal authentication refresh error', async () => {
      const mock = stubOwnerTools()
      const original = mock.getMockImplementation()!
      const view = renderWatch()
      const tools = await readyTools()
      fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
      mock.mockImplementation((input) => pathOf(input) === '/api/me'
        ? Promise.resolve(json({ message: 'Temporary auth failure' }, 500)) : original(input))
      await act(async () => { await view.store.dispatch(authApi.endpoints.getMe.initiate(undefined,
        { forceRefetch: true, subscribe: false })).unwrap().catch(() => {}) })
      expect(screen.getByRole('tablist', { name: 'Video tools' }).closest('.owner-video-tools')).toBe(tools)
      expect(screen.getByRole('tab', { name: 'Frame selector' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('button', { name: 'Use current frame' })).not.toBeDisabled()
    })
  })

  describe('outer reviewer tab guard', () => {
    it('passes authoringActive true on Notes and false once Essay or Transcript is selected', async () => {
      stubReviewerFetch()
      const user = userEvent.setup()
      renderWatch()
      await screen.findByText('Your commentary')
      expect(latestPanel().authoringActive).toBe(true)
      await user.click(screen.getByRole('tab', { name: 'Essay' }))
      expect(latestPanel().authoringActive).toBe(false)
      await user.click(screen.getByRole('tab', { name: 'Notes' }))
      expect(latestPanel().authoringActive).toBe(true)
      await user.click(screen.getByRole('tab', { name: 'Transcript' }))
      expect(latestPanel().authoringActive).toBe(false)
    })

    it('stays authoringActive on Notes even while the preview target is unavailable', async () => {
      playerHarness.autoReady = false
      stubReviewerFetch()
      renderWatch()
      await screen.findByText('Your commentary')
      expect(screen.queryByTestId('reviewer-preview-target')).not.toBeInTheDocument()
      expect(latestPanel().authoringActive).toBe(true)
    })

    it('disables sibling tabs and ignores leaving Notes while recording, then re-enables', async () => {
      stubReviewerFetch()
      const user = userEvent.setup()
      renderWatch()
      await screen.findByText('Your commentary')
      expect(screen.queryByText('Stop recording before switching tabs.')).not.toBeInTheDocument()
      act(() => latestPanel().onRecordingLockChange?.(true))
      expect(screen.getByText('Stop recording before switching tabs.')).toBeVisible()
      const essay = screen.getByRole('tab', { name: 'Essay' })
      const transcript = screen.getByRole('tab', { name: 'Transcript' })
      expect(essay).toHaveAttribute('aria-disabled', 'true')
      expect(transcript).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('tab', { name: 'Notes' })).not.toHaveAttribute('aria-disabled', 'true')
      await user.click(essay)
      await user.click(transcript)
      screen.getByRole('tab', { name: 'Notes' }).focus()
      await user.keyboard('{ArrowRight}{Enter}{End}{Enter}')
      expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
      expect(latestPanel().authoringActive).toBe(true)
      act(() => latestPanel().onRecordingLockChange?.(false))
      expect(screen.queryByText('Stop recording before switching tabs.')).not.toBeInTheDocument()
      expect(essay).not.toHaveAttribute('aria-disabled', 'true')
      await user.click(essay)
      expect(essay).toHaveAttribute('aria-selected', 'true')
    })

    it('does not leak a retained lock into another speech/review session', async () => {
      stubReviewerFetch()
      const user = userEvent.setup()
      const view = renderWatch()
      await screen.findByText('Your commentary')
      const staleCallback = latestPanel().onRecordingLockChange!
      act(() => staleCallback(true))
      expect(screen.getByRole('tab', { name: 'Essay' })).toHaveAttribute('aria-disabled', 'true')
      await act(async () => { await view.router.navigate('/speeches/18') })
      await screen.findByRole('heading', { name: 'Speech B' })
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Essay' })).not.toHaveAttribute('aria-disabled', 'true'))
      expect(screen.queryByText('Stop recording before switching tabs.')).not.toBeInTheDocument()
      // A late report from the old session must not affect the new one.
      act(() => staleCallback(true))
      expect(screen.getByRole('tab', { name: 'Essay' })).not.toHaveAttribute('aria-disabled', 'true')
      await user.click(screen.getByRole('tab', { name: 'Essay' }))
      expect(screen.getByRole('tab', { name: 'Essay' })).toHaveAttribute('aria-selected', 'true')
    })

    it('leaves owner tabs unaffected and mounts no reviewer panel', async () => {
      stubWatchFetch({ speech: speechFixture() })
      const user = userEvent.setup()
      renderWatch()
      await screen.findByRole('tablist', { name: 'Speech tools' })
      expect(panelSpy.props).toHaveLength(0)
      expect(screen.queryByText('Stop recording before switching tabs.')).not.toBeInTheDocument()
      await user.click(screen.getByRole('tab', { name: 'Essay' }))
      expect(screen.getByRole('tab', { name: 'Essay' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: 'Transcript' })).not.toHaveAttribute('aria-disabled', 'true')
    })
  })

})
