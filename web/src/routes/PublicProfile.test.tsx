import { Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import PublicProfile from '@/routes/PublicProfile'
import ProfileAbout from '@/routes/ProfileAbout'
import ProfileFriends from '@/routes/ProfileFriends'
import ProfileReviewsLeft from '@/routes/ProfileReviewsLeft'
import ProfileReviewsReceived from '@/routes/ProfileReviewsReceived'
import NotFound from '@/routes/NotFound'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import { authApi } from '@/features/auth/authApi'
import type { MeResponse } from '@/features/auth/types'
import type { PublicProfile as Profile } from '@/features/profile/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/** Mirrors `App.tsx`'s real nesting (`PublicProfile` + its three child
 * routes) — every test renders this, not a bare `<PublicProfile />>`,
 * because the identity block/nav render from the parent while the tab
 * content comes from the matched child via `<Outlet>`. */
function renderProfileApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/u/:username" element={<PublicProfile />}>
        <Route index element={<ProfileAbout />} />
        <Route path="reviews-left" element={<ProfileReviewsLeft />} />
        <Route path="reviews-received" element={<ProfileReviewsReceived />} />
        <Route path="friends" element={<ProfileFriends />} />
        <Route path="friends/:view" element={<ProfileFriends />} />
      </Route>
      <Route path="/login" element={<p>Sign in page</p>} />
      <Route path="*" element={<NotFound />} />
    </Routes>,
    { route },
  )
}

const emptyFriends = { friends: [], meta: { total: 0, next_cursor: null } }
const emptyTimeline = { timeline: [], meta: { next_cursor: null, tab: 'left', profile_username: 'jordan' } }

