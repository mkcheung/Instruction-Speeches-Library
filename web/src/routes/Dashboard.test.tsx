import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dashboard from '@/routes/Dashboard'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import type { Review } from '@/features/review/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
    if (url.includes('/api/me')) return jsonResponse(me)
    if (/\/api\/reviews\/\d+\/(withdraw|abandon)$/.test(url) && methodOf(input, init) === 'POST') {
      return jsonResponse({ review: { id: 1, status: url.endsWith('withdraw') ? 'declined' : 'abandoned' } })
    }
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
    const fetchMock = stubReviews({})
    renderWithProviders(<Dashboard />, { route: '/dashboard?verified=1' })

    const banner = await screen.findByText('Email verified.')
    const heading = screen.getByRole('heading', { level: 1, name: 'My reviews' })
    expect(banner.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/api/me'))).toHaveLength(1)
  })

  it('shows no banner without the query param', async () => {
    stubReviews({})
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByRole('heading', { name: 'My reviews' })).toBeInTheDocument()
    expect(screen.queryByText('Email verified.')).not.toBeInTheDocument()
  })

  /**
   * IMPLEMENTATION-PLANS.md §7.2.4: Withdraw + Abandon only belong on
   * "In progress" — never on "Invitations awaiting response" (Withdraw
   * there would be an identical outcome to the existing Decline button,
   * minus the notification — §7.2.6) and never on the already-closed
   * Published/Revoked sections.
   */
  it('offers Withdraw and Abandon only on an in-progress review, not on an invitation, published, or revoked review', async () => {
    stubReviews({
      invited: [review({ id: 1, status: 'invited', responded_at: null })],
      in_progress: [review({ id: 2, status: 'accepted' })],
      published: [review({ id: 3, status: 'published', last_published_at: '2026-09-03T10:00:00Z' })],
      revoked: [review({ id: 4, status: 'published', revoked_at: '2026-09-04T10:00:00Z' })],
    })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    await screen.findByRole('heading', { name: 'My reviews' })

    expect(screen.getAllByRole('button', { name: /^withdraw$/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^abandon$/i })).toHaveLength(1)
  })

  /**
   * code-review finding (§7.2 max review): Withdraw/Abandon used to live
   * nested inside the same `review.speech?.id` check that gates the
   * Watch link, so a review whose `speech` relation comes back null (an
   * admin takes a speech down while a coach's review on it is still
   * active — this list doesn't eager-load `withTrashed()`) silently lost
   * BOTH exit actions with no other way off the review.
   */
  it('still offers Withdraw and Abandon on an in-progress review whose speech relation is null', async () => {
    stubReviews({ in_progress: [review({ id: 2, status: 'accepted', speech: undefined })] })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    await screen.findByRole('heading', { name: 'My reviews' })

    expect(screen.getByRole('button', { name: /^withdraw$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^abandon$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^watch$/i })).not.toBeInTheDocument()
  })

  it('clicking Withdraw on an in-progress review posts to /withdraw with the review id', async () => {
    const user = userEvent.setup()
    const fetchMock = stubReviews({ in_progress: [review({ id: 2, status: 'accepted' })] })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: /^withdraw$/i }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/api/reviews/2/withdraw'))).toBe(
        true,
      ),
    )
  })

  it('clicking Abandon on an in-progress review posts to /abandon with the review id', async () => {
    const user = userEvent.setup()
    const fetchMock = stubReviews({ in_progress: [review({ id: 2, status: 'in_progress' })] })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: /^abandon$/i }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/api/reviews/2/abandon'))).toBe(
        true,
      ),
    )
  })

  it('retains all four server-grouped sections in order and their empty states', async () => {
    stubReviews({})
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    await screen.findByRole('heading', { name: 'My reviews' })
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Invitations awaiting response',
      'In progress',
      'Published work',
      'Revoked',
    ])
    for (const message of [
      'No pending invitations.',
      'Nothing in progress.',
      'Nothing published yet.',
      'Nothing revoked.',
    ]) {
      expect(screen.getByText(message)).toBeInTheDocument()
    }
  })

  it('preserves long invitation content and all review statuses without inventing display counts', async () => {
    const title = `An unusually long speech title ${'unbroken'.repeat(32)}`
    const message = `Please review my introduction. ${'Detailed feedback requested. '.repeat(20)}`.trim()
    const owner = 'A very long speaker name that should remain available in full'
    stubReviews({
      invited: [review({
        id: 1,
        status: 'invited',
        responded_at: null,
        invitation_message: message,
        speech: { id: 42, ulid: '01ABCDEF', title, owner_name: owner },
      })],
      in_progress: [review({ id: 2, status: 'in_progress' })],
      published: [review({ id: 3, status: 'published', last_published_at: '2026-09-03T10:00:00Z' })],
      revoked: [review({ id: 4, status: 'published', revoked_at: '2026-09-04T10:00:00Z', revocation_reason: 'The speaker withdrew access.' })],
    })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(await screen.findByText(title)).toHaveTextContent(title)
    expect(screen.getByText(message)).toHaveTextContent(message)
    expect(screen.getByText(`by ${owner}`)).toBeInTheDocument()
    expect(screen.getByText('in_progress')).toBeInTheDocument()
    expect(screen.getByText('published')).toBeInTheDocument()
    expect(screen.getByText('Revoked', { selector: '[data-slot="badge"]' })).toBeInTheDocument()
    expect(screen.getByText('Reason: The speaker withdrew access.')).toBeInTheDocument()
    expect(screen.getByText(/^Invited /)).toBeInTheDocument()
    expect(screen.getByText(/^Started /)).toBeInTheDocument()
    expect(screen.getByText(/^Published /, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(/^Revoked /, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
  })

  it('keeps both exit actions disabled while withdrawing and allows retry after a server error', async () => {
    const user = userEvent.setup()
    const fetchMock = stubReviews({ in_progress: [review({ id: 2, status: 'accepted' })] })
    const originalFetch = fetchMock.getMockImplementation()!
    let finishWithdraw: (response: Response) => void = () => { throw new Error('No pending withdrawal') }
    fetchMock.mockImplementation((input, init) => {
      if (urlOf(input).endsWith('/api/reviews/2/withdraw')) {
        return new Promise<Response>((resolve) => { finishWithdraw = resolve })
      }
      return originalFetch(input, init)
    })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }))
    expect(screen.getByRole('button', { name: 'Withdrawing…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeDisabled()
    finishWithdraw(jsonResponse({ message: 'Please retry.' }, 422))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Watch' })).toHaveAttribute('href', '/speeches/42')
  })

  it('keeps the route-local loading surface and the existing empty fallback after a list error', async () => {
    const fetchMock = stubReviews({})
    const originalFetch = fetchMock.getMockImplementation()!
    let finishReviews: (response: Response) => void = () => { throw new Error('No pending list request') }
    fetchMock.mockImplementation((input, init) => {
      if (urlOf(input).endsWith('/api/reviews')) {
        return new Promise<Response>((resolve) => { finishReviews = resolve })
      }
      return originalFetch(input, init)
    })
    renderWithProviders(<Dashboard />, { route: '/dashboard' })

    expect(screen.getByText('Loading…').closest('.workspace-notebook-page')).toHaveClass('workspace-dashboard')
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/api/reviews'))).toBe(true))
    finishReviews(jsonResponse({ message: 'Temporarily unavailable.' }, 503))

    expect(await screen.findByRole('heading', { name: 'My reviews' })).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4)
    expect(screen.getByText('No pending invitations.')).toBeInTheDocument()
  })
})
