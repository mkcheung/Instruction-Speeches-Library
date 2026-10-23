import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserMenu } from './UserMenu'
import { authApi } from '@/features/auth/authApi'
import { profileApi } from '@/features/profile/profileApi'
import type { CurrentUser } from '@/features/auth/types'
import type { PublicProfile } from '@/features/profile/types'
import { clearCookies, renderWithProviders } from '@/test/renderWithProviders'

const member: CurrentUser = {
  id: '9004', email: 'member@e2e.test', first_name: 'Milo', last_name: 'Member',
  username: 'e2e-member', display_name: 'Milo Member', email_verified: true, roles: ['member'],
  onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 0, quota_bytes: 1024, uploads_in_flight: 0,
}
const coach: CurrentUser = { ...member, id: '9003', username: 'e2e-coach', display_name: 'Cora Coach' }
const portrait = 'https://media.speechcoach.test/avatars/milo.jpg?signature=one'
const replacement = 'https://media.speechcoach.test/avatars/milo-new.jpg?signature=two'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
function profile(user: CurrentUser, avatar_url: string | null = portrait): PublicProfile {
  return { id: Number(user.id), username: user.username!, display_name: user.display_name,
    pronouns: null, bio: null, location: null, avatar_url }
}
function api({ user = member, readProfile = () => json({ profile: profile(user) }), upload }: {
  user?: CurrentUser
  readProfile?: (username: string) => Response | Promise<Response>
  upload?: () => Response
} = {}) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname === '/api/me') return json({ user })
    if (url.pathname.startsWith('/api/u/')) return readProfile(decodeURIComponent(url.pathname.slice('/api/u/'.length)))
    if (url.pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    if (url.pathname === '/api/avatar' && upload) return upload()
    throw new Error(`Unexpected header request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
function photo(button: HTMLElement) { return button.querySelector('img') }

afterEach(() => { vi.unstubAllGlobals(); clearCookies() })

describe('account header profile photo', () => {
  it('shows the matching saved photo in the circle without changing the account button name', async () => {
    api()
    renderWithProviders(<UserMenu />)
    const button = await screen.findByRole('button', { name: 'Milo Member' })
    await waitFor(() => expect(photo(button)).toHaveAttribute('src', portrait))
    expect(photo(button)).toHaveAttribute('alt', '')
    expect(photo(button)?.parentElement).toHaveClass('rounded-full', 'overflow-hidden', 'size-7')
    expect(photo(button)?.parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(button).toHaveAccessibleName('Milo Member')
    expect(button).not.toHaveTextContent('MM')
  })

  it('keeps initials when the saved profile has no photo', async () => {
    api({ readProfile: () => json({ profile: profile(member, null) }) })
    const { store } = renderWithProviders(<UserMenu />)
    await waitFor(() => expect(profileApi.endpoints.getPublicProfile.select('e2e-member')(store.getState()).status).toBe('fulfilled'))
    const button = screen.getByRole('button', { name: 'Milo Member' })
    expect(photo(button)).toBeNull()
    expect(button).toHaveTextContent('MM')
  })

  it('keeps the account menu usable when the profile request fails', async () => {
    api({ readProfile: () => json({ message: 'Unavailable' }, 503) })
    const { store } = renderWithProviders(<UserMenu />)
    await waitFor(() => expect(profileApi.endpoints.getPublicProfile.select('e2e-member')(store.getState()).status).toBe('rejected'))
    const button = screen.getByRole('button', { name: 'Milo Member' })
    expect(photo(button)).toBeNull()
    expect(button).toHaveTextContent('MM')
    expect(button).toBeEnabled()
  })

  it('does not fetch a public profile before the account has a username', async () => {
    const fetch = api({ user: { ...member, username: null } })
    renderWithProviders(<UserMenu />)
    expect(await screen.findByRole('button', { name: 'Milo Member' })).toHaveTextContent('MM')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...profile(member), id: 9003 },
    { ...profile(member), username: 'e2e-coach' },
  ])('rejects a photo whose returned profile identity does not match the account: %j', async (wrongProfile) => {
    api({ readProfile: () => json({ profile: wrongProfile }) })
    const { store } = renderWithProviders(<UserMenu />)
    await waitFor(() => expect(profileApi.endpoints.getPublicProfile.select('e2e-member')(store.getState()).status).toBe('fulfilled'))
    const button = screen.getByRole('button', { name: 'Milo Member' })
    expect(photo(button)).toBeNull()
    expect(button).toHaveTextContent('MM')
  })

  it('falls back on image failure and picks up a successful avatar upload through the shared cache', async () => {
    let url = portrait
    const fetch = api({
      readProfile: () => json({ profile: profile(member, url) }),
      upload: () => { url = replacement; return json({ user: member }) },
    })
    const { store } = renderWithProviders(<UserMenu />)
    const button = await screen.findByRole('button', { name: 'Milo Member' })
    await waitFor(() => expect(photo(button)).toHaveAttribute('src', portrait))
    fireEvent.error(photo(button)!)
    expect(photo(button)).toBeNull()
    expect(button).toHaveTextContent('MM')
    const formData = new FormData()
    formData.append('avatar', new Blob(['test image'], { type: 'image/jpeg' }), 'avatar.jpg')
    await act(async () => {
      await store.dispatch(profileApi.endpoints.updateOwnAvatar.initiate({ formData, username: 'e2e-member' })).unwrap()
    })
    await waitFor(() => expect(photo(button)).toHaveAttribute('src', replacement))
    expect(button).not.toHaveTextContent('MM')
    expect(fetch.mock.calls.filter(([input]) => (input instanceof Request ? input.url : input.toString()).endsWith('/api/u/e2e-member'))).toHaveLength(2)
  })

  it('removes the previous account photo while the replacement profile is pending', async () => {
    let resolveCoach!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { resolveCoach = resolve })
    api({ readProfile: (username) => username === 'e2e-coach' ? pending : json({ profile: profile(member) }) })
    const { store } = renderWithProviders(<UserMenu />)
    const memberButton = await screen.findByRole('button', { name: 'Milo Member' })
    await waitFor(() => expect(photo(memberButton)).toHaveAttribute('src', portrait))
    await act(async () => { await store.dispatch(authApi.util.upsertQueryData('getMe', undefined, { user: coach })) })
    const coachButton = await screen.findByRole('button', { name: 'Cora Coach' })
    expect(photo(coachButton)).toBeNull()
    expect(coachButton).toHaveTextContent('CC')
    await act(async () => { resolveCoach(json({ profile: profile(coach, replacement) })); await pending })
    await waitFor(() => expect(photo(coachButton)).toHaveAttribute('src', replacement))
  })
})
