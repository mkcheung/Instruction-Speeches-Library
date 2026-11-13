import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CurrentUser } from '@/features/auth/types'
import ProfileHome from '@/routes/ProfileHome'
import { friendsResponse, makeFriend } from '@/test/friendsFixtures'
import { clearCookies, renderWithProviders } from '@/test/renderWithProviders'

// Exercise the real route, mutations and cache transitions. Image decoding and
// crop geometry belong to the existing cropper, not to this page.
vi.mock('@/components/onboarding/AvatarCropper', () => ({
  AvatarCropper: ({ file, submitting, onCancel, onCropped }: {
    file: File; submitting: boolean; onCancel: () => void; onCropped: (blob: Blob) => void
  }) => (
    <div aria-label="Photo cropper">
      <span>{file.name}</span>
      <button disabled={submitting} onClick={() => onCropped(new Blob(['cropped'], { type: 'image/jpeg' }))}>Use crop</button>
      <button onClick={onCancel}>Cancel crop</button>
    </div>
  ),
}))

const MEMBER: CurrentUser = {
  id: '1', email: 'member@example.test', first_name: 'Milo', last_name: 'Member', username: 'member',
  display_name: 'Milo Member', email_verified: true, roles: ['member'], onboarding_completed: true,
  onboarding_step: 4, storage_bytes_used: 0, quota_bytes: 1024, uploads_in_flight: 0,
}
const PROFILE = { id: 1, username: 'member', display_name: 'Milo Member', bio: 'A short biography.', location: 'Home', avatar_url: null }
const SAMPLE = friendsResponse([
  makeFriend({ connection_id: 7, person: { id: 9003, username: 'e2e-coach', name: 'Cora Coach' }, mutual_friends_count: 1 }),
  makeFriend({ connection_id: 8, person: { id: 9005, username: 'e2e-coach-b', name: 'Bram Bystander' }, mutual_friends_count: 0 }),
], { total: 12 })
const REQUEST = makeFriend({
  connection_id: 42, person: { id: 142, username: 'dana', name: 'Dana Reyes' },
  requested_at: '2026-11-10T09:00:00Z', note: 'Loved your toast.',
})
const INVITATION = {
  id: 77, status: 'invited', invitation_message: 'Could you look at the pacing?', allow_preview: false,
  prior_commentary_shared: false, invited_at: '2026-11-09T09:00:00Z', responded_at: null, first_published_at: null,
  last_published_at: null, last_transition_at: '2026-11-09T09:00:00Z', revoked_at: null, revocation_reason: null,
  speech: { id: 501, ulid: '01JTESTSPEECHULID0000000000', title: 'Best-man toast, draft 2', owner_name: 'Jordan Okafor' },
}
const PUBLISHED = {
  id: 'n1', type: 'review.published', read_at: null, created_at: '2026-11-11T09:00:00Z',
  data: { type: 'review.published', review_id: 3, speech_id: 8, speech_title: 'Test Unit', actor_name: 'Cora Coach', url: '/speeches/8' },
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubApi({
  me = { user: MEMBER } as unknown,
  usernameRefusal = null as string | null,
  notifications = [PUBLISHED] as unknown[] | 'pending',
  profileStatuses = [] as number[],
  openRequests = true,
} = {}) {
  let profile = { ...PROFILE }
  let requestOpen = openRequests
  let invitationOpen = openRequests
  const writes: { method: string; path: string; body?: unknown }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const { pathname, searchParams } = new URL(request.url)
    const { method } = request
    if (pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (pathname === '/api/me') return response(me)
    if (method === 'GET' && pathname === '/api/u/member') {
      const status = profileStatuses.shift()
      return status ? response({ message: 'Server said no.' }, status) : response({ profile })
    }
    if (method === 'GET' && pathname === '/api/friends/sample') return response(SAMPLE)
    if (method === 'GET' && pathname === '/api/friends' && searchParams.get('view') === 'incoming') {
      return response(friendsResponse(requestOpen ? [REQUEST] : []))
    }
    if (method === 'GET' && pathname === '/api/reviews') {
      return response({ invited: invitationOpen ? [INVITATION] : [], in_progress: [], published: [], revoked: [] })
    }
    if (method === 'GET' && pathname === '/api/notifications') {
      if (notifications === 'pending') return new Promise<Response>(() => {})
      return response({ notifications, unread_count: notifications.length })
    }
    if (method === 'GET' && pathname === '/api/speeches') return response({ speeches: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    if (method === 'PATCH' && pathname === '/api/profile') {
      const body = await request.json()
      writes.push({ method, path: pathname, body })
      profile = { ...profile, ...body }
      return response(me)
    }
    if (method === 'PATCH' && pathname === '/api/profile/username') {
      writes.push({ method, path: pathname, body: await request.json() })
      return usernameRefusal
        ? response({ message: usernameRefusal, errors: { username: [usernameRefusal] } }, 422)
        : response(me)
    }
    if (method === 'POST') {
      writes.push({ method, path: pathname })
      if (pathname === '/api/avatar') return response(me)
      if (pathname === '/api/connections/42/accept') {
        requestOpen = false
        return response({ connection: { id: 42, state: 'accepted' } })
      }
      if (pathname === '/api/reviews/77/accept') {
        invitationOpen = false
        return response({ review: { ...INVITATION, status: 'accepted' } })
      }
      if (pathname === '/api/notifications/n1/read') return new Response(null, { status: 204 })
    }
    throw new Error(`unexpected fetch: ${method} ${pathname}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, writes }
}

describe('ProfileHome', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('shows the profile view beside a random friends card, with icon tabs and no pronouns', async () => {
    stubApi()
    renderWithProviders(<ProfileHome />, { route: '/profile' })
    expect(await screen.findByRole('button', { name: /^Edit display name: Milo Member/ })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your profile')

    const tabs = screen.getByRole('navigation', { name: 'Your profile home' })
    expect(within(tabs).getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
    expect(await within(tabs).findByRole('link', { name: 'Feed (2 waiting)' })).toHaveAttribute('href', '/profile/feed')

    const friends = await screen.findByRole('complementary', { name: 'Friends' })
    expect(await within(friends).findByText('12 friends')).toBeInTheDocument()
    expect(within(friends).getByRole('link', { name: 'Cora Coach' })).toHaveAttribute('href', '/u/e2e-coach')
    expect(within(friends).getByRole('link', { name: 'Bram Bystander' })).toHaveAttribute('href', '/u/e2e-coach-b')
    expect(within(friends).getByRole('link', { name: 'See all friends' })).toHaveAttribute('href', '/u/member/friends/all')

    expect(screen.getByRole('button', { name: /^Edit username: @member/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Edit bio: A short biography\./ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Edit location: Home/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View your page as others see it' })).toHaveAttribute('href', '/u/member')
    expect(screen.queryByText(/pronoun/i)).toBeNull()
  })

  it('edits the display name in place, refuses an empty one and saves only that field', async () => {
    const { fetchMock, writes } = stubApi()
    const user = userEvent.setup()
    renderWithProviders(<ProfileHome />, { route: '/profile' })
    await user.click(await screen.findByRole('button', { name: /^Edit display name/ }))
    const input = screen.getByLabelText('Display name')
    expect(input).toHaveValue('Milo Member')
    expect(input).toHaveFocus()

    await user.clear(input)
    expect(screen.getByRole('alert')).toHaveTextContent('Display name is required.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.type(input, 'Milo M.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: /^Edit display name: Milo M\./ })).toHaveFocus()
    expect(screen.getByText('Display name saved.')).toBeInTheDocument()
    expect(writes).toEqual([{ method: 'PATCH', path: '/api/profile', body: { display_name: 'Milo M.', username: 'member' } }])

    // The save re-checks /api/me; the friends beside the form neither vanish nor reshuffle.
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).endsWith('/api/me'))).toHaveLength(2))
    expect(screen.getByRole('complementary', { name: 'Friends' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('/api/friends/sample'))).toHaveLength(1)
  })

  it('checks a username as it is typed and keeps the editor open when the server refuses it', async () => {
    const refusal = 'You can change your username again on December 12, 2026.'
    const { writes } = stubApi({ usernameRefusal: refusal })
    const user = userEvent.setup()
    renderWithProviders(<ProfileHome />, { route: '/profile' })
    await user.click(await screen.findByRole('button', { name: /^Edit username/ }))
    const input = screen.getByLabelText('Username')
    expect(screen.getByText('You can change your username once every 30 days.')).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'Milo M')
    expect(screen.getByRole('alert')).toHaveTextContent('Usernames cannot contain spaces.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Milo-M')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Your page moves to /u/milo-m. Links to /u/member will stop working.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal)
    expect(screen.getByLabelText('Username')).toHaveValue('Milo-M')
    expect(writes).toEqual([{ method: 'PATCH', path: '/api/profile/username', body: { username: 'milo-m' } }])

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: /^Edit username: @member/ })).toHaveFocus()
  })

  it('names no reviewer in the watch link when the commentary has no actor name', async () => {
    stubApi({ notifications: [{ ...PUBLISHED, data: { ...PUBLISHED.data, actor_name: null } }] })
    renderWithProviders(<ProfileHome />, { route: '/profile/feed' })
    const commentary = await screen.findByRole('article', { name: 'Commentary from A reviewer' })
    expect(within(commentary).getByRole('link', { name: 'Watch the commentary' })).toHaveAttribute('href', '/speeches/8?review=3')
  })

  it('lists requests and commentary newest first and answers them without leaving the feed', async () => {
    const { writes } = stubApi()
    const user = userEvent.setup()
    renderWithProviders(<ProfileHome />, { route: '/profile/feed' })
    const feed = await screen.findByRole('region', { name: 'Feed' })
    await within(feed).findByRole('article', { name: 'Commentary from Cora Coach' })
    await within(feed).findByRole('article', { name: 'Friend request from Dana Reyes' })
    await within(feed).findByRole('article', { name: 'Review request from Jordan Okafor' })
    expect(within(feed).getAllByRole('article').map((article) => article.getAttribute('aria-label'))).toEqual([
      'Commentary from Cora Coach', 'Friend request from Dana Reyes', 'Review request from Jordan Okafor',
    ])
    const watch = within(feed).getByRole('link', { name: 'Watch with Cora’s commentary' })
    expect(watch).toHaveAttribute('href', '/speeches/8?review=3')

    const request = within(feed).getByRole('article', { name: 'Friend request from Dana Reyes' })
    await user.click(within(request).getByRole('button', { name: 'Accept' }))
    expect(await within(request).findByText('You and Dana Reyes are friends now.')).toBeInTheDocument()

    const invitation = within(feed).getByRole('article', { name: 'Review request from Jordan Okafor' })
    await user.click(within(invitation).getByRole('button', { name: 'Accept' }))
    expect(await within(invitation).findByText(/^Accepted\. It’s in/)).toBeInTheDocument()
    expect(within(invitation).getByRole('link', { name: 'My reviews' })).toHaveAttribute('href', '/dashboard')

    // Both answered cards stay put after the server stops listing them.
    await waitFor(() => expect(within(feed).getAllByRole('article')).toHaveLength(3))
    await user.click(watch)
    await waitFor(() => expect(writes.map((write) => write.path)).toEqual([
      '/api/connections/42/accept', '/api/reviews/77/accept', '/api/notifications/n1/read',
    ]))
  })

  it('replaces the photo through the cropper without saving any text field', async () => {
    const { writes } = stubApi()
    const user = userEvent.setup()
    renderWithProviders(<ProfileHome />, { route: '/profile' })
    await user.upload(await screen.findByLabelText('Change photo'), new File(['x'], 'portrait.png', { type: 'image/png' }))
    expect(screen.getByLabelText('Photo cropper')).toHaveTextContent('portrait.png')
    await user.click(screen.getByRole('button', { name: 'Use crop' }))
    expect(await screen.findByText('Photo saved.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Photo cropper')).toBeNull()
    expect(writes).toEqual([{ method: 'POST', path: '/api/avatar' }])
  })

  it('gives an admin the editable profile without friends or the feed', async () => {
    stubApi({ me: { user: { ...MEMBER, roles: ['admin'] } } })
    renderWithProviders(<ProfileHome />, { route: '/profile/feed' })
    expect(await screen.findByRole('button', { name: /^Edit display name/ })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Your profile home' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Friends' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Feed' })).toBeNull()
  })

  it('waits for every feed source before saying there is nothing new', async () => {
    stubApi({ openRequests: false, notifications: 'pending' })
    const { store } = renderWithProviders(<ProfileHome />, { route: '/profile/feed' })
    const answered = (queries: Record<string, { status?: string } | undefined>) => Object.values(queries).some((query) => query?.status === 'fulfilled')
    await vi.waitFor(() => {
      const state = store.getState()
      expect(answered(state.connectionApi.queries) && answered(state.reviewApi.queries)).toBe(true)
    })
    // No friend requests and no invitations yet, but commentary hasn't answered.
    expect(await screen.findByText('Loading your feed…')).toBeInTheDocument()
    expect(screen.queryByText(/^Nothing new\./)).toBeNull()
  })

  it('shows a retryable failure when the profile read fails, never endless Loading, and recovers', async () => {
    stubApi({ profileStatuses: [500] })
    const user = userEvent.setup()
    renderWithProviders(<ProfileHome />, { route: '/profile' })
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your profile.')
    expect(screen.queryByText('Loading…')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: /^Edit display name: Milo Member/ })).toBeInTheDocument()
    expect(screen.queryByText('We could not load your profile.')).toBeNull()
  })

  it('distinguishes a missing profile from a transient failure', async () => {
    stubApi({ profileStatuses: [404] })
    renderWithProviders(<ProfileHome />, { route: '/profile' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Your profile was not found.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('does not render another account profile when /me names a different user than the proven viewer', async () => {
    const { fetchMock } = stubApi()
    const { store } = renderWithProviders(<ProfileHome />, { route: '/profile', viewer: { ...MEMBER, id: '2', username: 'someone' } })
    // Wait until /me has answered (naming member 1), so the page has had its chance to render the profile.
    await vi.waitFor(() => expect(Object.values(store.getState().authApi.queries).some((query) => query?.status === 'fulfilled')).toBe(true))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input instanceof Request ? input.url : input).includes('/api/u/'))).toBe(false)
    expect(screen.queryByRole('button', { name: /^Edit display name/ })).toBeNull()
    expect(screen.queryByText('Milo Member')).toBeNull()
  })

  it('asks an account without a username to finish onboarding first', async () => {
    stubApi({ me: { user: { ...MEMBER, username: null } } })
    renderWithProviders(<ProfileHome />, { route: '/profile' })
    expect(await screen.findByRole('link', { name: 'Finish setting up your account' })).toHaveAttribute('href', '/onboarding')
    expect(screen.queryByRole('button', { name: /^Edit display name/ })).toBeNull()
  })
})
