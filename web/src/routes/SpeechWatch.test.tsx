import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type Player from 'video.js/dist/types/player'
import { Routes, Route } from 'react-router-dom'
import SpeechWatch, { PosterFramePicker, OverlayPositioner } from '@/routes/SpeechWatch'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import type { SpeechSprite } from '@/features/speech/types'

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
  return { currentTime: () => currentTime } as unknown as Player
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
   * `/api/speeches/17/reviews` (the owner's commentary tracks). A loose
   * substring match hands one endpoint's payload to another endpoint's
   * `transformResponse`, which fails as a crash rather than as an
   * assertion. */
  function pathOf(input: RequestInfo | URL): string {
    const raw = input instanceof Request ? input.url : input.toString()
    return new URL(raw, 'http://localhost').pathname
  }

  function stubWatchFetch({
    speech,
    reviewers = [],
    myReviews = {},
  }: {
    speech: unknown
    reviewers?: unknown[]
    myReviews?: unknown
  }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input)
      if (path.startsWith('/api/me/preferences/voice-commentary/')) {
        return json({ voice_commentary: { speech_id: 17, mode: 'play', experienced: true } })
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
      if (path === '/api/speeches/17/reviews') return json({ reviews: [] })
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
      <Routes>
        <Route path="/speeches/:id" element={<SpeechWatch />} />
      </Routes>,
      { route: '/speeches/17' },
    )
  }

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
    expect(screen.getByText(/not ready to play yet/i)).toBeInTheDocument()

    const tab = await screen.findByRole('tab', { name: 'Reviewers' })
    await user.click(tab)
    expect(await screen.findByLabelText('Search the reviewer directory')).toBeVisible()
  })
})
