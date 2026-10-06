import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import Dashboard from '@/routes/Dashboard'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import type { Review } from '@/features/review/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/** A `GET /api/reviews` row, trimmed to the fields `ReviewCard` reads. */
function review(overrides: Partial<Review> = {}): Review {
  return {
    id: 1,
    status: 'accepted',
    invitation_message: null,
    allow_preview: false,
    prior_commentary_shared: false,
    invited_at: '2026-09-01T10:00:00Z',
    responded_at: '2026-09-02T10:00:00Z',
    first_published_at: null,
    last_published_at: null,
    last_transition_at: '2026-09-02T10:00:00Z',
    revoked_at: null,
    revocation_reason: null,
    speech: { id: 42, ulid: '01ABCDEF', title: 'A Reviewed Speech', owner_name: 'Milo Member' },
    ...overrides,
  }
}

/** `Dashboard` reads `/api/me` for the username and roles behind the
 * "Your profile & connections" link, so every case has to stub it —
 * this mock throws on anything it doesn't recognise. */
function meResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
      ...overrides,
    },
  }
}

function stubReviews(
  sections: {
    invited?: Review[]
    in_progress?: Review[]
    published?: Review[]
    revoked?: Review[]
  },
  me: ReturnType<typeof meResponse> = meResponse(),
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.includes('/api/me')) return jsonResponse(me)
    if (url.includes('/api/reviews')) {
      return jsonResponse({
        invited: sections.invited ?? [],
        in_progress: sections.in_progress ?? [],
        published: sections.published ?? [],
        revoked: sections.revoked ?? [],
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * PLAN-ACCESS-DENIED-STATES.md §4/§5.2. This route had no test file at all
 * before now, which is how it shipped with no link to the speech: the id was
 * in the payload the whole time and simply never rendered, leaving a coach
 * who accepted an invitation with no way to reach the speech but to type the
 * URL by hand.
 */
describe('Dashboard', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('links an in-progress review to its speech', async () => {
    stubReviews({ in_progress: [review()] })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    const link = await screen.findByRole('link', { name: /watch/i })
    expect(link).toHaveAttribute('href', '/speeches/42')
  })

  it('links a published review to its speech too, so the work stays reachable after publishing', async () => {
    stubReviews({ published: [review({ status: 'published', last_published_at: '2026-09-03T10:00:00Z' })] })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByRole('link', { name: /watch/i })).toHaveAttribute('href', '/speeches/42')
  })

  it('offers no link on a revoked review, and explains instead of leading to a refusal', async () => {
    stubReviews({
      revoked: [review({ status: 'published', revoked_at: '2026-09-04T10:00:00Z' })],
    })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByText(/isn’t available to open/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /watch/i })).not.toBeInTheDocument()
  })

  it('renders neither a link nor a crash when the speech relation was not loaded', async () => {
    // `speech` is optional on the resource (`whenLoaded`), so the `?.id`
    // guard has to hold rather than throwing on a missing relation.
    stubReviews({ in_progress: [review({ speech: undefined })] })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByText('Untitled speech')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /watch/i })).not.toBeInTheDocument()
  })

  it('leaves invitations without a link, since accepting is what grants access', async () => {
    stubReviews({ invited: [review({ status: 'invited', responded_at: null })] })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByRole('button', { name: /accept/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /watch/i })).not.toBeInTheDocument()
  })
  /**
   * Before this link existed, the onboarding "all set" card was the ONLY
   * in-app navigation to `/u/:username` anywhere — so removing that card
   * without this would have left the whole social layer reachable only by
   * typing a URL.
   */
  it('links to the social profile page', async () => {
    stubReviews({})
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    const link = await screen.findByRole('link', { name: /your profile & connections/i })
    expect(link).toHaveAttribute('href', '/u/marscheung')
  })

  /** `roles: []` is the normal state for a self-registered user — the
   * case that actually matters in production. */
  it('shows the profile link to a coach and to a roleless user', async () => {
    stubReviews({}, meResponse({ roles: ['coach'], username: 'e2e-coach' }))
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByRole('link', { name: /your profile & connections/i })).toHaveAttribute(
      'href',
      '/u/e2e-coach',
    )
  })

  it('hides the profile link from an admin and a super_admin', async () => {
    stubReviews({}, meResponse({ roles: ['admin'], username: 'e2e-admin' }))
    const { unmount } = renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByRole('heading', { name: 'My reviews' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /your profile & connections/i })).not.toBeInTheDocument()
    unmount()

    stubReviews({}, meResponse({ roles: ['super_admin'], username: 'e2e-super-admin' }))
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByRole('heading', { name: 'My reviews' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /your profile & connections/i })).not.toBeInTheDocument()
  })

  /** Post-verification lands on `/login?verified=1`, which forwards an
   * already-onboarded user here — the confirmation has to survive that
   * hop or verifying looks like a no-op. */
  it('shows the email-verified banner when ?verified=1 is present', async () => {
    stubReviews({})
    renderWithProviders(<Dashboard />, { route: '/dashboard?verified=1' })

    expect(await screen.findByText('Email verified.')).toBeInTheDocument()
  })

  it('shows no banner without the query param', async () => {
    stubReviews({})
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByRole('heading', { name: 'My reviews' })).toBeInTheDocument()
    expect(screen.queryByText('Email verified.')).not.toBeInTheDocument()
  })
})
