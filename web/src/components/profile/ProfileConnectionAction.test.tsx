import { Route, Routes } from 'react-router-dom'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PublicProfile from '@/routes/PublicProfile'
import ProfileAbout from '@/routes/ProfileAbout'
import { connectionApi } from '@/features/connection/connectionApi'
import { authApi } from '@/features/auth/authApi'
import type { FriendRelationship } from '@/features/connection/types'
import { clearCookies, renderWithProviders } from '@/test/renderWithProviders'

const none: FriendRelationship = { state: 'none', direction: null, connection_id: null, connected_at: null }
const accepted: FriendRelationship = { state: 'accepted', direction: null, connection_id: 901, connected_at: '2026-03-15T00:00:00Z' }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
function setup(initial: FriendRelationship = none) {
  let relationship = initial
  let relationshipStatus = 200
  let blockStatus = 200
  let slow: Promise<Response> | null = null
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input.toString())
    const url = new URL(request.url)
    if (url.pathname === '/api/me') return json({ user: { id: '7', username: 'viewer', roles: [] } })
    if (url.pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (url.pathname.startsWith('/api/u/')) return json({ profile: { id: url.pathname.endsWith('far-friend') ? 45 : 46, username: url.pathname.split('/').at(-1), display_name: 'Friend beyond page one', avatar_url: null } })
    if (url.pathname.startsWith('/api/friends/relationship/')) return slow ?? json({ relationship }, relationshipStatus)
    if (url.pathname === '/api/friends') return json({ friends: Array.from({ length: 20 }, (_, index) => ({ connection_id: index+1, person: { id: index+100, username: 'listed-'+index, name: 'Listed friend '+index, avatar_url: null }, mutual_friends_count: 0 })), meta: { total: 58, next_cursor: 'second-page' } })
    if (url.pathname === '/api/connections/901/block') {
      if (blockStatus === 200) relationship = { ...none, state: 'unavailable' }
      return json({ connection: { id: 901, state: 'blocked' } }, blockStatus)
    }
    if (url.pathname === '/api/connections' && request.method === 'POST') {
      relationship = { ...none, state: 'pending', direction: 'outgoing', connection_id: 902 }
      return json({ connection: { id: 902, state: 'pending' } }, 201)
    }
    throw new Error('Unexpected request: '+url)
  })
  vi.stubGlobal('fetch', fetch)
  const rendered = renderWithProviders(<Routes><Route path="/u/:username" element={<PublicProfile />}><Route index element={<ProfileAbout />} /></Route></Routes>, { route: '/u/far-friend' })
  return { ...rendered, fetch, setStatus: (value: number) => { relationshipStatus = value }, setBlockStatus: (value: number) => { blockStatus = value }, setSlow: (value: Promise<Response> | null) => { slow = value } }
}
beforeEach(clearCookies)
afterEach(() => { clearCookies(); vi.unstubAllGlobals() })
describe('ProfileConnectionAction with current session and targeted relationship', () => {
  it('preserves connected since and the viewer-owned block action beyond the first accepted page', async () => {
    const user = userEvent.setup()
    const { fetch } = setup(accepted)
    expect(await screen.findByText('Connected since Mar 2026')).toBeVisible()
    expect(within(screen.getByRole('complementary', { name: 'Your connections' })).getAllByRole('listitem')).toHaveLength(20)
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Block' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^Block$/ }))
    await screen.findByText('Connection unavailable.')
    expect(fetch.mock.calls.some(([input]) => (input instanceof Request ? input.url : input.toString()).endsWith('/api/connections/901/block'))).toBe(true)
  })
  it('keeps a failed block confirmation open and retryable', async () => {
    const user = userEvent.setup()
    const app = setup(accepted)
    app.setBlockStatus(500)
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Block' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^Block$/ }))
    expect(await within(dialog).findByText('Unable to connect. Check your connection and try again.')).toBeVisible()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Block$/ })).toBeEnabled())
    app.setBlockStatus(200)
    await user.click(within(dialog).getByRole('button', { name: /^Block$/ }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
  it('retains block failure feedback when relationship refresh also fails, requiring refresh before retry', async () => {
    const user = userEvent.setup()
    const app = setup(accepted)
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Block' }))
    app.setBlockStatus(500)
    app.setStatus(500)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^Block$/ }))
    await within(dialog).findByRole('button', { name: 'Retry relationship' })
    expect(screen.getByRole('alertdialog')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: /^Block$/ })).toBeDisabled()
    app.setStatus(200)
    await user.click(within(dialog).getByRole('button', { name: 'Retry relationship' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Block$/ })).toBeEnabled())
  })
  it.each(['incoming', 'outgoing'] as const)('shows correct %s pending state instead of another send action', async (direction) => {
    setup({ ...none, state: 'pending', direction, connection_id: 71 })
    if (direction === 'incoming') expect(await screen.findByRole('link', { name: 'View friend request' })).toHaveAttribute('href', '/u/viewer/friends/requests')
    else expect(await screen.findByText('Request sent')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  })
  it('reports a relationship lookup error with retry and never interprets it as none', async () => {
    const user = userEvent.setup()
    const app = setup(none)
    app.setStatus(500)
    expect(await screen.findByRole('button', { name: 'Retry relationship' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    app.setStatus(200)
    await user.click(screen.getByRole('button', { name: 'Retry relationship' }))
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeEnabled()
  })
  it('reconciles outgoing to incoming after a refresh without a send action', async () => {
    let finish!: (value: Response) => void
    const app = setup({ ...none, state: 'pending', direction: 'outgoing', connection_id: 71 })
    await screen.findByText('Request sent')
    app.setSlow(new Promise<Response>((resolve) => { finish = resolve }))
    act(() => { app.store.dispatch(connectionApi.util.invalidateTags(['FriendRelationship'])) })
    await waitFor(() => expect(Object.values(app.store.getState().connectionApi.queries).some((query) => query?.endpointName === 'getFriendRelationship' && query.status === 'pending')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    await act(async () => { finish(json({ relationship: { ...none, state: 'pending', direction: 'incoming', connection_id: 71 } })) })
    expect(await screen.findByRole('link', { name: 'View friend request' })).toHaveAttribute('href', '/u/viewer/friends/requests')
  })
  it('disables an open request form during refresh and removes it when server state changes', async () => {
    let finish!: (value: Response) => void
    const user = userEvent.setup()
    const app = setup(none)
    await user.click(await screen.findByRole('button', { name: 'Connect' }))
    await user.type(screen.getByPlaceholderText('Say hello…'), 'Hello')
    app.setSlow(new Promise<Response>((resolve) => { finish = resolve }))
    act(() => { app.store.dispatch(connectionApi.util.invalidateTags(['FriendRelationship'])) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled())
    await act(async () => { finish(json({ relationship: { ...none, state: 'pending', direction: 'outgoing', connection_id: 71 } })) })
    await screen.findByText('Request sent')
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument()
  })
  it('discards the old draft when changing target profiles', async () => {
    const user = userEvent.setup()
    const app = setup(none)
    await user.click(await screen.findByRole('button', { name: 'Connect' }))
    await user.type(screen.getByPlaceholderText('Say hello…'), 'First person only')
    await act(async () => { await app.router.navigate('/u/someone-else') })
    await screen.findByText('@someone-else')
    expect(screen.queryByDisplayValue('First person only')).not.toBeInTheDocument()
  })
  it('hides pending state and all actions after an admin account switch', async () => {
    const app = setup({ ...none, state: 'pending', direction: 'outgoing', connection_id: 71 })
    await screen.findByText('Request sent')
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if ((input instanceof Request ? input.url : input.toString()).endsWith('/api/me')) return json({ user: { id: '8', username: 'admin', roles: ['member', 'admin'] } })
      return originalFetch(input)
    }))
    await act(async () => { await app.store.dispatch(authApi.endpoints.getMe.initiate(undefined, { subscribe: false, forceRefetch: true })) })
    expect(screen.queryByText('Request sent')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  })
})
