import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import PublicProfile from '@/routes/PublicProfile'
import ProfileAbout from '@/routes/ProfileAbout'
import ProfileReviewsLeft from '@/routes/ProfileReviewsLeft'
import ProfileReviewsReceived from '@/routes/ProfileReviewsReceived'
import NotFound from '@/routes/NotFound'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

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
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>,
    { route },
  )
}

const emptyRail = { connections: [], meta: { next_cursor: null } }
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
      if (url.includes('/api/connections')) return jsonResponse(emptyRail)
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
      if (url.includes('/api/connections')) return jsonResponse(emptyRail)
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
      if (url.includes('/api/connections')) return jsonResponse(emptyRail)
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
      if (url.includes('/api/connections')) return jsonResponse(emptyRail)
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

  it('renders the connections rail with the metric line for an accepted connection', async () => {
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
      if (url.includes('/api/connections')) {
        return jsonResponse({
          connections: [
            {
              id: 1,
              state: 'accepted',
              initiated_by_id: 1,
              note: null,
              requested_at: '2026-02-01T00:00:00Z',
              responded_at: '2026-03-01T00:00:00Z',
              connected_at: '2026-03-01T00:00:00Z',
              peer: { id: 9, username: 'ada', name: 'Ada L.', avatar_url: null },
              metric: '6 reviews together',
            },
          ],
          meta: { next_cursor: null },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderProfileApp('/u/jordan')

    expect(await screen.findByText('Ada L.')).toBeInTheDocument()
    expect(screen.getByText('6 reviews together')).toBeInTheDocument()
    expect(screen.getByText('1 connection')).toBeInTheDocument()
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
      if (url.includes('/api/connections')) return jsonResponse(emptyRail)
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
      if (url.includes('/api/connections')) return jsonResponse(emptyRail)
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
})
