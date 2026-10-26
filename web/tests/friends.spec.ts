import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createFriendsFixture, FRIENDS_APP_URL as APP, FRIENDS_API_URL as API, friendPost, loginFriend } from './friends-fixtures.js'
import { xsrfHeaders } from './xsrf-headers.js'

/** Real HTTP + real PostgreSQL. Opt in with an explicitly isolated database
 * wrapper; normal E2E setup/auth dependencies remain unchanged in the repository.
 * A standalone local run can use a temporary config and these fresh form logins,
 * avoiding the shared setup's hard-coded development origins/accounts. */
test.skip(!process.env.FRIENDS_VERIFY_WRAPPER, 'Requires the isolated Friends validation stack.')
test.setTimeout(90_000)

for (const [alias, stored] of [['bjørn', 'bjorn'], ['straße', 'strasse']] as const) {
  test(`server-canonical ${alias} profile redirects preserve private route, query and hash`, async ({ page }) => {
    const fixture = createFriendsFixture()
    await loginFriend(page, fixture.alex)
    const username = `${stored}-${fixture.alex.username}`
    const response = await page.context().request.patch(`${API}/api/profile/username`, {
      headers: { Accept: 'application/json', Origin: APP, ...await xsrfHeaders(page.context(), API) },
      data: { username },
    })
    expect(response.status()).toBe(200)
    await page.goto(`${APP}/u/${encodeURIComponent(`${alias}-${fixture.alex.username}`)}/friends/all?from=canonical#friends`)
    await expect(page).toHaveURL(`${APP}/u/${username}/friends/all?from=canonical#friends`)
    await expect(page.getByRole('heading', { level: 1, name: fixture.alex.name })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Your friends', exact: true })).toBeVisible()
  })
}

test('friends default to accepted people, paginate cached pages and search beyond the first page', async ({ page }) => {
  const fixture = createFriendsFixture(true)
  await loginFriend(page, fixture.alex)
  await page.goto(`${APP}/u/${fixture.alex.username}/friends`)
  await expect(page).toHaveURL(`${APP}/u/${fixture.alex.username}/friends/all`)
  const list = page.getByRole('list', { name: 'Your friends', exact: true })
  await expect(list.getByRole('listitem')).toHaveCount(20)
  await expect(page.getByText('25 friends', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(5)
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(20)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(5)
  await expect(page.getByText('Page 2', { exact: true })).toBeVisible()
  const hiddenOnFirstPage = fixture.extra[0]
  await page.getByRole('searchbox', { name: 'Search your friends by name' }).fill(hiddenOnFirstPage.name.toUpperCase())
  await expect(list.getByRole('listitem')).toHaveCount(1)
  const link = list.getByRole('link', { name: hiddenOnFirstPage.name, exact: true })
  await link.click()
  await expect(page).toHaveURL(`${APP}/u/${hiddenOnFirstPage.username}`)
  await expect(page.getByRole('heading', { level: 1, name: hiddenOnFirstPage.name })).toBeVisible()
  await expect(page.getByText(/Connected since/)).toBeVisible()
})

test('Enter-only discovery sends a request and a separate recipient accepts or declines incoming cards', async ({ browser }) => {
  const fixture = createFriendsFixture()
  const a = await browser.newContext()
  const b = await browser.newContext()
  try {
    const sender = await a.newPage(), recipient = await b.newPage()
    await loginFriend(sender, fixture.alex)
    await loginFriend(recipient, fixture.casey)
    await sender.goto(`${APP}/u/${fixture.alex.username}/friends/find`)
    const searches: string[] = []
    sender.on('request', (request) => { if (request.url().includes('/api/friends/find')) searches.push(request.url()) })
    await expect(sender.getByText('Enter a name to find people.', { exact: true })).toBeVisible()
    const input = sender.getByRole('searchbox', { name: 'Find people by name' })
    await input.fill(fixture.casey.name.toLowerCase())
    // The visible pre-submit state and absence of a search network request are both asserted.
    await expect(sender.getByText('Enter a name to find people.', { exact: true })).toBeVisible()
    expect(searches).toHaveLength(0)
    await input.press('Enter')
    const results = sender.getByRole('list', { name: 'Find friends', exact: true })
    await expect(results.getByRole('listitem')).toHaveCount(1)
    await expect(results.getByText('1 mutual friend', { exact: true })).toBeVisible()
    await expect(results.getByRole('link')).toHaveCount(0)
    await results.getByRole('button', { name: 'Send request', exact: true }).click()
    await expect(sender.getByText(`Request sent to ${fixture.casey.name}.`, { exact: true })).toBeVisible()

    // The header's own focus refresh discovers the other context's request.
    await recipient.evaluate(() => window.dispatchEvent(new Event('focus')))
    const bell = recipient.getByRole('button', { name: 'Connection requests (2 pending)', exact: true })
    await expect(bell).toBeVisible()
    await bell.click()
    await recipient.getByRole('link', { name: 'View all requests', exact: true }).click()
    await expect(recipient).toHaveURL(`${APP}/u/${fixture.casey.username}/friends/requests`)
    const incoming = recipient.getByRole('list', { name: 'Friend requests', exact: true })
    await expect(incoming.getByRole('listitem')).toHaveCount(2)
    await expect(incoming.getByText(fixture.owen.name, { exact: true })).toHaveCount(0)
    await incoming.getByRole('listitem').filter({ hasText: fixture.drew.name }).getByRole('button', { name: 'Decline', exact: true }).click()
    await expect(recipient.getByText(`Request from ${fixture.drew.name} declined.`, { exact: true })).toBeVisible()
    await incoming.getByRole('listitem').filter({ hasText: fixture.alex.name }).getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(recipient.getByText(`You are now connected with ${fixture.alex.name}.`, { exact: true })).toBeVisible()
    await expect(incoming.getByRole('listitem')).toHaveCount(0)
    await recipient.getByRole('navigation', { name: 'Friends sections' }).getByRole('link', { name: 'Your friends', exact: true }).click()
    await recipient.getByRole('list', { name: 'Your friends', exact: true }).getByRole('link', { name: fixture.alex.name, exact: true }).click()
    await expect(recipient).toHaveURL(`${APP}/u/${fixture.alex.username}`)
    await expect(recipient.getByText(/Connected since/)).toBeVisible()
    await sender.goto(`${APP}/u/${fixture.alex.username}/friends/all`)
    await expect(sender.getByRole('list', { name: 'Your friends', exact: true }).getByRole('link', { name: fixture.casey.name, exact: true })).toBeVisible()
  } finally { await a.close(); await b.close() }
})

test('administrative targets never appear in discovery and direct requests cannot bypass the exclusion', async ({ page }) => {
  const fixture = createFriendsFixture()
  await loginFriend(page, fixture.alex)
  await page.goto(`${APP}/u/${fixture.alex.username}/friends/find`)
  const input = page.getByRole('searchbox', { name: 'Find people by name' })
  for (const target of [fixture.admin, fixture.super]) {
    await input.fill(target.name.toUpperCase())
    await input.press('Enter')
    await expect(page.getByText('No people match this name.', { exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Find friends', exact: true }).getByRole('listitem')).toHaveCount(0)
    expect((await friendPost(page.context(), '/api/connections', { user_id: target.id })).status()).toBe(404)
  }
})

test('nonowners cannot open private Friends, anonymous profiles stay public and expired sessions leave Friends', async ({ browser }) => {
  const fixture = createFriendsFixture()
  const owner = await browser.newContext(), anonymous = await browser.newContext()
  try {
    const page = await owner.newPage(), guest = await anonymous.newPage()
    await guest.goto(`${APP}/u/${fixture.alex.username}`)
    await expect(guest.getByRole('heading', { level: 1, name: fixture.alex.name })).toBeVisible()
    await expect(guest.getByRole('navigation', { name: 'Profile sections' }).getByRole('link')).toHaveCount(3)
    await guest.goto(`${APP}/u/${fixture.alex.username}/friends/all`)
    await expect(guest).toHaveURL(`${APP}/login`)
    await loginFriend(page, fixture.alex)
    const privateReads: string[] = []
    page.on('request', (request) => { if (/\/api\/friends(?:\?|$)/.test(request.url())) privateReads.push(request.url()) })
    await page.goto(`${APP}/u/${fixture.casey.username}/friends/all`)
    await expect(page.getByText('Friends are unavailable for this profile.', { exact: true })).toBeVisible()
    expect(privateReads).toHaveLength(0)
    await page.goto(`${APP}/u/${fixture.alex.username}/friends/all`)
    await expect(page.getByRole('list', { name: 'Your friends', exact: true })).toBeVisible()
    expect((await friendPost(owner, '/logout')).ok()).toBeTruthy()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page).toHaveURL(`${APP}/login`)
    expect((await owner.request.get(`${API}/api/friends`, { headers: { Accept: 'application/json', Origin: APP } })).status()).toBe(401)
  } finally { await owner.close(); await anonymous.close() }
})

test('mobile notebook controls work by keyboard and pass scoped accessibility checks', async ({ page }, testInfo) => {
  const fixture = createFriendsFixture()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await loginFriend(page, fixture.alex)
  await page.goto(`${APP}/u/${fixture.alex.username}/friends/all`)
  await expect(page.getByRole('list', { name: 'Your friends', exact: true }).getByRole('link', { name: fixture.morgan.name, exact: true })).toBeVisible()
  for (const view of ['all', 'requests', 'find']) {
    await page.goto(`${APP}/u/${fixture.alex.username}/friends/${view}`)
    await expect(page.getByRole('navigation', { name: 'Friends sections' })).toBeVisible()
    await expect.poll(() => page.locator('.friends-region').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    const scan = await new AxeBuilder({ page }).include('.friends-region').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(scan.violations).toEqual([])
  }
  const input = page.getByRole('searchbox', { name: 'Find people by name' })
  await input.focus()
  await page.keyboard.type(fixture.casey.name.toUpperCase())
  await page.keyboard.press('Enter')
  const results = page.getByRole('list', { name: 'Find friends', exact: true })
  await expect(results.getByRole('listitem')).toHaveCount(1)
  await expect(results.getByRole('link')).toHaveCount(0)
  expect((await new AxeBuilder({ page }).include('.friends-region').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  await testInfo.attach('friends-mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
})
