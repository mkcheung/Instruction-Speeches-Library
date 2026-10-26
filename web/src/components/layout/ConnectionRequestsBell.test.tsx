import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionRequestsBell } from '@/components/layout/ConnectionRequestsBell'
import { renderWithProviders, clearCookies, createTestStore } from '@/test/renderWithProviders'
import { authApi } from '@/features/auth/authApi'
import { connectionApi } from '@/features/connection/connectionApi'
import { revalidateConnectionSession } from '@/features/connection/connectionSession'
import { friendsResponse, makeFriend } from '@/test/friendsFixtures'
import type { CurrentUser } from '@/features/auth/types'
import type { Friend } from '@/features/connection/types'

const viewer: CurrentUser = { id: '1', email: 'me@example.test', username: 'alex', first_name: 'Alex', last_name: 'Smith', display_name: 'Alex Smith', roles: ['member'], email_verified: true, onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 0, quota_bytes: 1000, uploads_in_flight: 0 }
const friend = (id = 42, name = 'Jordan Ellis') => makeFriend({ connection_id: id, person: { id: id + 100, username: name, name } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const urlOf = (input: RequestInfo | URL) => input instanceof Request ? input.url : input.toString()
const pending = (rows: Friend[] = [friend()], total = rows.length) => json(friendsResponse(rows, { total, next_cursor: total > 20 ? 'next-page' : null }))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }

async function setup({ user = viewer, response = () => pending(), mutate = () => Promise.resolve(json({ connection: { id: 42, state: 'accepted' } })) }: { user?: CurrentUser; response?: () => Response | Promise<Response>; mutate?: (url: string) => Promise<Response> } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.endsWith('/api/me')) return json({ user })
    if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
    if (url.includes('/api/friends?view=incoming')) return response()
    if (/\/api\/connections\/\d+\/(accept|decline)$/.test(url)) return mutate(url)
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const store = createTestStore()
  await store.dispatch(authApi.endpoints.getMe.initiate()).unwrap()
  const rendered = renderWithProviders(<ConnectionRequestsBell />, { store })
  return { ...rendered, fetchMock, incomingCalls: () => fetchMock.mock.calls.filter(([input]) => urlOf(input).includes('/api/friends?')).length }
}

