import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReviewerDirectory from '@/routes/ReviewerDirectory'
import { clearCookies, renderWithProviders } from '@/test/renderWithProviders'
import type { ReviewerDirectoryEntry } from '@/features/review/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function reviewer(overrides: Partial<ReviewerDirectoryEntry> = {}): ReviewerDirectoryEntry {
  return { id: 1, name: 'Cora Coach', username: 'cora', credential: 'coach', avatar_url: null, ...overrides }
}
function directory(reviewers: ReviewerDirectoryEntry[] = [reviewer()], page = 1, lastPage = 1) {
  return jsonResponse({ reviewers, meta: { current_page: page, last_page: lastPage, total: reviewers.length } })
}
function mockDirectory(handler: (url: URL) => Response | Promise<Response>) {
  const requests = vi.fn(handler)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (url.pathname === '/api/me') return jsonResponse({ user: { id: 2, roles: ['member'], username: 'milo' } })
    if (url.pathname === '/api/reviewers') return requests(url)
    throw new Error(`unexpected fetch: ${url}`)
  }))
  return requests
}

describe('ReviewerDirectory notebook route', () => {
  beforeEach(() => clearCookies())
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('renders complete long reviewer identities and literal credential badges without turning rows into actions', async () => {
    const name = 'Long reviewer ' + '名'.repeat(180)
    const username = 'reviewer'.repeat(50)
    mockDirectory(() => directory([reviewer({ name, username }), reviewer({ id: 2, name: 'Milo Member', username: 'milo', credential: 'member' })]))
    const { container } = renderWithProviders(<ReviewerDirectory />, { route: '/reviewers' })
    await screen.findByText(name)
    expect(screen.getByText('@' + username)).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Find reviewers' })).toBeInTheDocument()
    expect(screen.getByText('2 reviewers')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Coach')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Member')).toBeInTheDocument()
    expect(container.querySelectorAll('li a,li button,li [tabindex],main,form')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps pagination reachable and sends real page arguments while disabling its boundaries', async () => {
    const requests = mockDirectory((url) => directory([reviewer({ name: `Page ${url.searchParams.get('page') ?? 1} coach` })], Number(url.searchParams.get('page') ?? 1), 2))
    const user = userEvent.setup()
    renderWithProviders(<ReviewerDirectory />, { route: '/reviewers' })
    await screen.findByText('Page 1 coach')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 coach')
    expect(screen.getByText('Page 2 of 2')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('Page 1 coach')
    expect(requests.mock.calls.map(([url]) => url.searchParams.get('page'))).toEqual([null, '2'])
  })

  it('retains the 300ms trimmed search debounce and resets page for search and credential changes', async () => {
    const requests = mockDirectory((url) => directory([reviewer({ name: `Result ${url.searchParams.toString()}` })], Number(url.searchParams.get('page') ?? 1), 3))
    const user = userEvent.setup()
    renderWithProviders(<ReviewerDirectory />, { route: '/reviewers' })
    await screen.findByRole('button', { name: 'Next' })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 of 3')
    await user.click(screen.getByRole('button', { name: 'Coaches' }))
    await waitFor(() => expect(requests.mock.calls.at(-1)![0].searchParams.toString()).toBe('credential=coach'))
    expect(screen.getByRole('button', { name: 'Coaches' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(requests.mock.calls.at(-1)![0].searchParams.get('page')).toBe('2'))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Search by name or username'), { target: { value: '  Cora  ' } })
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(requests.mock.calls.some(([url]) => url.searchParams.has('search'))).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(requests.mock.calls.at(-1)![0].searchParams.toString()).toBe('search=Cora&credential=coach')
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('distinguishes pending and empty data without hiding the search controls', async () => {
    let finish!: (response: Response) => void
    mockDirectory(() => new Promise<Response>((resolve) => { finish = resolve }))
    renderWithProviders(<ReviewerDirectory />, { route: '/reviewers' })
    expect(screen.getByText('Searching…')).toBeInTheDocument()
    expect(screen.queryByText('No reviewers found.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search by name or username')).toBeEnabled()
    await waitFor(() => expect(finish).toBeDefined())
    await act(async () => finish(directory([])))
    expect(await screen.findByText('No reviewers found.')).toBeInTheDocument()
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
  })

  it('retains the permission-denied branch without pretending the directory is empty', async () => {
    mockDirectory(() => jsonResponse({ message: 'Forbidden' }, 403))
    renderWithProviders(<ReviewerDirectory />, { route: '/reviewers' })
    expect(await screen.findByText("The reviewer directory isn't available to this account.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Search by name or username')).not.toBeInTheDocument()
    expect(screen.queryByText('No reviewers found.')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('keeps server failure explicit rather than rendering an empty result', async () => {
    mockDirectory(() => jsonResponse({ message: 'Unavailable' }, 500))
    renderWithProviders(<ReviewerDirectory />, { route: '/reviewers' })
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the reviewer directory — try again.")
    expect(screen.queryByText('No reviewers found.')).not.toBeInTheDocument()
  })
})
