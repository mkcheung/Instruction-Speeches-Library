import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const ME = { user: { id: '1', username: 'member', roles: ['member'] } }

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubApi({ usernameFails = false, avatarFailsOnce = false } = {}) {
  let profile = { ...INITIAL_PROFILE }
  let avatarAttempts = 0
  const writes: { path: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const { pathname } = new URL(request.url)
    if (pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (pathname === '/api/me') return response(ME)
    if (pathname === '/api/u/member') return response({ profile })
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
  return { fetchMock, writes }
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
})
