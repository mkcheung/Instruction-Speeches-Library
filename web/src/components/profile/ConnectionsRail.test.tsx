import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionsRail } from './ConnectionsRail'
import { useGetMeQuery, authApi } from '@/features/auth/authApi'
import { renderWithProviders } from '@/test/renderWithProviders'

function Rail() { useGetMeQuery(); return <ConnectionsRail /> }
const me = { user: { id: '5', username: 'my-handle', roles: [] } }
const accepted = { friends: [{ connection_id: 41, person: { id: 8, name: 'Ada Friend', username: 'ada', avatar_url: 'https://images.test/ada.jpg' }, mutual_friends_count: 2 }], meta: { total: 37, next_cursor: 'next-page' } }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
function setup(identity: unknown = me, identityStatus = 200, failFirst = false) {
  let reads = 0
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/me') return json(identity, identityStatus)
    if (url.pathname === '/api/friends') {
      expect(url.searchParams.get('view')).toBe('accepted')
      if (++reads === 1 && failFirst) return json({ message: 'Too many requests' }, 429)
      return json(accepted)
    }
    throw new Error('Unexpected request: '+url)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
afterEach(() => vi.unstubAllGlobals())
describe('ConnectionsRail', () => {
  it('uses the true accepted total, mutual count and real person/See all links without legacy reads', async () => {
    const fetch = setup()
    renderWithProviders(<Rail />)
    expect(await screen.findByText('37 connections')).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Your connections' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ada Friend' })).toHaveAttribute('href', '/u/ada')
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/u/my-handle/friends/all')
    expect(screen.getByText('2 mutual friends')).toBeVisible()
    expect(fetch.mock.calls.some(([input]) => (input instanceof Request ? input.url : input.toString()).includes('/api/connections'))).toBe(false)
    expect(fetch.mock.calls.filter(([input]) => (input instanceof Request ? input.url : input.toString()).includes('/api/friends'))).toHaveLength(1)
  })
  it.each([
    ['anonymous', {}, 401],
    ['admin', { user: { ...me.user, roles: ['member', 'admin'] } }, 200],
    ['superadmin', { user: { ...me.user, roles: ['super_admin'] } }, 200],
    ['missing username', { user: { ...me.user, username: null } }, 200],
  ])('makes no private queries for %s identities', async (_label, identity, status) => {
    const fetch = setup(identity, status)
    const { store } = renderWithProviders(<Rail />)
    await waitFor(() => expect(['ready', 'anonymous']).toContain(store.getState().connectionSession.status))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(fetch.mock.calls).toHaveLength(1)
  })
  it('reports errors with retry and refreshes when the visible window regains focus', async () => {
    const fetch = setup(me, 200, true)
    const user = userEvent.setup()
    renderWithProviders(<Rail />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests')
    expect(screen.queryByText('No connections yet.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry connections' }))
    await screen.findByText('Ada Friend')
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(fetch.mock.calls.filter(([input]) => (input instanceof Request ? input.url : input.toString()).includes('/api/friends'))).toHaveLength(3))
  })
  it('hides private names throughout identity refresh and excludes a late old-viewer result', async () => {
    let finishMe!: (value: Response) => void
    let finishFriends!: (value: Response) => void
    let meCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname === '/api/me') return ++meCalls === 1 ? json(me) : new Promise<Response>((resolve) => { finishMe = resolve })
      return new Promise<Response>((resolve) => { finishFriends = resolve })
    }))
    const { store } = renderWithProviders(<Rail />)
    await waitFor(() => expect(finishFriends).toBeDefined())
    let refresh!: Promise<unknown>
    act(() => { refresh = store.dispatch(authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true, subscribe: false })) })
    await waitFor(() => expect(finishMe).toBeDefined())
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    await act(async () => { finishFriends(json(accepted)) })
    expect(screen.queryByText('Ada Friend')).not.toBeInTheDocument()
    await act(async () => { finishMe(json({ user: { id: '6', username: 'new-person', roles: ['admin'] } })); await refresh })
    expect(screen.queryByText('Ada Friend')).not.toBeInTheDocument()
  })
})