describe('ConnectionRequestsBell', () => {
  beforeEach(() => { clearCookies(); document.cookie = 'XSRF-TOKEN=test; path=/' })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('announces the server total beyond one page and preserves the hidden visual badge', async () => {
    await setup({ response: () => pending([friend()], 37) })
    const button = await screen.findByRole('button', { name: 'Connection requests (37 pending)' })
    expect(within(button).getByText('9+')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(button)
    expect(await screen.findByText('Jordan Ellis')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all requests' })).toHaveAttribute('href', '/u/alex/friends/requests')
  })

  it('keeps View all available after a successful empty response', async () => {
    await setup({ response: () => pending([]) })
    await userEvent.click(await screen.findByRole('button', { name: 'Connection requests' }))
    expect(await screen.findByText('No pending requests.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all requests' })).toBeInTheDocument()
  })

  it('shows loading and query errors truthfully with retry and no false empty message', async () => {
    const result = deferred<Response>()
    let fail = true
    await setup({ response: () => fail ? result.promise : pending([]) })
    await userEvent.click(await screen.findByRole('button', { name: 'Connection requests' }))
    expect(screen.getByText('Loading requests…')).toBeInTheDocument()
    await act(async () => result.resolve(json({ message: 'Unavailable' }, 500)))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect.')
    expect(screen.queryByText('No pending requests.')).not.toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry requests' }))
    expect(await screen.findByText('No pending requests.')).toBeInTheDocument()
  })

  it.each([['admin'], ['super_admin'], ['member', 'admin']])('hides the bell and never queries for roles %j', async (...roles) => {
    const { incomingCalls } = await setup({ user: { ...viewer, roles } })
    expect(screen.queryByRole('button', { name: /connection requests/i })).not.toBeInTheDocument()
    expect(incomingCalls()).toBe(0)
  })

  it('hides the bell for a missing username or unresolved identity', async () => {
    const { incomingCalls, unmount } = await setup({ user: { ...viewer, username: null } })
    expect(screen.queryByRole('button', { name: /connection requests/i })).not.toBeInTheDocument()
    expect(incomingCalls()).toBe(0)
    unmount()
    renderWithProviders(<ConnectionRequestsBell />)
    expect(screen.queryByRole('button', { name: /connection requests/i })).not.toBeInTheDocument()
  })

  it('hides old data while revalidating and on a session error', async () => {
    const { store } = await setup()
    await screen.findByRole('button', { name: 'Connection requests (1 pending)' })
    const probe = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => probe.promise))
    act(() => { store.dispatch(revalidateConnectionSession()) })
    expect(screen.queryByRole('button', { name: /connection requests/i })).not.toBeInTheDocument()
    await act(async () => probe.resolve(json({}, 500)))
    expect(store.getState().connectionSession.status).toBe('error')
    expect(screen.queryByRole('button', { name: /connection requests/i })).not.toBeInTheDocument()
  })

  it('accepts and declines independently, unwraps failures, and announces success', async () => {
    const accept = deferred<Response>()
    let rows = [friend(), friend(43, 'Sam Chan')]
    await setup({ response: () => pending(rows), mutate: async (url) => {
      if (url.endsWith('/42/accept')) return accept.promise
      rows = [friend()]
      return json({ connection: { id: 43, state: 'declined' } })
    } })
    await userEvent.click(await screen.findByRole('button', { name: 'Connection requests (2 pending)' }))
    const jordan = (await screen.findByText('Jordan Ellis')).closest('li')!
    const sam = screen.getByText('Sam Chan').closest('li')!
    await userEvent.click(within(jordan).getByRole('button', { name: 'Accept' }))
    expect(within(jordan).getByRole('button', { name: 'Accepting…' })).toBeDisabled()
    expect(within(sam).getByRole('button', { name: 'Decline' })).toBeEnabled()
    await userEvent.click(within(sam).getByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Request from Sam Chan declined.')).toBeInTheDocument()
    expect(screen.queryByText('Sam Chan')).not.toBeInTheDocument()
    await act(async () => accept.resolve(json({}, 429)))
    expect(await within(jordan).findByRole('alert')).toHaveTextContent('Too many requests.')
  })

  it('refreshes on focus, visibility and a visible 60 second poll, with cleanup', async () => {
    const timer = vi.spyOn(window, 'setInterval')
    const clear = vi.spyOn(window, 'clearInterval')
    const { store, incomingCalls, unmount } = await setup({ response: () => pending([]) })
    const settled = () => waitFor(() => expect(connectionApi.endpoints.getFriends.select({ viewerId: '1', view: 'incoming' })(store.getState()).status).toBe('fulfilled'))
    await settled()
    const callIndex = timer.mock.calls.findIndex(([, delay]) => delay === 60_000)
    expect(callIndex).toBeGreaterThanOrEqual(0)
    const tick = timer.mock.calls[callIndex][0] as () => void
    await act(async () => { fireEvent(window, new Event('focus')) })
    await settled()
    expect(incomingCalls()).toBe(2)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => tick())
    expect(incomingCalls()).toBe(2)
    visibility.mockReturnValue('visible')
    await act(async () => { fireEvent(document, new Event('visibilitychange')) })
    await settled()
    expect(incomingCalls()).toBe(3)
    await act(async () => tick())
    await settled()
    expect(incomingCalls()).toBe(4)
    const interval = timer.mock.results[callIndex].value
    unmount()
    expect(clear).toHaveBeenCalledWith(interval)
    fireEvent(window, new Event('focus'))
    expect(incomingCalls()).toBe(4)
  })

  it('shows a new request reusing a declined connection row after canonical refresh', async () => {
    let rows = [friend()]
    const { store } = await setup({ response: () => pending(rows), mutate: async () => {
      rows = []
      return json({ connection: { id: 42, state: 'declined' } })
    } })
    await userEvent.click(await screen.findByRole('button', { name: 'Connection requests (1 pending)' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('No pending requests.')).toBeInTheDocument()
    rows = [friend()]
    await act(async () => { await store.dispatch(connectionApi.endpoints.getFriends.initiate({ viewerId: '1', view: 'incoming' }, { forceRefetch: true })).unwrap() })
    expect(await screen.findByText('Jordan Ellis')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('accepts a request and announces the resulting connection', async () => {
    let rows = [friend()]
    await setup({ response: () => pending(rows), mutate: async () => {
      rows = []
      return json({ connection: { id: 42, state: 'accepted' } })
    } })
    await userEvent.click(await screen.findByRole('button', { name: 'Connection requests (1 pending)' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('You are now connected with Jordan Ellis.')).toBeInTheDocument()
    expect(screen.queryByText('Jordan Ellis')).not.toBeInTheDocument()
  })

  it('refreshes the count after another surface sends a connection request', async () => {
    let total = 0
    const { store, incomingCalls } = await setup({ response: () => pending([], total) })
    await vi.waitFor(() => expect(incomingCalls()).toBe(1))
    // A send from the Find surface invalidates all Friends queries.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.endsWith('/api/connections')) { total = 1; return json({ connection: { id: 99, state: 'accepted' } }) }
      if (url.includes('/api/friends?')) return pending([friend()], total)
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { await store.dispatch(connectionApi.endpoints.sendConnectionRequest.initiate({ user_id: 99 })).unwrap() })
    expect(await screen.findByRole('button', { name: 'Connection requests (1 pending)' })).toBeInTheDocument()
  })
})
