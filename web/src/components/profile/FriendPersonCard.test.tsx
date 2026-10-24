import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FriendPersonCard } from './FriendPersonCard'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'
import type { Friend } from '@/features/connection/types'

const friend: Friend = { connection_id: 15, person: { id: 8, name: 'Alice Example', username: 'alice space', avatar_url: '/alice.jpg' }, mutual_friends_count: 1, requested_at: null, connected_at: null, note: 'Hello there' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => { vi.unstubAllGlobals(); clearCookies() })
describe('FriendPersonCard', () => {
  it('gives accepted people one name/photo link and truthful mutual count', () => {
    renderWithProviders(<ul><FriendPersonCard mode="accepted" person={friend} /></ul>)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Alice Example' })).toHaveAttribute('href', '/u/alice%20space')
    expect(screen.getByText('1 mutual friend')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('discovery identities never navigate and a crossed request announces accepted canonical state', async () => {
    document.cookie = 'XSRF-TOKEN=test; path=/'
    const complete = vi.fn()
    const fetcher = vi.fn<(request: Request) => Promise<Response>>(async () => json({ connection: { id: 15, state: 'accepted' } }))
    vi.stubGlobal('fetch', fetcher)
    const { container } = renderWithProviders(<ul><FriendPersonCard mode="find" person={{ person: friend.person, mutual_friends_count: 0 }} onComplete={complete} /></ul>)
    expect(container.querySelectorAll('li a, li [tabindex], li img[onclick]')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(complete).toHaveBeenCalledWith(8, 'You are now connected with Alice Example.')
    const request = fetcher.mock.calls[0][0] as unknown as Request
    expect(new URL(request.url).pathname).toBe('/api/connections')
    expect(await request.json()).toEqual({ user_id: 8 })
  })
  it('shows notes, per-card errors and keeps a failed incoming action retryable', async () => {
    document.cookie = 'XSRF-TOKEN=test; path=/'
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Slow down' }, 429)))
    renderWithProviders(<ul><FriendPersonCard mode="incoming" person={friend} /></ul>)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a moment')
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
  })
})
