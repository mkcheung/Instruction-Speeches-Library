import { test, expect } from '@playwright/test'
import { APP_URL, USERS } from './fixtures.js'

/**
 * PLAN-APP-HEADER.md's shell — header + sidebar on every authenticated
 * route, and the one regression the plan calls out by name (D5): the
 * public profile must stay reachable by an anonymous visitor. R3 wires
 * this into `ci.yml`'s Playwright command; R4's canary (all three
 * auth-setup projects still passing) is covered by CI running this
 * alongside the existing `speech-create.spec.ts`, not by anything in this
 * file specifically.
 *
 * Requires the fixture data from `api/database/seeders/E2ESeeder.php`, same
 * as `two-users.spec.ts`:
 *   docker compose exec app php artisan db:seed --class=Database\\Seeders\\E2ESeeder
 */

test.describe('authenticated shell', () => {
  test('the header and sidebar render on an authenticated route, and the skip link reaches <main>', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await page.goto(`${APP_URL}/dashboard`)

    // One <header> and one <main> landmark.
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByRole('main')).toBeVisible()

    // S7: the sidebar is a <nav> landmark, not an <aside> (which would
    // make this selector match nothing).
    const sidebar = page.getByRole('navigation', { name: 'Main' })
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Edit profile' })).toBeVisible()

    // D8 — Tab from a fresh load reaches "Skip to content" first, and it
    // moves focus into <main> (not just scrolls to it).
    // D1: `RequireAuth` renders `FullPageSpinner` in place of the whole
    // layout while `/api/me` is in flight, so the skip link isn't in the
    // DOM yet the instant `goto` resolves — the `expect(...).toBeVisible()`
    // calls above already waited that race out for us. Pressing `Tab`
    // before that would land on nothing (reproduced: `document.activeElement`
    // stayed on the spinner's `<body>`), which is what made this flaky in
    // WebKit specifically — its render is slower to win the race locally,
    // not a WebKit keyboard-focus quirk.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#content')).toBeFocused()

    await context.close()
  })

  test('/profile is reachable by clicking the sidebar — previously reachable from nowhere', async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await page.goto(`${APP_URL}/dashboard`)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Edit profile' }).click()
    await expect(page).toHaveURL(`${APP_URL}/profile`)

    await context.close()
  })

  test('the "My reviews" link in the nav landmark matches exactly once on /speeches (S2 strict-mode fix)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()

    await page.goto(`${APP_URL}/speeches`)
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My reviews' }),
    ).toHaveCount(1)

    await context.close()
  })
})

test.describe('D5 — public profile stays public', () => {
  test('an anonymous visitor loads /u/{username} and stays there, without being bounced to /login', async ({
    page,
  }) => {
    // Deliberately no storageState override — `page` here is a fresh,
    // unauthenticated context. The bug this guards: any 401 (including
    // one from an unguarded route's own `useGetMeQuery()`) broadcasts a
    // global `auth:unauthenticated` event, and `UnauthenticatedRedirect`
    // exempts only `/login`, `/register`, `/forgot-password` — a public
    // profile page that called `useGetMeQuery()` would eject the visitor.
    await page.goto(`${APP_URL}/u/${USERS.speaker.username}`)

    await expect(page).toHaveURL(`${APP_URL}/u/${USERS.speaker.username}`)
    // `@username` always renders regardless of whether display_name is
    // set (`PublicProfile.tsx` falls back to it in the heading too, so
    // `.first()` avoids a strict-mode double match either way) — the
    // safer assertion than asserting a specific display name.
    await expect(page.getByText(`@${USERS.speaker.username}`).first()).toBeVisible()
  })
})