describe('PublicProfile', () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the identity block (avatar/name/username) with no bio leaking into the header', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/marscheung/timeline')) return jsonResponse(emptyTimeline)
      if (url.includes('/api/u/marscheung')) {
        return jsonResponse({
          profile: {
            username: 'marscheung',
            display_name: 'Mars Cheung',
            pronouns: null,
            bio: 'Toastmaster and reviewer.',
            location: null,
            avatar_url: null,
          },
        })
      }
      if (url.includes('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.includes('/api/friends')) return jsonResponse(emptyFriends)
      // Anonymous by default: `PublicProfile` probes the session to decide
      // whether to render the "Back to dashboard" link, and D5 requires the
      // page to work fine without one. The two cases below cover both sides.
      if (url.includes('/api/me')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/marscheung')

    expect(await screen.findByText('Mars Cheung')).toBeInTheDocument()
    expect(screen.getByText('@marscheung')).toBeInTheDocument()
    // The bio lives on the About tab's content, not the identity header —
    // it's still reachable (index route), but should only appear once.
    expect(await screen.findByText('Toastmaster and reviewer.')).toBeInTheDocument()
  })

  it('renders a Coach badge when the profile credential is coach', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/coachy/timeline')) return jsonResponse(emptyTimeline)
      if (url.includes('/api/u/coachy')) {
        return jsonResponse({
          profile: {
            username: 'coachy',
            display_name: 'Coach Y',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
            credential: 'coach',
          },
        })
      }
      if (url.includes('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.includes('/api/friends')) return jsonResponse(emptyFriends)
      // Anonymous by default: `PublicProfile` probes the session to decide
      // whether to render the "Back to dashboard" link, and D5 requires the
      // page to work fine without one. The two cases below cover both sides.
      if (url.includes('/api/me')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/coachy')

    expect(await screen.findByText('Coach Y')).toBeInTheDocument()
    expect(screen.getByText('Coach')).toBeInTheDocument()
  })

  it('renders no badge for a plain member', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/marscheung/timeline')) return jsonResponse(emptyTimeline)
      if (url.includes('/api/u/marscheung')) {
        return jsonResponse({
          profile: {
            username: 'marscheung',
            display_name: 'Mars Cheung',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
          },
        })
      }
      if (url.includes('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.includes('/api/friends')) return jsonResponse(emptyFriends)
      // Anonymous by default: `PublicProfile` probes the session to decide
      // whether to render the "Back to dashboard" link, and D5 requires the
      // page to work fine without one. The two cases below cover both sides.
      if (url.includes('/api/me')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/marscheung')

    expect(await screen.findByText('Mars Cheung')).toBeInTheDocument()
    expect(screen.queryByText('Coach')).not.toBeInTheDocument()
  })

  it('shows the not-found page rather than crashing when the username does not exist', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/nobody')) {
        return jsonResponse({ message: 'No such user.' }, 404)
      }
      // Anonymous by default: `PublicProfile` probes the session to decide
      // whether to render the "Back to dashboard" link, and D5 requires the
      // page to work fine without one. The two cases below cover both sides.
      if (url.includes('/api/me')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/nobody')

    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })

  it('renders a real routed <nav> with links, not a tablist widget', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/marscheung/timeline')) return jsonResponse(emptyTimeline)
      if (url.includes('/api/u/marscheung')) {
        return jsonResponse({
          profile: {
            username: 'marscheung',
            display_name: 'Mars Cheung',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
          },
        })
      }
      if (url.includes('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.includes('/api/friends')) return jsonResponse(emptyFriends)
      // Anonymous by default: `PublicProfile` probes the session to decide
      // whether to render the "Back to dashboard" link, and D5 requires the
      // page to work fine without one. The two cases below cover both sides.
      if (url.includes('/api/me')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/marscheung')

    await screen.findByText('Mars Cheung')
    const nav = screen.getByRole('navigation', { name: /profile sections/i })
    expect(within(nav).queryByRole('tablist')).not.toBeInTheDocument()
    const links = within(nav).getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/u/marscheung/reviews-left',
      '/u/marscheung/reviews-received',
      '/u/marscheung',
    ])
  })

  it('shows the exact empty-state copy — never a bare "No results" — when the timeline has zero items', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/jordan/timeline')) return jsonResponse(emptyTimeline)
      if (url.includes('/api/u/jordan')) {
        return jsonResponse({
          profile: {
            username: 'jordan',
            display_name: 'Jordan Ellis',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
          },
        })
      }
      if (url.includes('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.includes('/api/friends')) return jsonResponse(emptyFriends)
      // Anonymous by default: `PublicProfile` probes the session to decide
      // whether to render the "Back to dashboard" link, and D5 requires the
      // page to work fine without one. The two cases below cover both sides.
      if (url.includes('/api/me')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/jordan/reviews-left')

    expect(await screen.findByText('Your history with Jordan')).toBeInTheDocument()
    expect(await screen.findByText('No shared reviews yet')).toBeInTheDocument()
    expect(screen.queryByText(/^No results\.?$/i)).not.toBeInTheDocument()
  })

  it('renders a timeline card with the exact privacy indicator, commentary block, and a single primary link', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/jordan/timeline')) {
        return jsonResponse({
          timeline: [
            {
              review_id: 501,
              status: 'published',
              last_transition_at: '2026-03-14T00:00:00Z',
              commentary: { notes_count: 12, has_essay: true },
              speech: {
                id: 77,
                ulid: 'speech-ulid-77',
                title: 'Opening Remarks — District Final',
                delivered_on: '2026-03-12T00:00:00Z',
                duration_seconds: '494',
              },
              poster: null,
              arc: null,
            },
          ],
          meta: { next_cursor: null, tab: 'left', profile_username: 'jordan' },
        })
      }
      if (url.includes('/api/u/jordan')) {
        return jsonResponse({
          profile: {
            username: 'jordan',
            display_name: 'Jordan Ellis',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
          },
        })
      }
      if (url.includes('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.includes('/api/friends')) return jsonResponse(emptyFriends)
      // Anonymous by default: `PublicProfile` probes the session to decide
      // whether to render the "Back to dashboard" link, and D5 requires the
      // page to work fine without one. The two cases below cover both sides.
      if (url.includes('/api/me')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/jordan/reviews-left')

    expect(await screen.findByText('Opening Remarks — District Final')).toBeInTheDocument()
    expect(screen.getByText('🔒 Private · visible to you because you reviewed it')).toBeInTheDocument()
    expect(screen.getByText('12 notes · essay')).toBeInTheDocument()

    const primaryLink = screen.getByRole('link', { name: /watch with your commentary/i })
    expect(primaryLink).toHaveAttribute('href', '/speeches/77')
    // One primary link per card — not a second link to the same
    // destination off the poster/title (§6.7.4's accessibility rule).
    expect(screen.getAllByRole('link', { name: /watch with your commentary/i })).toHaveLength(1)
  })
  /**
   * `/u/:username` is registered outside `AppLayout` (it must render for
   * anonymous visitors, D5), so it has no header and no sidebar — a
   * signed-in viewer who lands here otherwise has no way back into the app
   * but the browser's back button.
   */
  it('gives a signed-in viewer a link back to the dashboard', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/me')) {
        return jsonResponse({
          user: {
            id: '1',
            email: 'mars@example.com',
            first_name: 'Mars',
            last_name: 'Cheung',
            username: 'marscheung',
            display_name: 'Mars Cheung',
            email_verified: true,
            roles: [],
            onboarding_completed: true,
            onboarding_step: 4,
          },
        })
      }
      if (url.includes('/api/u/jordan/timeline')) return jsonResponse(emptyTimeline)
      if (url.includes('/api/u/jordan')) {
        return jsonResponse({
          profile: {
            username: 'jordan',
            display_name: 'Jordan Reyes',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
          },
        })
      }
      if (url.includes('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.includes('/api/friends')) return jsonResponse(emptyFriends)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/jordan')

    const back = await screen.findByRole('link', { name: /back to dashboard/i })
    expect(back).toHaveAttribute('href', '/dashboard')

    // It must NOT live in the profile-sections landmark, which is the
    // three tab routes and nothing else.
    const nav = screen.getByRole('navigation', { name: /profile sections/i })
    expect(within(nav).queryByRole('link', { name: /back to dashboard/i })).not.toBeInTheDocument()
    expect(within(nav).getAllByRole('link')).toHaveLength(3)
  })

  /** D5 again: the back link points into an authenticated area, so an
   * anonymous visitor must not be offered it. */
  it('does not show the back link to an anonymous visitor', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/me')) return jsonResponse({ message: 'Unauthenticated.' }, 401)
      if (url.includes('/api/u/jordan/timeline')) return jsonResponse(emptyTimeline)
      if (url.includes('/api/u/jordan')) {
        return jsonResponse({
          profile: {
            username: 'jordan',
            display_name: 'Jordan Reyes',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
          },
        })
      }
      if (url.includes('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.includes('/api/friends')) return jsonResponse(emptyFriends)
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/jordan')

    expect(await screen.findByText('Jordan Reyes')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /back to dashboard/i })).not.toBeInTheDocument()
  })
})

describe('profile connection eligibility', () => {
  const cora: Profile = { id: 9003, username: 'e2e-coach', display_name: 'Cora Coach', pronouns: null,
    bio: null, location: null, avatar_url: null, credential: 'coach' }
  const milo: Profile = { ...cora, id: 9004, username: 'e2e-member', display_name: 'Milo Member', credential: 'member' }
  function identity(target: Profile): MeResponse {
    return { user: { id: String(target.id), username: target.username, display_name: target.display_name!,
      email: target.username+'@e2e.test', first_name: null, last_name: null, roles: ['member'],
      email_verified: true, onboarding_completed: true, onboarding_step: 4,
      storage_bytes_used: 0, quota_bytes: 1024, uploads_in_flight: 0 } }
  }
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
  }
  function mockConnectionApi(me: () => Response | Promise<Response>) {
    const writes: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input.toString())
      const url = new URL(request.url)
      if (url.pathname === '/api/me') return me()
      if (url.pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
      if (request.method === 'POST' && url.pathname === '/api/connections') {
        writes.push({ url: url.pathname, body: await request.clone().json() })
        return jsonResponse({ connection: { id: 1, state: 'pending' } }, 201)
      }
      if (url.pathname.startsWith('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.pathname === '/api/friends') return jsonResponse(emptyFriends)
      const target = [cora, milo].find((p) => url.pathname === '/api/u/'+p.username)
      if (target) return jsonResponse({ profile: target })
      throw new Error('Unexpected profile request: '+url.pathname)
    }))
    return writes
  }

  beforeEach(clearCookies)
  afterEach(() => { vi.unstubAllGlobals(); clearCookies() })

  it('never offers Connect on the viewer own profile, comparing string session IDs with numeric profile IDs', async () => {
    const writes = mockConnectionApi(() => jsonResponse(identity(cora)))
    renderProfileApp('/u/e2e-coach')
    await screen.findByRole('link', { name: /back to dashboard/i })
    expect(await screen.findByRole('heading', { name: 'Cora Coach' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('uses immutable user IDs to recognize the owner even when the session username is stale', async () => {
    const me = identity(cora)
    me.user.username = 'old-coach-handle'
    mockConnectionApi(() => jsonResponse(me))
    renderProfileApp('/u/e2e-coach')
    await screen.findByRole('link', { name: /back to dashboard/i })
    await screen.findByRole('heading', { name: 'Cora Coach' })
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  })

  it('still lets a different signed-in user send a request to the viewed profile', async () => {
    const user = userEvent.setup()
    const writes = mockConnectionApi(() => jsonResponse(identity(milo)))
    renderProfileApp('/u/e2e-coach')
    await user.click(await screen.findByRole('button', { name: 'Connect' }))
    await user.type(screen.getByPlaceholderText('Say hello…'), 'Let us practice together.')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(writes).toEqual([{ url: '/api/connections', body: { user_id: 9003, note: 'Let us practice together.' } }]))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Send a connection request' })).not.toBeInTheDocument())
  })

  it('does not flash Connect while the viewer identity is still loading', async () => {
    const pending = deferred<Response>()
    const writes = mockConnectionApi(() => pending.promise)
    renderProfileApp('/u/e2e-coach')
    await screen.findByRole('heading', { name: 'Cora Coach' })
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    await act(async () => { pending.resolve(jsonResponse(identity(cora))); await pending.promise })
    await screen.findByRole('link', { name: /back to dashboard/i })
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('keeps the public profile readable without connection actions for anonymous visitors', async () => {
    mockConnectionApi(() => jsonResponse({ message: 'Unauthenticated.' }, 401))
    const { store } = renderProfileApp('/u/e2e-coach')
    await screen.findByRole('heading', { name: 'Cora Coach' })
    await waitFor(() => expect(authApi.endpoints.getMe.select()(store.getState()).status).toBe('rejected'))
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Profile sections' })).toBeVisible()
  })

  it('closes an open request while auth refresh is unresolved, then keeps it absent for the owner', async () => {
    const user = userEvent.setup(), pending = deferred<Response>()
    let calls = 0
    const writes = mockConnectionApi(() => ++calls === 1 ? jsonResponse(identity(milo)) : pending.promise)
    const { store } = renderProfileApp('/u/e2e-coach')
    await user.click(await screen.findByRole('button', { name: 'Connect' }))
    await user.type(screen.getByPlaceholderText('Say hello…'), 'A draft for a different viewer.')
    let refresh!: Promise<unknown>
    act(() => { refresh = store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false, forceRefetch: true })) })
    await waitFor(() => expect(authApi.endpoints.getMe.select()(store.getState()).status).toBe('pending'))
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument()
    await act(async () => { pending.resolve(jsonResponse(identity(cora))); await refresh })
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('removes the request form when navigating from another person to the viewer own profile', async () => {
    const user = userEvent.setup()
    const writes = mockConnectionApi(() => jsonResponse(identity(milo)))
    const { router } = renderProfileApp('/u/e2e-coach')
    await user.click(await screen.findByRole('button', { name: 'Connect' }))
    await user.type(screen.getByPlaceholderText('Say hello…'), 'A draft for Cora.')
    await act(async () => { await router.navigate('/u/e2e-member') })
    await screen.findByRole('heading', { name: 'Milo Member' })
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })
})

describe('Friends integration with public profile routing', () => {
  const profile = { id: 9, username: 'owner', display_name: 'Profile Owner', avatar_url: null }
  function setup(route = '/u/owner', user: unknown = { id: '9', username: 'owner', roles: [] }, status = 200) {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname === '/api/me') return jsonResponse({ user }, status)
      if (url.pathname.startsWith('/api/u/')) return jsonResponse({ profile })
      if (url.pathname.startsWith('/api/friends/relationship/')) return jsonResponse({ relationship: { state: 'none', direction: null, connection_id: null, connected_at: null } })
      if (url.pathname === '/api/friends') return jsonResponse(emptyFriends)
      throw new Error('Unexpected integration request: '+url)
    })
    vi.stubGlobal('fetch', fetch)
    return { ...renderProfileApp(route), fetch }
  }
  afterEach(() => vi.unstubAllGlobals())
  it('adds the fourth real Friends link only for the matching canonical owner', async () => {
    setup()
    const friends = await screen.findByRole('link', { name: 'Friends' })
    expect(friends).toHaveAttribute('href', '/u/owner/friends')
    const nav = screen.getByRole('navigation', { name: 'Profile sections' })
    expect(within(nav).getAllByRole('link')).toHaveLength(4)
    expect(within(nav).queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  })
  it.each([
    ['nonowner', { id: '10', username: 'another', roles: [] }],
    ['stale canonical username', { id: '9', username: 'old-handle', roles: [] }],
    ['admin owner', { id: '9', username: 'owner', roles: ['member', 'admin'] }],
    ['superadmin owner', { id: '9', username: 'owner', roles: ['super_admin'] }],
  ])('preserves the original three section links for a %s', async (_label, user) => {
    const { store } = setup('/u/owner', user)
    await waitFor(() => expect(store.getState().connectionSession.status).toBe('ready'))
    await screen.findByRole('heading', { name: 'Profile Owner' })
    expect(within(screen.getByRole('navigation', { name: 'Profile sections' })).getAllByRole('link')).toHaveLength(3)
  })
  it.each(['friends', 'friends/all', 'friends/requests', 'friends/find'])('renders the owner %s family across the full width without a duplicate rail', async (path) => {
    const { router } = setup('/u/owner/'+path)
    await screen.findByRole('navigation', { name: 'Friends sections' })
    if (path === 'friends') await waitFor(() => expect(router.state.location.pathname).toBe('/u/owner/friends/all'))
    expect(screen.queryByRole('complementary', { name: 'Your connections' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Friends' }).parentElement?.parentElement).not.toHaveClass('grid')
    expect(screen.getByRole('link', { name: /Back to dashboard/ })).toHaveAttribute('href', '/dashboard')
  })
  it('makes no private query on a nonowner direct Friends visit', async () => {
    const { fetch } = setup('/u/owner/friends/requests', { id: '10', username: 'another', roles: [] })
    expect(await screen.findByRole('alert')).toHaveTextContent('Friends are unavailable for this profile.')
    expect(fetch.mock.calls.some(([input]) => (input instanceof Request ? input.url : input.toString()).includes('/api/friends'))).toBe(false)
  })
  it('takes anonymous direct Friends visits to login with their return destination', async () => {
    const { router, fetch } = setup('/u/owner/friends/find', null, 401)
    await screen.findByText('Sign in page')
    expect(router.state.location.state.from.pathname).toBe('/u/owner/friends/find')
    expect(fetch.mock.calls.some(([input]) => (input instanceof Request ? input.url : input.toString()).includes('/api/friends'))).toBe(false)
  })
  it('rejects mismatched canonical profile usernames instead of displaying cached owner data', async () => {
    setup('/u/renamed-person/friends/all')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Profile Owner' })).not.toBeInTheDocument()
  })
})
