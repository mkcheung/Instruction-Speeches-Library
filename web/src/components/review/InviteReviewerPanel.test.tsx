import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InviteReviewerPanel } from './InviteReviewerPanel'
import { clearCookies, renderWithProviders } from '@/test/renderWithProviders'

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function directoryApi() {
  const searches: URL[] = []
  const invitations: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (url.pathname === '/api/reviewers') {
      searches.push(url)
      const page = Number(url.searchParams.get('page') ?? 1)
      return json({ reviewers: ['A', 'B'].map((suffix, index) => ({
        id: (page - 1) * 2 + index + 1, username: `coach-${page}-${suffix}`, name: `Cora page${page}${suffix}`,
        credential: 'coach', avatar_url: null,
      })), meta: { current_page: page, last_page: 3, total: 6 } })
    }
    if (url.pathname === '/api/speeches/9/reviews' && request.method === 'POST') {
      invitations.push(await request.json() as Record<string, unknown>)
      return json({ review: { id: 100 + invitations.length, status: 'invited' } })
    }
    throw new Error(`unexpected fetch: ${request.method} ${url.pathname}`)
  }))
  return { searches, invitations }
}

describe('reviewer invitation directory state', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('invites two people from one filtered page while clearing only the invitation form', async () => {
    const api = directoryApi()
    const user = userEvent.setup()
    renderWithProviders(<InviteReviewerPanel speechId={9} />)
    await screen.findByText('Cora page1A')
    await user.click(screen.getByRole('button', { name: 'Coaches' }))
    await user.type(screen.getByLabelText('Search the reviewer directory'), '  Cora  ')
    await waitFor(() => expect(api.searches.at(-1)?.searchParams.get('search')).toBe('Cora'))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Cora page2A')
    await user.click(screen.getByRole('button', { name: /^Cora page2A/ }))
    await user.type(screen.getByLabelText('Message (optional)'), 'First invitation')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    await screen.findByText('Invitation sent to Cora page2A.')

    await user.click(screen.getByRole('button', { name: 'Invite someone else' }))
    expect(screen.getByLabelText('Search the reviewer directory')).toHaveValue('  Cora  ')
    expect(screen.getByRole('button', { name: 'Coaches' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Message (optional)')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /^Cora page2B/ }))
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    await screen.findByText('Invitation sent to Cora page2B.')
    expect(api.invitations).toEqual([
      { reviewer_id: 3, message: 'First invitation', allow_preview: false, prior_commentary_shared: false },
      { reviewer_id: 4, message: null, allow_preview: false, prior_commentary_shared: false },
    ])
    expect(api.searches.at(-1)?.searchParams.toString()).toBe('search=Cora&credential=coach&page=2')
  })

  it('resets a later directory page synchronously for each filter without selecting a reviewer', async () => {
    const api = directoryApi()
    const user = userEvent.setup()
    renderWithProviders(<InviteReviewerPanel speechId={9} />)
    await screen.findByText('Cora page1A')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Cora page2A')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Cora page3A')
    await user.click(screen.getByRole('button', { name: 'Members' }))
    await waitFor(() => expect(api.searches.at(-1)?.searchParams.toString()).toBe('credential=member'))
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Cora page2A')
    await user.type(screen.getByLabelText('Search the reviewer directory'), '  New  ')
    await waitFor(() => expect(api.searches.at(-1)?.searchParams.toString()).toBe('search=New&credential=member'))
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled()
    expect(api.invitations).toEqual([])
  })
})
