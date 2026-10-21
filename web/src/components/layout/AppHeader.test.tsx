import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './AppHeader'
import { renderWithProviders } from '@/test/renderWithProviders'

afterEach(() => vi.unstubAllGlobals())

function mockHeaderData({ unread = 2, pending = 1 } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString()
    let body: unknown
    if (url.endsWith('/api/me')) body = { user: {
      id: '42', first_name: 'Milo', last_name: 'Member', display_name: 'Milo Member',
      roles: [], username: 'e2e-member',
    } }
    else if (url.endsWith('/api/notifications')) body = { notifications: [], unread_count: unread }
    else if (url.includes('/api/connections?state=pending')) body = {
      connections: Array.from({ length: pending }, (_, index) => ({ id: index + 7, peer: { name: 'Cora Coach' } })),
      meta: { next_cursor: null },
    }
    else throw new Error(`unexpected fetch: ${url}`)
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  }))
}

describe('AppHeader workspace chrome', () => {
  it.each([0, 1, 12])('keeps the exact accessible counts and visible badge values for %i notifications and requests', async (count) => {
    mockHeaderData({ unread: count, pending: count })
    const { store } = renderWithProviders(<AppHeader />, { route: '/dashboard' })
    await vi.waitFor(() => {
      expect(Object.values(store.getState().notificationApi.queries).some((query) => query?.status === 'fulfilled')).toBe(true)
      expect(Object.values(store.getState().connectionApi.queries).some((query) => query?.status === 'fulfilled')).toBe(true)
    })
    const notificationName = count ? `Notifications (${count} unread)` : 'Notifications'
    const requestName = count ? `Connection requests (${count} pending)` : 'Connection requests'
    const notifications = screen.getByRole('button', { name: notificationName })
    const requests = screen.getByRole('button', { name: requestName })
    expect(notifications).toHaveAccessibleName(notificationName)
    expect(requests).toHaveAccessibleName(requestName)
    for (const trigger of [notifications, requests]) {
      const badge = trigger.querySelector('[data-slot="badge"]')
      if (count === 0) expect(badge).toBeNull()
      else {
        expect(badge).toBeVisible()
        expect(badge).toHaveTextContent(count > 9 ? '9+' : String(count), { normalizeWhitespace: false })
      }
    }
  })

  it('keeps the static 56px landmark, brand target and all three real named triggers', async () => {
    mockHeaderData()
    renderWithProviders(<AppHeader />, { route: '/dashboard' })
    const header = screen.getByRole('banner')
    expect(header).toHaveClass('workspace-header', 'h-14')
    expect(header.className).not.toMatch(/sticky|fixed/)
    expect(within(header).getByRole('link', { name: 'Instruction Speeches Library' })).toHaveAttribute('href', '/dashboard')
    expect(within(header).getByRole('link')).toHaveClass('workspace-header-brand')
    const account = await screen.findByRole('button', { name: 'Milo Member' })
    const requests = await screen.findByRole('button', { name: 'Connection requests (1 pending)' })
    const notifications = await screen.findByRole('button', { name: 'Notifications (2 unread)' })
    const row = account.parentElement!
    expect(row).toHaveClass('workspace-header-actions')
    expect(Array.from(row.children)).toEqual([requests, notifications, account])
    expect(requests.querySelector('[data-slot="badge"]')).toHaveTextContent('1')
    expect(notifications.querySelector('[data-slot="badge"]')).toHaveTextContent('2')
    const avatar = account.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(avatar).toHaveTextContent('MM')
    expect(avatar.style.backgroundColor).not.toBe('')
    expect(avatar.style.color).not.toBe('')
    expect(within(header).queryByRole('navigation')).toBeNull()
  })

  it('preserves opened controls and the complete account navigation in neutral body portals', async () => {
    mockHeaderData()
    const user = userEvent.setup()
    renderWithProviders(<AppHeader />, { route: '/dashboard' })
    const header = screen.getByRole('banner')
    const notifications = await screen.findByRole('button', { name: 'Notifications (2 unread)' })
    await user.click(notifications)
    expect(notifications).toHaveAttribute('aria-expanded', 'true')
    const notificationPopup = await screen.findByText('No notifications.')
    expect(header).not.toContainElement(notificationPopup)
    await user.keyboard('{Escape}')
    const requests = screen.getByRole('button', { name: 'Connection requests (1 pending)' })
    await user.click(requests)
    expect(requests).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(header).not.toContainElement(screen.getByText('Cora Coach'))
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(requests).toHaveAttribute('aria-expanded', 'false'))
    const account = await screen.findByRole('button', { name: 'Milo Member' })
    account.focus()
    await user.keyboard('{Enter}')
    expect(account).toHaveAttribute('aria-expanded', 'true')
    const menu = await screen.findByRole('menu')
    expect(header).not.toContainElement(menu)
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'My reviews', 'My speeches', 'Find reviewers', 'Upload a speech', 'Search',
      'Your profile', 'Edit profile', 'Account & privacy', 'Become a Coach', 'Log out',
    ])
    expect(within(menu).getByRole('menuitem', { name: 'Your profile' })).toHaveAttribute('href', '/u/e2e-member')
    expect(account.querySelector('span:not([aria-hidden])')).toHaveClass('sr-only', 'sm:not-sr-only')
  })
})
