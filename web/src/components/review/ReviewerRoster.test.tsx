import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewerRoster } from '@/components/review/ReviewerRoster'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import type { RosterReview } from '@/features/review/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

/** A `GET /api/speeches/{speech}/review-roster` row, trimmed to what
 * `ReviewerRoster`/`RevokeReviewDialog` read — typed against
 * IMPLEMENTATION-PLANS.md §7.2's spec since the backend half of this
 * feature lives in a separate worktree. */
function rosterReview(overrides: Partial<RosterReview> = {}): RosterReview {
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
    reviewer: { id: 7, username: 'coach7', name: 'Coach Seven' },
    annotations_count: 0,
    published_annotations_count: 0,
    revoked_by_is_self: false,
    ...overrides,
  }
}

function stubRoster(reviews: RosterReview[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (url.includes('/review-roster')) return jsonResponse({ reviews })
    if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
    if (url.includes('/api/reviews/') && url.endsWith('/revoke') && methodOf(input, init) === 'POST') {
      return jsonResponse({ review: { ...reviews[0], revoked_at: '2026-09-05T10:00:00Z' } })
    }
    if (url.includes('/revoke-and-purge') && methodOf(input, init) === 'POST') {
      return new Response(null, { status: 204 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ReviewerRoster', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('sorts rows into the four groups by status and revoked_at', async () => {
    stubRoster([
      rosterReview({ id: 1, status: 'invited', revoked_at: null, reviewer: { name: 'Awaiting' } }),
      rosterReview({ id: 2, status: 'in_progress', revoked_at: null, reviewer: { name: 'Working' } }),
      rosterReview({ id: 3, status: 'published', revoked_at: null, reviewer: { name: 'Delivered' } }),
      rosterReview({
        id: 4,
        status: 'declined',
        revoked_at: null,
        reviewer: { name: 'Declined Person' },
      }),
      rosterReview({
        id: 5,
        status: 'abandoned',
        revoked_at: null,
        reviewer: { name: 'Abandoned Person' },
      }),
      rosterReview({
        id: 6,
        status: 'accepted',
        revoked_at: '2026-09-05T10:00:00Z',
        revoked_by_is_self: true,
        revocation_reason: 'No longer needed',
        reviewer: { name: 'Revoked By Me' },
      }),
    ])

    renderWithProviders(<ReviewerRoster speechId={1} />)

    expect(await screen.findByText('Awaiting a reply')).toBeInTheDocument()
    expect(screen.getByText('Awaiting')).toBeInTheDocument()
    expect(screen.getByText('Working on it')).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Feedback delivered')).toBeInTheDocument()
    expect(screen.getByText('Delivered')).toBeInTheDocument()

    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('Declined Person')).toBeInTheDocument()
    expect(screen.getByText('Declined your invitation')).toBeInTheDocument()
    expect(screen.getByText('Abandoned Person')).toBeInTheDocument()
    expect(screen.getByText('Stopped working on this')).toBeInTheDocument()
    expect(screen.getByText('Revoked By Me')).toBeInTheDocument()
    expect(screen.getByText(/You removed their access/)).toBeInTheDocument()
    expect(screen.getByText(/No longer needed/)).toBeInTheDocument()
  })

  it('shows "An administrator removed their access" when revoked_by_is_self is false', async () => {
    stubRoster([
      rosterReview({
        id: 6,
        status: 'accepted',
        revoked_at: '2026-09-05T10:00:00Z',
        revoked_by_is_self: false,
        reviewer: { name: 'Revoked By Admin' },
      }),
    ])

    renderWithProviders(<ReviewerRoster speechId={1} />)

    expect(await screen.findByText(/An administrator removed their access/)).toBeInTheDocument()
  })

  it('offers no action buttons at all on the Closed group', async () => {
    stubRoster([
      rosterReview({ id: 4, status: 'declined', reviewer: { name: 'Declined Person' } }),
    ])

    renderWithProviders(<ReviewerRoster speechId={1} />)

    await screen.findByText('Declined Person')
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument()
  })

  it('offers only Revoke (no purge) on Awaiting a reply', async () => {
    stubRoster([rosterReview({ id: 1, status: 'invited', reviewer: { name: 'Awaiting' } })])

    renderWithProviders(<ReviewerRoster speechId={1} />)

    await screen.findByText('Awaiting')
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revoke and delete/i })).not.toBeInTheDocument()
  })

  it('offers Revoke and Revoke-and-purge on Working on it, and the revoke dialog opens, requires a reason, and submits', async () => {
    const user = userEvent.setup()
    const fetchMock = stubRoster([
      rosterReview({
        id: 2,
        status: 'in_progress',
        reviewer: { name: 'Working Person' },
        annotations_count: 5,
        published_annotations_count: 2,
      }),
    ])

    renderWithProviders(<ReviewerRoster speechId={1} />)
    await screen.findByText('Working Person')

    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByTestId('revoke-dialog')
    const confirmButton = within(dialog).getByRole('button', { name: 'Revoke' })
    expect(confirmButton).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Reason'), 'Not a good fit')
    expect(confirmButton).not.toBeDisabled()

    await user.click(confirmButton)

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/reviews/2/revoke')),
      ).toBe(true),
    )
  })

  it('the purge dialog requires both a reason and typing DELETE, and surfaces the note counts', async () => {
    const user = userEvent.setup()
    const fetchMock = stubRoster([
      rosterReview({
        id: 3,
        status: 'published',
        reviewer: { name: 'Published Person' },
        annotations_count: 5,
        published_annotations_count: 2,
      }),
    ])

    renderWithProviders(<ReviewerRoster speechId={1} />)
    await screen.findByText('Published Person')

    await user.click(screen.getByRole('button', { name: 'Revoke and delete their work' }))
    const dialog = await screen.findByTestId('revoke-and-purge-dialog')
    expect(within(dialog).getByText(/5 notes/)).toBeInTheDocument()
    expect(within(dialog).getByText(/2 of them published/)).toBeInTheDocument()

    const confirmButton = within(dialog).getByRole('button', { name: 'Revoke and delete their work' })
    expect(confirmButton).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Reason'), 'Policy violation')
    expect(confirmButton).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/Type/), 'DELETE')
    expect(confirmButton).not.toBeDisabled()

    await user.click(confirmButton)

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => urlOf(input).includes('/api/reviews/3/revoke-and-purge')),
      ).toBe(true),
    )
  })
})
