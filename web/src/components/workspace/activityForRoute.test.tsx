import { render, screen, cleanup } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { navItemsFor, type NavItem } from '@/lib/roles'
import { activityForRoute } from './activityForRoute'

const member = { roles: [], username: 'e2e-member' }
const scenes: Record<string, string> = {
  'My reviews': 'reviews', 'My speeches': 'speeches', 'Find reviewers': 'reviewers',
  'Upload a speech': 'upload', Search: 'search', 'Your profile': 'profile',
  'Edit profile': 'edit', 'Account & privacy': 'account', 'Become a Coach': 'coach',
}

function Probe({ items }: { items: NavItem[] }) {
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    {items.map((item) => item.external
      ? <a key={item.to} href={item.to}>{item.label}</a>
      : <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}
    <output data-testid="scene">{activityForRoute(location.pathname, items) ?? 'none'}</output>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate(1)}>Forward</button>
  </>
}

describe('activityForRoute parity with the installed real NavLink', () => {
  const paths = [
    '/dashboard', '/dashboard/', '/dashboard/nested', '/DASHBOARD', '/speeches',
    '/speeches/', '/SPEECHES', '/speeches/new', '/speeches/new/', '/SPEECHES/NEW',
    '/speeches/new/draft', '/speeches/9', '/speeches/newer', '/reviewers', '/REVIEWERS/',
    '/search', '/SEARCH', '/search/', '/search?q=voice#results', '/searching',
    '/profile', '/profile/edit', '/PROFILE/', '/account', '/account/privacy', '/ACCOUNT/',
    '/become-a-coach', '/become-a-coach/', '/u/e2e-member', '/U/E2E-MEMBER',
    '/u/e2e-member/posts', '/unknown', '/', '/control-panel',
  ]

  it.each(paths)('chooses exactly the scene belonging to the selected NavLink at %s', (path) => {
    render(<MemoryRouter initialEntries={[path]}><Probe items={navItemsFor(member)} /></MemoryRouter>)
    const selected = screen.queryAllByRole('link', { current: 'page' })
    expect(selected.length).toBeLessThanOrEqual(1)
    expect(screen.getByTestId('scene')).toHaveTextContent(selected.length ? scenes[selected[0].textContent!] : 'none')
  })

  it.each([
    { roles: [], username: 'e2e-member' },
    { roles: ['member'], username: 'e2e-member' },
    { roles: ['coach'], username: 'e2e-coach' },
    { roles: ['admin'], username: 'admin' },
    { roles: ['super_admin'], username: 'admin' },
    { roles: [], username: null },
  ])('honors the current visible role inventory %j', (user) => {
    const items = navItemsFor(user)
    for (const path of ['/dashboard', '/reviewers', '/become-a-coach', '/u/e2e-member', '/control-panel']) {
      const view = render(<MemoryRouter initialEntries={[path]}><Probe items={items} /></MemoryRouter>)
      const active = screen.queryAllByRole('link', { current: 'page' })
      expect(screen.getByTestId('scene')).toHaveTextContent(active.length ? scenes[active[0].textContent!] : 'none')
      view.unmount()
    }
  })

  it('follows direct navigation, query/hash changes and Back/Forward without keeping click state', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/search?q=voice#results', '/speeches/9', '/dashboard']} initialIndex={2}>
      <Probe items={navItemsFor(member)} />
    </MemoryRouter>)
    expect(screen.getByTestId('scene')).toHaveTextContent('reviews')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('scene')).toHaveTextContent('none')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('scene')).toHaveTextContent('search')
    await user.click(screen.getByRole('button', { name: 'Forward' }))
    expect(screen.getByTestId('scene')).toHaveTextContent('none')
    await user.click(screen.getByRole('link', { name: 'My speeches' }))
    expect(screen.getByTestId('scene')).toHaveTextContent('speeches')
  })

  it('does not invent artwork for unknown, external or ambiguously selected items', () => {
    const items = navItemsFor(member)
    expect(activityForRoute('/search', [])).toBeNull()
    expect(activityForRoute('/new-page', [{ ...items[0], to: '/new-page' }])).toBeNull()
    expect(activityForRoute('/dashboard', [{ ...items[0], external: true }])).toBeNull()
    expect(activityForRoute('/dashboard', [items[0], { ...items[0], label: 'Duplicate' }])).toBeNull()
  })

  it('keeps parity for a visible destination ending in slash, including prefix boundaries', () => {
    const items = [{ ...navItemsFor(member)[0], to: '/dashboard/' }]
    for (const path of ['/dashboard', '/dashboard/', '/dashboard/nested', '/dashboarding']) {
      render(<MemoryRouter initialEntries={[path]}><Probe items={items} /></MemoryRouter>)
      // This is an unknown inventory destination: helper omits the scene even
      // when NavLink selects it, rather than normalizing a future destination.
      expect(screen.getByTestId('scene')).toHaveTextContent('none')
      expect(screen.queryAllByRole('link', { current: 'page' })).toHaveLength(path.startsWith('/dashboard/') ? 1 : 0)
      cleanup()
    }
  })
})
