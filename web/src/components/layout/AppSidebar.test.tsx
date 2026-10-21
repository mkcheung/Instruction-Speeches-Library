import { act, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppSidebar } from './AppSidebar'
import { createTestStore, renderWithProviders } from '@/test/renderWithProviders'
import { navItemsFor } from '@/lib/roles'

function mockIdentity(roles: string[] = [], username: string | null = 'e2e-member') {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user: { roles, username } }), {
      headers: { 'Content-Type': 'application/json' },
    })
    throw new Error(`unexpected fetch: ${url}`)
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('AppSidebar workspace navigation', () => {
  it.each([
    { roles: [], username: 'e2e-member' },
    { roles: ['member'], username: 'e2e-member' },
    { roles: ['coach'], username: 'e2e-coach' },
    { roles: ['admin'], username: 'admin' },
    { roles: ['super_admin'], username: 'admin' },
    { roles: [], username: null },
  ])('retains the sole role-based link inventory for %j', async (identity) => {
    mockIdentity(identity.roles, identity.username)
    const { store, container } = renderWithProviders(<AppSidebar />, { route: '/dashboard' })
    await vi.waitFor(() => expect(Object.values(store.getState().authApi.queries)[0]?.status).toBe('fulfilled'))
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const links = within(nav).getAllByRole('link')
    const items = navItemsFor(identity)
    expect(links.map((link) => link.textContent)).toEqual(items.map((item) => item.label))
    expect(links.map((link) => link.getAttribute('href'))).toEqual(items.map((item) => item.to))
    expect(nav).toHaveClass('workspace-sidebar', 'hidden', 'w-56', 'md:flex', 'xl:w-64')
    links.forEach((link) => {
      expect(link).toHaveClass('workspace-sidebar-link')
      expect(link.querySelector('svg')).not.toBeNull()
    })
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent('My reviews')
    const frame = container.querySelector('[data-workspace-scene="reviews"]')
    expect(frame).toHaveAttribute('aria-hidden', 'true')
    expect(nav.lastElementChild).toBe(frame)
    if (identity.roles.some((role) => role === 'admin' || role === 'super_admin')) {
      expect(within(nav).getByRole('link', { name: 'Admin panel' })).toHaveAttribute('rel', 'noreferrer')
      expect(within(nav).queryByRole('link', { name: 'Find reviewers' })).toBeNull()
    }
  })

  it.each([
    ['/dashboard', 'My reviews', 'reviews'],
    ['/DASHBOARD/', 'My reviews', 'reviews'],
    ['/speeches', 'My speeches', 'speeches'],
    ['/SPEECHES', 'My speeches', 'speeches'],
    ['/speeches/', null, null],
    ['/speeches/new', 'Upload a speech', 'upload'],
    ['/SPEECHES/NEW/', 'Upload a speech', 'upload'],
    ['/speeches/new/draft', 'Upload a speech', 'upload'],
    ['/speeches/9', null, null],
    ['/speeches/newer', null, null],
    ['/search?q=voice#results', 'Search', 'search'],
    ['/SEARCH/', 'Search', 'search'],
    ['/searching', null, null],
    ['/account/privacy', 'Account & privacy', 'account'],
    ['/profile/settings', 'Edit profile', 'edit'],
    ['/unknown', null, null],
  ])('keeps the actual selected link and scene aligned at %s', async (route, label, scene) => {
    mockIdentity()
    const { container, store } = renderWithProviders(<AppSidebar />, { route })
    await vi.waitFor(() => expect(Object.values(store.getState().authApi.queries)[0]?.status).toBe('fulfilled'))
    const selected = screen.queryAllByRole('link', { current: 'page' })
    expect(selected).toHaveLength(label ? 1 : 0)
    if (label) expect(selected[0]).toHaveTextContent(label)
    const frame = container.querySelector('[data-workspace-scene]')
    if (scene) expect(frame).toHaveAttribute('data-workspace-scene', scene)
    else expect(frame).toBeNull()
  })

  it('follows route history rather than retaining the last clicked scene', async () => {
    mockIdentity()
    const user = userEvent.setup()
    const { container, router } = renderWithProviders(<AppSidebar />, { route: '/dashboard' })
    await user.click(screen.getByRole('link', { name: 'Search' }))
    expect(container.querySelector('[data-workspace-scene]')).toHaveAttribute('data-workspace-scene', 'search')
    await act(() => router.navigate('/speeches/9'))
    expect(container.querySelector('[data-workspace-scene]')).toBeNull()
    await act(() => router.navigate(-1))
    expect(container.querySelector('[data-workspace-scene]')).toHaveAttribute('data-workspace-scene', 'search')
    await act(() => router.navigate(-1))
    expect(container.querySelector('[data-workspace-scene]')).toHaveAttribute('data-workspace-scene', 'reviews')
    await act(() => router.navigate(1))
    expect(container.querySelector('[data-workspace-scene]')).toHaveAttribute('data-workspace-scene', 'search')
  })

  it('leaves the shell on the existing public-profile destination', async () => {
    mockIdentity()
    const router = createMemoryRouter([
      { path: '/dashboard', element: <AppSidebar /> },
      { path: '/u/:username', element: <h1>Public profile</h1> },
    ], { initialEntries: ['/dashboard'] })
    const user = userEvent.setup()
    const { container } = render(<Provider store={createTestStore()}><RouterProvider router={router} /></Provider>)
    await user.click(await screen.findByRole('link', { name: 'Your profile' }))
    expect(screen.getByRole('heading', { name: 'Public profile' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(container.querySelector('[data-workspace-scene]')).toBeNull()
  })
})
