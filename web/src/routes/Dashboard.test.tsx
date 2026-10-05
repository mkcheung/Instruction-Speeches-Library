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

function stubReviews(sections: {
  invited?: Review[]
  in_progress?: Review[]
  published?: Review[]
  revoked?: Review[]
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input)
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
})
