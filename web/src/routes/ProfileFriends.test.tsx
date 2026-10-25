import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, Route, Routes, useParams } from 'react-router-dom'
import ProfileFriends from './ProfileFriends'
import { useGetMeQuery, authApi } from '@/features/auth/authApi'
import { useGetPublicProfileQuery } from '@/features/profile/profileApi'
import { connectionApi } from '@/features/connection/connectionApi'
import { clearCookies, renderWithProviders } from '@/test/renderWithProviders'
import type { Friend } from '@/features/connection/types'

const alice: Friend = { connection_id: 15, person: { id: 8, name: 'Alice Example', username: 'alice', avatar_url: '/alice.jpg' }, mutual_friends_count: 2, requested_at: '2026-01-01', connected_at: '2026-01-02', note: 'Hello from rehearsal' }
const bob: Friend = { ...alice, connection_id: 16, person: { id: 9, name: 'Bob Example', username: 'bob', avatar_url: null }, mutual_friends_count: 0 }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const list = (friends: Friend[] = [alice], total = friends.length, cursor: string | null = null) => json({ friends, meta: { total, next_cursor: cursor } })
const people = (friends: Friend[] = [alice], cursor: string | null = null) => json({ people: friends.map(({ person: { id, name, avatar_url }, mutual_friends_count }) => ({ person: { id, name, avatar_url }, mutual_friends_count })), meta: { next_cursor: cursor } })

