import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CurrentUser } from '@/features/auth/types'
import ProfileEdit from '@/routes/ProfileEdit'
import { clearCookies, renderWithProviders } from '@/test/renderWithProviders'

// Exercise the real route, forms and API/cache transitions. Image decoding and
// crop geometry belong to the existing cropper, not to this presentation frame.
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

const INITIAL_PROFILE = {
  id: 1, username: 'member', display_name: 'Milo Member', bio: 'A short biography.',
  pronouns: 'he/him', location: 'Home', avatar_url: null,
}
const MEMBER: CurrentUser = {
  id: '1', email: 'member@example.test', first_name: 'Milo', last_name: 'Member', username: 'member',
  display_name: 'Milo Member', email_verified: true, roles: ['member'], onboarding_completed: true,
  onboarding_step: 4, storage_bytes_used: 0, quota_bytes: 1024, uploads_in_flight: 0,
}
const ME = { user: MEMBER }

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type ProfileOutcome = number | 'network'

function stubApi({
  usernameFails = false,
  avatarFailsOnce = false,
  me = ME as unknown,
  profileOutcomes = [] as ProfileOutcome[],
  profiles = {} as Record<string, unknown>,
} = {}) {
  let profile = { ...INITIAL_PROFILE }
  const profileReads: string[] = []
  let avatarAttempts = 0
  const writes: { path: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const { pathname } = new URL(request.url)
    if (pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (pathname === '/api/me') return response(me)
    if (pathname.startsWith('/api/u/') && request.method === 'GET') {
      profileReads.push(pathname)
      const outcome = profileOutcomes.shift()
      if (outcome === 'network') throw new TypeError('Failed to fetch')
      if (outcome) return response({ message: 'Server said no.' }, outcome)
      if (pathname === '/api/u/member') return response({ profile })
      const other = profiles[pathname.slice('/api/u/'.length)]
      return other ? response({ profile: other }) : response({ message: 'Not found.' }, 404)
    }
    if (pathname === '/api/profile' && request.method === 'PATCH') {
      const body = await request.json()
      writes.push({ path: pathname, body })
      profile = { ...profile, ...body }
      return response(ME)
    }
    if (pathname === '/api/profile/username' && request.method === 'PATCH') {
      writes.push({ path: pathname, body: await request.json() })
      return usernameFails
        ? response({ errors: { username: ['One change allowed every 30 days.'] } }, 422)
        : response(ME)
    }
    if (pathname === '/api/avatar' && request.method === 'POST') {
      writes.push({ path: pathname, body: await request.formData() })
      avatarAttempts += 1
      return avatarFailsOnce && avatarAttempts === 1
        ? response({ message: 'Could not save this photo.' }, 500)
        : response(ME)
    }
    throw new Error(`unexpected fetch: ${request.method} ${pathname}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, writes, profileReads }
}

describe('ProfileEdit notebook integration', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('loads the real own profile once, with one page heading and independently labelled forms', async () => {
    const { fetchMock } = stubApi()
    renderWithProviders(<ProfileEdit />, { route: '/profile' })
    expect(await screen.findByLabelText('Display name')).toHaveValue('Milo Member')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edit profile')
    expect(screen.getByLabelText('Profile photo')).toHaveAttribute('type', 'file')
    expect(screen.getByLabelText('Username')).toHaveValue('member')
    expect(fetchMock.mock.calls.filter(([input]) => (input instanceof Request ? input.url : String(input)).endsWith('/api/me'))).toHaveLength(1)
  })

  it('resets unsaved profile edits and saves only the profile fields without submitting username or photo', async () => {
    const { writes } = stubApi()
    const user = userEvent.setup()
    renderWithProviders(<ProfileEdit />, { route: '/profile' })
    const bio = await screen.findByLabelText('Bio')
    await user.clear(bio)
    await user.type(bio, 'Unsaved draft')
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(bio).toHaveValue('A short biography.')
    await user.clear(bio)
    await user.type(bio, 'Updated biography')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved.')).toHaveAttribute('role', 'status')
    expect(writes).toEqual([{ path: '/api/profile', body: {
      username: 'member', display_name: 'Milo Member', bio: 'Updated biography', pronouns: 'he/him', location: 'Home',
    } }])
  })

  it('keeps the username cooldown error isolated while profile edits remain usable', async () => {
    const { writes } = stubApi({ usernameFails: true })
    const user = userEvent.setup()
    renderWithProviders(<ProfileEdit />, { route: '/profile' })
    const username = await screen.findByLabelText('Username')
    await user.clear(username)
    await user.type(username, 'new-member')
    await user.click(screen.getByRole('button', { name: 'Update username' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('One change allowed every 30 days.')
    expect(username).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Bio')).toHaveValue('A short biography.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(writes).toEqual([{ path: '/api/profile/username', body: { username: 'new-member' } }])
  })

  it('preserves crop cancellation and failed-photo retry without submitting either text form', async () => {
    const { writes } = stubApi({ avatarFailsOnce: true })
    const user = userEvent.setup()
    renderWithProviders(<ProfileEdit />, { route: '/profile' })
    const file = new File(['image'], 'portrait.png', { type: 'image/png' })
    await user.upload(await screen.findByLabelText('Profile photo'), file)
    expect(screen.getByText('portrait.png')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel crop' }))
    expect(screen.getByLabelText('Profile photo')).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    await user.upload(screen.getByLabelText('Profile photo'), file)
    await user.click(screen.getByRole('button', { name: 'Use crop' }))
    expect(await screen.findByText('Could not save this photo.')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Use crop' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Use crop' }))
    await waitFor(() => expect(screen.getByLabelText('Profile photo')).toBeInTheDocument())
    expect(writes.map(({ path }) => path)).toEqual(['/api/avatar', '/api/avatar'])
    const saved = (writes[1].body as FormData).get('avatar') as File
    expect(saved.size).toBeGreaterThan(0)
    expect(saved.type).toBe('image/jpeg')
    expect(screen.getByLabelText('Bio')).toHaveValue('A short biography.')
  })

  describe('profile read failures', () => {
    it('shows an accessible failure with Retry after a 500, never endless Loading, and recovers on retry', async () => {
      const { profileReads } = stubApi({ profileOutcomes: [500] })
      const user = userEvent.setup()
      renderWithProviders(<ProfileEdit />, { route: '/profile' })
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/could not load your profile/i)
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Retry' }))
      expect(await screen.findByLabelText('Display name')).toHaveValue('Milo Member')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(profileReads).toEqual(['/api/u/member', '/api/u/member'])
    })

    it('shows a retryable failure for a network error', async () => {
      stubApi({ profileOutcomes: ['network'] })
      renderWithProviders(<ProfileEdit />, { route: '/profile' })
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    })

    it('distinguishes a profile 404 from a transient failure', async () => {
      stubApi({ profileOutcomes: [404] })
      renderWithProviders(<ProfileEdit />, { route: '/profile' })
      expect(await screen.findByRole('alert')).toHaveTextContent(/profile was not found/i)
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('does not treat a missing username as a network failure', async () => {
      const { profileReads } = stubApi({ me: { user: { ...MEMBER, username: null } } })
      renderWithProviders(<ProfileEdit />, { route: '/profile' })
      expect(await screen.findByText(/choose a username/i)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
      expect(profileReads).toEqual([])
    })

    it('keeps independent username errors working alongside a loaded profile', async () => {
      stubApi({ usernameFails: true })
      const user = userEvent.setup()
      renderWithProviders(<ProfileEdit />, { route: '/profile' })
      await user.type(await screen.findByLabelText('Username'), 'x')
      await user.click(screen.getByRole('button', { name: 'Update username' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('One change allowed every 30 days.')
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    })

    it('accepts a proven viewer fixture whose mocked /me names the same user', async () => {
      stubApi()
      renderWithProviders(<ProfileEdit />, { route: '/profile', viewer: ME.user })
      expect(await screen.findByLabelText('Display name')).toHaveValue('Milo Member')
    })

    it('never shows the previous username profile after the username changes', async () => {
      const other = { ...INITIAL_PROFILE, username: 'renamed', display_name: 'Renamed Person' }
      const { profileReads } = stubApi({ profiles: { renamed: other } })
      const { store } = renderWithProviders(<ProfileEdit />, { route: '/profile' })
      expect(await screen.findByLabelText('Display name')).toHaveValue('Milo Member')
      const { authApi } = await import('@/features/auth/authApi')
      // The account's username changes: /me is refreshed while the new profile read is pending.
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const { pathname } = new URL(request.url)
        if (pathname === '/api/me') return response({ user: { ...ME.user, username: 'renamed' } })
        if (pathname === '/api/u/renamed') {
          profileReads.push(pathname)
          return new Promise<Response>(() => {}) // never settles: pending
        }
        throw new Error(`unexpected fetch: ${pathname}`)
      }))
      await store.dispatch(authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true }))
      await waitFor(() => expect(screen.getByText('Loading…')).toBeInTheDocument())
      expect(screen.queryByDisplayValue('Milo Member')).not.toBeInTheDocument()
    })

    it('does not render another account profile when /me names a different user than the proven viewer', async () => {
      stubApi()
      renderWithProviders(<ProfileEdit />, { route: '/profile', viewer: { ...MEMBER, id: '2', username: 'someone' } })
      await waitFor(() => expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument())
      expect(screen.queryByDisplayValue('Milo Member')).not.toBeInTheDocument()
    })
  })
})