/** A routed parent using real public-profile and authoritative session queries. */
function ProfileParent() {
  const { username = '' } = useParams()
  useGetMeQuery()
  const { currentData: profile } = useGetPublicProfileQuery(username)
  return profile ? <Outlet context={{ profile }} /> : <p>Loading profile…</p>
}
function mount(view = 'all', username = 'milo') {
  return renderWithProviders(<Routes>
    <Route path="/u/:username" element={<ProfileParent />}>
      <Route path="friends" element={<ProfileFriends />} />
      <Route path="friends/:view" element={<ProfileFriends />} />
    </Route>
    <Route path="/login" element={<p>Login destination</p>} />
  </Routes>, { route: `/u/${username}/friends${view ? `/${view}` : ''}` })
}
function fixtures(handler: (url: URL, request: Request) => Response | Promise<Response>, options: { me?: unknown; meStatus?: number; profileId?: number } = {}) {
  const reads = vi.fn(handler)
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    if (url.pathname === '/api/me') return json(options.me ?? { user: { id: 2, username: 'milo', roles: ['member'] } }, options.meStatus ?? 200)
    if (url.pathname.startsWith('/api/u/')) return json({ profile: { id: options.profileId ?? 2, username: url.pathname.split('/').at(-1), display_name: 'Milo', avatar_url: null, bio: null, pronouns: null, location: null } })
    if (url.pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    return reads(url, request)
  }))
  return reads
}
beforeEach(() => { clearCookies(); document.cookie = 'XSRF-TOKEN=test; path=/' })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('ProfileFriends routed views with the real store', () => {
  it('redirects the index, renders three real destinations and accepted profile links', async () => {
    fixtures(() => list())
    const { router } = mount('')
    expect(await screen.findByRole('link', { name: 'Alice Example' })).toHaveAttribute('href', '/u/alice')
    expect(router.state.location.pathname).toBe('/u/milo/friends/all')
    const nav = screen.getByRole('navigation', { name: 'Friends sections' })
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/u/milo/friends/all', '/u/milo/friends/requests', '/u/milo/friends/find'])
    expect(within(nav).getByRole('link', { name: 'Your friends' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('2 mutual friends')).toBeInTheDocument()
  })

  it.each([{ username: 'other', profileId: 3 }, { username: 'other', profileId: 2 }])('blocks noncanonical ownership without private requests: $profileId/$username', async ({ username, profileId }) => {
    const reads = fixtures(() => list(), { profileId })
    mount('all', username)
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable for this profile')
    expect(reads).not.toHaveBeenCalled()
  })

  it('redirects an anonymous visit with its return location and skips private reads', async () => {
    const reads = fixtures(() => list(), { me: { message: 'Unauthenticated' }, meStatus: 401 })
    const { router } = mount('requests')
    expect(await screen.findByText('Login destination')).toBeInTheDocument()
    expect(router.state.location.state.from.pathname).toBe('/u/milo/friends/requests')
    expect(reads).not.toHaveBeenCalled()
  })

  it('fails closed on an identity error and retries an authoritative session', async () => {
    fixtures(() => list(), { me: { message: 'Temporarily unavailable' }, meStatus: 503 })
    mount()
    expect(await screen.findByRole('button', { name: 'Retry session' })).toBeInTheDocument()
    expect(screen.queryByText('Alice Example')).not.toBeInTheDocument()
    fixtures(() => list())
    await userEvent.click(screen.getByRole('button', { name: 'Retry session' }))
    expect(await screen.findByText('Alice Example')).toBeInTheDocument()
  })

  it('keeps initial and typed discovery empty; submitted search controls subsequent paging independently of draft', async () => {
    const reads = fixtures((url) => people(url.searchParams.has('cursor') ? [bob] : [alice], url.searchParams.has('cursor') ? null : 'opaque-page-2'))
    const user = userEvent.setup()
    const { container } = mount('find')
    expect(await screen.findByText('Enter a name to find people.')).toBeInTheDocument()
    expect(reads).not.toHaveBeenCalled()
    const input = screen.getByLabelText('Find people by name')
    await user.type(input, '  Alice  ')
    expect(reads).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    await screen.findByText('Alice Example')
    expect(reads.mock.calls[0][0].searchParams.get('search')).toBe('Alice')
    expect(container.querySelectorAll('.friends-list a, .friends-list [tabindex]')).toHaveLength(0)
    await user.clear(input)
    expect(screen.queryByText('Alice Example')).not.toBeInTheDocument()
    await user.type(input, 'Alice')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('Alice Example')
    await user.type(input, ' unfinished')
    const previousReads = reads.mock.calls.length
    expect(screen.getByText('Alice Example')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Bob Example')
    expect(reads.mock.calls.length).toBe(previousReads + 1)
    expect(Object.fromEntries(reads.mock.calls.at(-1)![0].searchParams)).toEqual({ search: 'Alice', cursor: 'opaque-page-2' })
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('Alice Example')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Bob Example')
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument())
  })

  it('debounces accepted server searches at 300ms, resets the cursor and clears to all friends', async () => {
    const reads = fixtures((url) => list(url.searchParams.has('search') ? [bob] : [alice], 25, 'page-2'))
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alice Example')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(reads.mock.calls.at(-1)![0].searchParams.get('cursor')).toBe('page-2'))
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText('Search your friends by name'), { target: { value: ' Bob ' } })
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(reads.mock.calls.some(([url]) => url.searchParams.has('search'))).toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(reads.mock.calls.at(-1)![0].searchParams.toString()).toBe('view=accepted&search=Bob')
    vi.useRealTimers()
    await screen.findByText('Bob Example')
    expect(screen.getByText('25 matching friends')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await screen.findByText('Alice Example')
    expect(screen.getByText('Page 1')).toBeInTheDocument()
  })

  it('accepts one incoming card without disabling unrelated cards and restores focus with a persistent announcement', async () => {
    let resolveMutation!: (response: Response) => void
    let accepted = false
    fixtures((url, request) => {
      if (request.method === 'POST') return new Promise<Response>((resolve) => { resolveMutation = (response) => { accepted = true; resolve(response) } })
      expect(url.searchParams.get('view')).toBe('incoming')
      return list(accepted ? [bob] : [alice, bob])
    })
    const user = userEvent.setup()
    mount('requests')
    await screen.findByText('Alice Example')
    const rows = screen.getAllByRole('listitem')
    await user.click(within(rows[0]).getByRole('button', { name: 'Accept' }))
    expect(within(rows[0]).getByRole('button', { name: 'Accepting…' })).toBeDisabled()
    expect(within(rows[1]).getByRole('button', { name: 'Accept' })).toBeEnabled()
    await act(async () => resolveMutation(json({ connection: { id: 15, state: 'accepted' } })))
    await waitFor(() => expect(screen.queryByText('Alice Example')).not.toBeInTheDocument())
    expect(screen.getByText('You are now connected with Alice Example.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Friend requests' })).toHaveFocus()
  })

  it('uses pending canonical send status after the refreshed result disappears', async () => {
    let sent = false
    fixtures((_url, request) => {
      if (request.method === 'POST') { sent = true; return json({ connection: { id: 15, state: 'pending' } }) }
      return people(sent ? [] : [alice])
    })
    const user = userEvent.setup()
    mount('find')
    await screen.findByLabelText('Find people by name')
    await user.type(screen.getByLabelText('Find people by name'), 'Alice{Enter}')
    await screen.findByText('Alice Example')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('Request sent to Alice Example.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument()
  })

  it('allows a later incoming request from a previously declined person after a fresh snapshot', async () => {
    let phase: 'initial' | 'declined' | 'requested-again' = 'initial'
    fixtures((_url, request) => {
      if (request.method === 'POST') { phase = 'declined'; return json({ connection: { id: 15, state: 'declined' } }) }
      return list(phase === 'declined' ? [] : [{ ...alice, requested_at: phase === 'requested-again' ? '2026-02-01' : alice.requested_at }])
    })
    const user = userEvent.setup()
    const { store } = mount('requests')
    await screen.findByText('Alice Example')
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await screen.findByText('No incoming requests.')
    expect(screen.getByText('Request from Alice Example declined.')).toBeInTheDocument()
    phase = 'requested-again'
    await act(async () => { store.dispatch(connectionApi.util.invalidateTags(['Friends'])) })
    expect(await screen.findByText('Alice Example')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(screen.getByText('Request from Alice Example declined.')).toBeInTheDocument()
  })

  it('restarts a cursor page after external relationship invalidation and prevents stale actions during refresh', async () => {
    let holdRefresh = false
    let finish!: (response: Response) => void
    const reads = fixtures((url) => {
      if (holdRefresh) return new Promise<Response>((resolve) => { finish = resolve })
      return list(url.searchParams.has('cursor') ? [bob] : [alice], 25, 'page-2')
    })
    const user = userEvent.setup()
    const { store } = mount('requests')
    await screen.findByText('Alice Example')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Bob Example')
    holdRefresh = true
    await act(async () => { store.dispatch(connectionApi.util.invalidateTags(['Friends'])) })
    await waitFor(() => expect(reads.mock.calls.at(-1)![0].searchParams.has('cursor')).toBe(false))
    expect(screen.queryByText('Bob Example')).not.toBeInTheDocument()
    const accept = screen.queryByRole('button', { name: 'Accept' })
    if (accept) expect(accept).toBeDisabled()
    await act(async () => finish(list([alice])))
    expect(await screen.findByText('Alice Example')).toBeInTheDocument()
    expect(screen.getByText('Page 1')).toBeInTheDocument()
  })

  it('clears a private page immediately when its API returns 401, even with cached me', async () => {
    let authorized = true
    fixtures(() => authorized ? list() : json({ message: 'Unauthenticated' }, 401))
    const { store } = mount()
    await screen.findByText('Alice Example')
    authorized = false
    await act(async () => { store.dispatch(connectionApi.util.invalidateTags(['Friends'])) })
    expect(await screen.findByText('Login destination')).toBeInTheDocument()
    expect(screen.queryByText('Alice Example')).not.toBeInTheDocument()
  })

  it('refreshes current queries on window focus without applying unfinished Find draft text', async () => {
    const reads = fixtures(() => people())
    const user = userEvent.setup()
    mount('find')
    const input = await screen.findByLabelText('Find people by name')
    await user.type(input, 'Alice{Enter}')
    await screen.findByText('Alice Example')
    await user.type(input, ' new text')
    const before = reads.mock.calls.length
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(reads.mock.calls.length).toBe(before + 1))
    expect(reads.mock.calls.at(-1)![0].searchParams.get('search')).toBe('Alice')
    expect(input).toHaveValue('Alice new text')
  })

  it('keeps the reader on a deeper page when the window regains focus', async () => {
    const reads = fixtures((url) => list(url.searchParams.get('cursor') === 'page-2' ? [bob] : [alice], 25, 'page-2'))
    const user = userEvent.setup()
    mount()
    await screen.findByText('Alice Example')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Bob Example')
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    const before = reads.mock.calls.length

    fireEvent(window, new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    // A passive focus change neither refetches the keyset page nor throws away the reader's place.
    expect(reads.mock.calls.length).toBe(before)
    expect(screen.getByText('Page 2')).toBeInTheDocument()
    expect(screen.getByText('Bob Example')).toBeInTheDocument()
  })

  it('keeps loading, empty and failed states distinct and makes retry useful', async () => {
    let finish!: (response: Response) => void
    fixtures(() => new Promise<Response>((resolve) => { finish = resolve }))
    mount()
    await screen.findByText('Loading…')
    expect(screen.queryByText('No friends yet.')).not.toBeInTheDocument()
    await act(async () => finish(json({ message: 'Unavailable' }, 503)))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection')
    fixtures(() => list([]))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No friends yet.')).toBeInTheDocument()
  })

  it('quarantines visible results while a real getMe revalidation is pending', async () => {
    fixtures(() => list())
    const { store } = mount()
    await screen.findByText('Alice Example')
    let finish!: (response: Response) => void
    fixtures(() => list())
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((request: Request) => new URL(request.url).pathname === '/api/me' ? new Promise<Response>((resolve) => { finish = resolve }) : realFetch(request)))
    let resolveQuery!: Promise<unknown>
    await act(async () => { resolveQuery = store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false, forceRefetch: true })) })
    expect(screen.queryByText('Alice Example')).not.toBeInTheDocument()
    expect(screen.getByText('Checking your session…')).toBeInTheDocument()
    await act(async () => { finish(json({ user: { id: 3, username: 'other', roles: ['member'] } })); await resolveQuery })
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable for this profile')
    expect(screen.queryByText('Alice Example')).not.toBeInTheDocument()
    store.dispatch(connectionApi.util.resetApiState())
  })
})
